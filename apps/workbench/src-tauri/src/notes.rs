//! 笔记与知识库：R1 首个开发批次的可持续编辑笔记模型。
//!
//! 契约见 `docs/NOTES_MODEL.md`——改这里先改契约。要点：
//! - 修订 append-only：`note_upsert` 带 `base_revision` 校验，旧草稿不能覆盖新内容；
//! - 软删即回收站：FTS 同步增删，删除后搜不到、恢复后回到检索；
//! - 知识库是范围不是副本：成员关系表连接，同一笔记可属多个库，检索按库过滤在 SQL 层；
//! - 既有 materials/cards 不动，新笔记与旧数据互不覆盖。

use crate::chunker::chunk_markdown;
use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NoteDto {
    pub id: String,
    pub title: String,
    pub body_md: String,
    pub notebook: Option<String>,
    pub tags_json: String,
    pub is_pinned: bool,
    pub is_favorite: bool,
    pub archived_at: Option<i64>,
    pub source_material_id: Option<String>,
    pub current_revision: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub is_deleted: bool,
    pub deleted_at: Option<i64>,
}

impl Default for NoteDto {
    fn default() -> Self {
        Self {
            id: String::new(),
            title: String::new(),
            body_md: String::new(),
            notebook: None,
            tags_json: "[]".to_string(),
            is_pinned: false,
            is_favorite: false,
            archived_at: None,
            source_material_id: None,
            current_revision: 1,
            created_at: 0,
            updated_at: 0,
            is_deleted: false,
            deleted_at: None,
        }
    }
}

/// `note_upsert` 的结果：新修订号 + 是否新建。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSaveOutcome {
    pub id: String,
    pub revision: i64,
    pub created: bool,
}

/// `note_upsert` 失败且原因是修订冲突时返回当前修订号，调用方据此提示「内容已被
/// 别处更新」，而不是静默覆盖。
#[derive(Debug)]
pub enum NoteSaveError {
    Conflict { current_revision: i64 },
    Db(rusqlite::Error),
}

impl From<rusqlite::Error> for NoteSaveError {
    fn from(e: rusqlite::Error) -> Self {
        NoteSaveError::Db(e)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeBaseDto {
    pub id: String,
    pub name: String,
    pub description: String,
    pub created_at: i64,
    pub updated_at: i64,
}

const NOTE_COLUMNS: &str = "id, title, body_md, notebook, tags_json, is_pinned, is_favorite, \
     archived_at, source_material_id, current_revision, created_at, updated_at, is_deleted, deleted_at";

fn map_note_row(row: &rusqlite::Row<'_>) -> Result<NoteDto> {
    Ok(NoteDto {
        id: row.get(0)?,
        title: row.get(1)?,
        body_md: row.get(2)?,
        notebook: row.get(3)?,
        tags_json: row.get(4)?,
        is_pinned: row.get::<_, i64>(5)? != 0,
        is_favorite: row.get::<_, i64>(6)? != 0,
        archived_at: row.get(7)?,
        source_material_id: row.get(8)?,
        current_revision: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        is_deleted: row.get::<_, i64>(12)? != 0,
        deleted_at: row.get(13)?,
    })
}

/// 新建或更新一篇笔记。`base_revision` 是调用方看到的修订号：
/// - 0 表示新建；
/// - 与当前不一致则拒绝（见契约「修订语义」）。
///
/// 只有 title / body_md 变化才追加修订；收藏、置顶、归档等元数据变化只更新当前态。
pub fn note_upsert(conn: &Connection, note: &NoteDto, base_revision: i64, now: i64) -> Result<NoteSaveOutcome, NoteSaveError> {
    let existing: Option<NoteDto> = {
        let mut stmt = conn
            .prepare(&format!("SELECT {NOTE_COLUMNS} FROM notes WHERE id = ?1"))
            .map_err(NoteSaveError::Db)?;
        let mut rows = stmt.query(params![note.id]).map_err(NoteSaveError::Db)?;
        match rows.next().map_err(NoteSaveError::Db)? {
            Some(row) => Some(map_note_row(row).map_err(NoteSaveError::Db)?),
            None => None,
        }
    };

    let tx = conn.unchecked_transaction().map_err(NoteSaveError::Db)?;

    match &existing {
        Some(current) => {
            if base_revision != current.current_revision {
                return Err(NoteSaveError::Conflict { current_revision: current.current_revision });
            }
            let content_changed = current.title != note.title || current.body_md != note.body_md;
            let next_revision = if content_changed { current.current_revision + 1 } else { current.current_revision };
            tx.execute(
                "UPDATE notes SET title = ?2, body_md = ?3, notebook = ?4, tags_json = ?5, is_pinned = ?6,
                 is_favorite = ?7, archived_at = ?8, source_material_id = ?9, current_revision = ?10,
                 updated_at = ?11
                 WHERE id = ?1",
                params![
                    note.id,
                    note.title,
                    note.body_md,
                    note.notebook,
                    note.tags_json,
                    note.is_pinned as i64,
                    note.is_favorite as i64,
                    note.archived_at,
                    note.source_material_id,
                    next_revision,
                    now,
                ],
            )
            .map_err(NoteSaveError::Db)?;
            if content_changed {
                tx.execute(
                    "INSERT INTO note_revisions (note_id, revision, title, body_md, saved_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![note.id, next_revision, note.title, note.body_md, now],
                )
                .map_err(NoteSaveError::Db)?;
                rebuild_note_chunks(&tx, &note.id, &note.body_md, next_revision).map_err(NoteSaveError::Db)?;
                // FTS 可见性以库内删除态为准，不信客户端 DTO——回收站里的笔记
                // 即使被 upsert 改了正文，也不该借机回到检索（检索的 JOIN 也会挡，
                // 这里让索引本身保持一致）。
                sync_note_fts(&tx, &note.id, &note.title, &note.body_md, current.is_deleted).map_err(NoteSaveError::Db)?;
            }
            tx.commit().map_err(NoteSaveError::Db)?;
            Ok(NoteSaveOutcome { id: note.id.clone(), revision: next_revision, created: false })
        }
        None => {
            if base_revision != 0 {
                // 调用方以为它在更新一篇已有笔记，但库里没有——可能是别的入口删掉了。
                // 拒绝并告知现状，不静默重建。
                return Err(NoteSaveError::Conflict { current_revision: 0 });
            }
            tx.execute(
                "INSERT INTO notes (id, title, body_md, notebook, tags_json, is_pinned, is_favorite,
                 archived_at, source_material_id, current_revision, created_at, updated_at, is_deleted, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, ?10, 0, NULL)",
                params![
                    note.id,
                    note.title,
                    note.body_md,
                    note.notebook,
                    note.tags_json,
                    note.is_pinned as i64,
                    note.is_favorite as i64,
                    note.archived_at,
                    note.source_material_id,
                    now,
                ],
            )
            .map_err(NoteSaveError::Db)?;
            tx.execute(
                "INSERT INTO note_revisions (note_id, revision, title, body_md, saved_at) VALUES (?1, 1, ?2, ?3, ?4)",
                params![note.id, note.title, note.body_md, now],
            )
            .map_err(NoteSaveError::Db)?;
            rebuild_note_chunks(&tx, &note.id, &note.body_md, 1).map_err(NoteSaveError::Db)?;
            sync_note_fts(&tx, &note.id, &note.title, &note.body_md, false).map_err(NoteSaveError::Db)?;
            tx.commit().map_err(NoteSaveError::Db)?;
            Ok(NoteSaveOutcome { id: note.id.clone(), revision: 1, created: true })
        }
    }
}

/// 重建一篇笔记的分块与分块 FTS（upsert 事务内调用；修订号随写）。
fn rebuild_note_chunks(tx: &Connection, note_id: &str, body: &str, revision: i64) -> Result<()> {
    tx.execute("DELETE FROM note_chunks WHERE note_id = ?1", params![note_id])?;
    tx.execute("DELETE FROM fts_note_chunks WHERE note_id = ?1", params![note_id])?;
    for chunk in chunk_markdown(body) {
        tx.execute(
            "INSERT INTO note_chunks (note_id, chunk_index, content, char_start, char_end, content_revision)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![note_id, chunk.index as i64, chunk.content, chunk.char_start as i64, chunk.char_end as i64, revision],
        )?;
        tx.execute(
            "INSERT INTO fts_note_chunks (note_id, chunk_index, content) VALUES (?1, ?2, ?3)",
            params![note_id, chunk.index as i64, chunk.content],
        )?;
    }
    Ok(())
}

/// 分块检索：命中块 + 父笔记标题 + 原文偏移——禁止切片后无法回原件。
/// 返回 (note_id, chunk_index, 片段, char_start, char_end)。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteChunkHit {
    pub note_id: String,
    pub chunk_index: i64,
    pub content: String,
    pub char_start: i64,
    pub char_end: i64,
    pub note_title: String,
}

pub fn search_note_chunks(conn: &Connection, query: &str, limit: i64) -> Result<Vec<NoteChunkHit>> {
    let clean = query.trim();
    if clean.is_empty() {
        return Ok(Vec::new());
    }
    let match_query = clean
        .split_whitespace()
        .map(|w| format!("\"{}\"", w.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND ");
    let mut stmt = conn.prepare(
        "SELECT f.note_id, f.chunk_index, f.content, n.char_start, n.char_end, n2.title
         FROM fts_note_chunks f
         JOIN note_chunks n ON n.note_id = f.note_id AND n.chunk_index = f.chunk_index
         JOIN notes n2 ON n2.id = f.note_id
         WHERE n2.is_deleted = 0 AND fts_note_chunks MATCH ?1
         ORDER BY bm25(fts_note_chunks) ASC LIMIT ?2",
    )?;
    let mut out = Vec::new();
    {
        let rows = stmt.query_map(params![match_query, limit], |row| {
            Ok(NoteChunkHit {
                note_id: row.get(0)?,
                chunk_index: row.get(1)?,
                content: row.get(2)?,
                char_start: row.get(3)?,
                char_end: row.get(4)?,
                note_title: row.get(5)?,
            })
        })?;
        for r in rows {
            out.push(r?);
        }
    }
    if out.is_empty() {
        // unicode61 把连续中文切成整段 token，词在句中时 FTS 前缀匹配不上——
        // 与素材检索同一坑，LIKE 兜底（限制在 note_chunks，JOIN notes 保删除语义）。
        let wildcard = format!("%{}%", clean);
        let mut stmt = conn.prepare(
            "SELECT n.note_id, n.chunk_index, n.content, n.char_start, n.char_end, n2.title
             FROM note_chunks n JOIN notes n2 ON n2.id = n.note_id
             WHERE n2.is_deleted = 0 AND n.content LIKE ?1
             ORDER BY n2.updated_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![wildcard, limit], |row| {
            Ok(NoteChunkHit {
                note_id: row.get(0)?,
                chunk_index: row.get(1)?,
                content: row.get(2)?,
                char_start: row.get(3)?,
                char_end: row.get(4)?,
                note_title: row.get(5)?,
            })
        })?;
        for r in rows {
            out.push(r?);
        }
    }
    Ok(out)
}

fn sync_note_fts(conn: &Connection, id: &str, title: &str, body: &str, deleted: bool) -> Result<()> {
    conn.execute("DELETE FROM fts_notes WHERE note_id = ?1", params![id])?;
    if !deleted {
        conn.execute(
            "INSERT INTO fts_notes (note_id, title, body) VALUES (?1, ?2, ?3)",
            params![id, title, body],
        )?;
    }
    Ok(())
}

pub fn note_get(conn: &Connection, id: &str) -> Result<Option<NoteDto>> {
    let mut stmt = conn.prepare(&format!("SELECT {NOTE_COLUMNS} FROM notes WHERE id = ?1"))?;
    let mut rows = stmt.query(params![id])?;
    match rows.next()? {
        Some(row) => Ok(Some(map_note_row(row)?)),
        None => Ok(None),
    }
}

/// 列笔记。`include_deleted` 打开时列出回收站内容（恢复界面用）。
pub fn note_list(conn: &Connection, include_deleted: bool, limit: i64) -> Result<Vec<NoteDto>> {
    let sql = format!(
        "SELECT {NOTE_COLUMNS} FROM notes WHERE is_deleted = ?1 ORDER BY is_pinned DESC, updated_at DESC LIMIT ?2"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![include_deleted as i64, limit], map_note_row)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// 回收站软删：FTS 同步移除，搜索立即搜不到（契约「删除与回收站」）。
pub fn note_delete(conn: &Connection, id: &str, now: i64) -> Result<bool> {
    let tx = conn.unchecked_transaction()?;
    let changed = tx.execute(
        "UPDATE notes SET is_deleted = 1, deleted_at = ?2 WHERE id = ?1 AND is_deleted = 0",
        params![id, now],
    )?;
    if changed == 0 {
        return Ok(false);
    }
    tx.execute("DELETE FROM fts_notes WHERE note_id = ?1", params![id])?;
    tx.execute("DELETE FROM fts_note_chunks WHERE note_id = ?1", params![id])?;
    tx.commit()?;
    Ok(true)
}

/// 从回收站恢复：回填 FTS 与分块索引，重新可检索。修订号与历史不变。
pub fn note_restore(conn: &Connection, id: &str) -> Result<bool> {
    let note = match note_get(conn, id)? {
        Some(n) if n.is_deleted => n,
        _ => return Ok(false),
    };
    let tx = conn.unchecked_transaction()?;
    tx.execute("UPDATE notes SET is_deleted = 0, deleted_at = NULL WHERE id = ?1", params![id])?;
    tx.execute(
        "INSERT INTO fts_notes (note_id, title, body) VALUES (?1, ?2, ?3)",
        params![note.id, note.title, note.body_md],
    )?;
    rebuild_note_chunks(&tx, &note.id, &note.body_md, note.current_revision)?;
    tx.commit()?;
    Ok(true)
}

// ---------- 知识库 ----------

pub fn kb_create(conn: &Connection, id: &str, name: &str, description: &str, now: i64) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("知识库名称不能为空".to_string());
    }
    let dup: i64 = conn
        .query_row("SELECT COUNT(*) FROM knowledge_bases WHERE name = ?1", params![name], |r| r.get(0))
        .unwrap_or(0);
    if dup > 0 {
        return Err(format!("已有名为「{name}」的知识库，请换个名字"));
    }
    conn.execute(
        "INSERT INTO knowledge_bases (id, name, description, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, name, description, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn kb_list(conn: &Connection) -> Result<Vec<KnowledgeBaseDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, created_at, updated_at FROM knowledge_bases ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(KnowledgeBaseDto {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// 加入成员：幂等（契约「知识库」——重复加入不报错、不重复行）。
pub fn kb_add_note(conn: &Connection, kb_id: &str, note_id: &str, now: i64) -> Result<(), String> {
    let kb: i64 = conn
        .query_row("SELECT COUNT(*) FROM knowledge_bases WHERE id = ?1", params![kb_id], |r| r.get(0))
        .unwrap_or(0);
    if kb == 0 {
        return Err("知识库不存在".to_string());
    }
    let note: i64 = conn
        .query_row("SELECT COUNT(*) FROM notes WHERE id = ?1", params![note_id], |r| r.get(0))
        .unwrap_or(0);
    if note == 0 {
        return Err("笔记不存在".to_string());
    }
    conn.execute(
        "INSERT INTO kb_membership (kb_id, note_id, added_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(kb_id, note_id) DO NOTHING",
        params![kb_id, note_id, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 全量成员关系（`${kb_id}\n${note_id}` → added_at），界面据此显示笔记属于哪些库。
pub fn kb_membership_map(conn: &Connection) -> Result<std::collections::HashMap<String, i64>> {
    let mut stmt = conn.prepare("SELECT kb_id, note_id, added_at FROM kb_membership")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?))
    })?;
    let mut out = std::collections::HashMap::new();
    for r in rows {
        let (kb, note, added) = r?;
        out.insert(format!("{kb}\n{note}"), added);
    }
    Ok(out)
}

pub fn kb_remove_note(conn: &Connection, kb_id: &str, note_id: &str) -> Result<()> {
    conn.execute("DELETE FROM kb_membership WHERE kb_id = ?1 AND note_id = ?2", params![kb_id, note_id])?;
    Ok(())
}

/// 笔记全文检索：FTS5 + LIKE 兜底（与素材检索同形）。
/// `kb_id` 为 Some 时按库过滤——过滤在 SQL 层完成，不同库检索不串库。
pub fn search_notes(conn: &Connection, query: &str, kb_id: Option<&str>, limit: i64) -> Result<Vec<NoteDto>> {
    let clean = query.trim();
    if clean.is_empty() {
        return Ok(Vec::new());
    }
    let kb_filter = match kb_id {
        Some(k) => format!(" AND n.id IN (SELECT note_id FROM kb_membership WHERE kb_id = '{}')", k.replace('\'', "''")),
        None => String::new(),
    };
    let match_query = clean
        .split_whitespace()
        .map(|w| format!("\"{}\"*", w.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND ");

    let fts_sql = format!(
        "SELECT n.id, n.title, n.body_md, n.notebook, n.tags_json, n.is_pinned, n.is_favorite,
                n.archived_at, n.source_material_id, n.current_revision, n.created_at, n.updated_at, n.is_deleted, n.deleted_at
         FROM fts_notes f JOIN notes n ON f.note_id = n.id
         WHERE n.is_deleted = 0 AND fts_notes MATCH ?1{kb_filter}
         ORDER BY bm25(fts_notes) ASC LIMIT ?2"
    );
    let mut out = Vec::new();
    {
        let mut stmt = conn.prepare(&fts_sql)?;
        let rows = stmt.query_map(params![match_query, limit], map_note_row)?;
        for r in rows {
            out.push(r?);
        }
    }
    if out.is_empty() {
        let wildcard = format!("%{}%", clean);
        let like_sql = format!(
            "SELECT {NOTE_COLUMNS} FROM notes n
             WHERE n.is_deleted = 0 AND (n.title LIKE ?1 OR n.body_md LIKE ?1){kb_filter}
             ORDER BY n.updated_at DESC LIMIT ?2"
        );
        let mut stmt = conn.prepare(&like_sql)?;
        let rows = stmt.query_map(params![wildcard, limit], map_note_row)?;
        for r in rows {
            out.push(r?);
        }
    }
    Ok(out)
}

/// R2 统一笔记模型迁移的第一块：把一篇既有素材映射为可编辑笔记（惰性、幂等）。
///
/// 契约（docs/NOTES_MODEL.md「迁移」与 R2 路线）：原素材不丢、不改动；
/// 幂等键是 `source_material_id`——同一素材重复映射返回**同一篇**笔记，不造副本；
/// 正文取 cleaned_markdown ?? raw_text；旧卡片与评分不受影响。
/// 不做全库一次性回填（不在启动时阻塞）——映射由用户显式触发。
pub fn note_ensure_from_material(
    conn: &Connection,
    material_id: &str,
    now: i64,
) -> Result<NoteSaveOutcome, String> {
    // 已映射过：返回既有笔记（幂等）
    if let Some(existing) = conn
        .query_row(
            &format!("SELECT {NOTE_COLUMNS} FROM notes WHERE source_material_id = ?1 AND is_deleted = 0"),
            params![material_id],
            |row| map_note_row(row),
        )
        .optional()
        .map_err(|e| e.to_string())?
    {
        return Ok(NoteSaveOutcome { id: existing.id, revision: existing.current_revision, created: false });
    }

    let material = conn
        .query_row(
            "SELECT title, raw_text, cleaned_markdown FROM materials WHERE id = ?1",
            params![material_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let (title, raw_text, cleaned) = material.ok_or_else(|| format!("找不到素材 {material_id}，可能已被删除"))?;

    let body = cleaned.filter(|c| !c.trim().is_empty()).unwrap_or(raw_text);
    let note = NoteDto {
        id: uuid::Uuid::new_v4().to_string(),
        title,
        body_md: body,
        notebook: None,
        tags_json: "[]".to_string(),
        is_pinned: false,
        is_favorite: false,
        archived_at: None,
        source_material_id: Some(material_id.to_string()),
        current_revision: 1,
        created_at: now,
        updated_at: now,
        is_deleted: false,
        deleted_at: None,
    };
    note_upsert(conn, &note, 0, now).map_err(|e| match e {
        NoteSaveError::Conflict { current_revision } => {
            format!("笔记修订冲突（当前修订 {current_revision}）——该素材可能刚被映射过，请刷新")
        }
        NoteSaveError::Db(err) => err.to_string(),
    })
}

// ---------- 测试：契约的每一条都要有断言钉着 ----------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_tables;
    use std::env;
    use std::path::PathBuf;

    fn temp_db(tag: &str) -> Connection {
        let dir: PathBuf = env::temp_dir().join(format!("kf-notes-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = crate::db::open_db(&dir.join("knowflick.db")).unwrap();
        // open_db 已含 init_tables；这里再显式调一次，验证重复初始化幂等（老库升级路径）。
        init_tables(&conn).unwrap();
        conn
    }

    fn draft(id: &str, title: &str, body: &str) -> NoteDto {
        NoteDto { id: id.to_string(), title: title.to_string(), body_md: body.to_string(), ..Default::default() }
    }

    #[test]
    fn create_edit_round_trip_and_revision_history() {
        let conn = temp_db("roundtrip");
        let out = note_upsert(&conn, &draft("n1", "第一篇", "正文：记忆与知识"), 0, 1000).unwrap();
        assert!(out.created && out.revision == 1);

        let mut v2 = draft("n1", "第一篇（改）", "正文：记忆、知识与检索");
        v2.is_favorite = true;
        let out2 = note_upsert(&conn, &v2, 1, 2000).unwrap();
        assert_eq!(out2.revision, 2, "内容变了要追加修订");

        let got = note_get(&conn, "n1").unwrap().unwrap();
        assert_eq!((got.title.as_str(), got.body_md.as_str(), got.is_favorite), (v2.title.as_str(), v2.body_md.as_str(), true));
        assert_eq!(got.created_at, 1000, "创建时间不被更新改写");
        assert_eq!(got.updated_at, 2000);

        let revs: i64 = conn
            .query_row("SELECT COUNT(*) FROM note_revisions WHERE note_id = 'n1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(revs, 2);

        // 只改元数据（收藏）不追加修订
        let out3 = note_upsert(&conn, &v2, 2, 3000).unwrap();
        assert_eq!(out3.revision, 2, "元数据变化不产生修订");
    }

    #[test]
    fn stale_draft_cannot_overwrite_newer_content() {
        let conn = temp_db("conflict");
        note_upsert(&conn, &draft("n1", "t", "v1"), 0, 1000).unwrap();
        note_upsert(&conn, &draft("n1", "t", "v2"), 1, 2000).unwrap();

        // 旧窗口拿着修订 1 再保存——必须被拒绝，而不是覆盖 v2
        match note_upsert(&conn, &draft("n1", "t", "旧草稿"), 1, 3000) {
            Err(NoteSaveError::Conflict { current_revision }) => assert_eq!(current_revision, 2),
            other => panic!("期望修订冲突，得到 {:?}", other.map(|o| o.revision)),
        }
        assert_eq!(note_get(&conn, "n1").unwrap().unwrap().body_md, "v2");

        // base_revision=0 但笔记已存在：同样拒绝（不静默重建）
        assert!(matches!(
            note_upsert(&conn, &draft("n1", "t", "x"), 0, 3000),
            Err(NoteSaveError::Conflict { .. })
        ));
    }

    #[test]
    fn recycle_bin_hides_from_search_and_restores() {
        let conn = temp_db("recycle");
        note_upsert(&conn, &draft("n1", "会议记录", "关于北极项目的结论"), 0, 1000).unwrap();
        assert_eq!(search_notes(&conn, "北极项目", None, 10).unwrap().len(), 1, "保存后正文可被搜到");

        assert!(note_delete(&conn, "n1", 2000).unwrap());
        assert!(search_notes(&conn, "北极项目", None, 10).unwrap().is_empty(), "删除后搜不到");
        let listed = note_list(&conn, false, 10).unwrap();
        assert!(listed.is_empty(), "默认列表不含回收站");
        let trashed = note_list(&conn, true, 10).unwrap();
        assert_eq!(trashed.len(), 1, "回收站视图能看到");

        assert!(note_restore(&conn, "n1").unwrap());
        assert_eq!(search_notes(&conn, "北极项目", None, 10).unwrap().len(), 1, "恢复后回到检索");
        assert_eq!(note_get(&conn, "n1").unwrap().unwrap().current_revision, 1, "修订不因回收站重置");
    }

    #[test]
    fn knowledge_base_membership_and_scoped_search() {
        let conn = temp_db("kb");
        note_upsert(&conn, &draft("n1", "工作", "项目 A 的结论"), 0, 1000).unwrap();
        note_upsert(&conn, &draft("n2", "生活", "项目 B 的菜谱"), 0, 1100).unwrap();
        kb_create(&conn, "kb1", "项目 A", "", 1200).unwrap();

        // 幂等加入
        kb_add_note(&conn, "kb1", "n1", 1300).unwrap();
        kb_add_note(&conn, "kb1", "n1", 1400).unwrap();
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM kb_membership", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 1, "重复加入不重复行");

        // 检索按库过滤：搜「项目」全局两条，限 kb1 只剩 n1
        assert_eq!(search_notes(&conn, "项目", None, 10).unwrap().len(), 2);
        let scoped = search_notes(&conn, "项目", Some("kb1"), 10).unwrap();
        assert_eq!(scoped.len(), 1);
        assert_eq!(scoped[0].id, "n1");

        // 移出后限库检索不再命中
        kb_remove_note(&conn, "kb1", "n1").unwrap();
        assert!(search_notes(&conn, "项目", Some("kb1"), 10).unwrap().is_empty());

        // 同名库拒绝、空名拒绝
        assert!(kb_create(&conn, "kb2", "项目 A", "", 1500).is_err());
        assert!(kb_create(&conn, "kb3", "  ", "", 1500).is_err());
    }

    /// 分块：保存时按正文重建、修订号随写；检索命中块可回原件（偏移）；
    /// 回收站里搜不到块；恢复后回来。
    #[test]
    fn chunks_rebuild_on_revision_and_support_located_search() {
        let conn = temp_db("chunks");
        note_upsert(&conn, &draft("n1", "长文", "关于北极项目的第一段。"), 0, 1000).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM note_chunks WHERE note_id='n1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);

        note_upsert(&conn, &draft("n1", "长文", "关于北极项目的第一段。\n\n关于南极项目的新段落，内容足够长以形成独立的分块内容，加上更多文字确保它确实是一个单独的段落边界处理。"), 1, 2000).unwrap();
        let rev: i64 = conn
            .query_row("SELECT MAX(content_revision) FROM note_chunks WHERE note_id='n1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rev, 2, "分块的 content_revision 跟随修订");

        // 检索命中块：带 note 标题与原文偏移
        let hits = search_note_chunks(&conn, "南极项目", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].note_id, "n1");
        assert_eq!(hits[0].note_title, "长文");
        assert!(hits[0].char_start < hits[0].char_end);
        let body = note_get(&conn, "n1").unwrap().unwrap().body_md;
        let chars: Vec<char> = body.chars().collect();
        let slice: String = chars[hits[0].char_start as usize..hits[0].char_end as usize].iter().collect();
        assert!(slice.contains("南极项目"), "块范围必须能在原文里找到命中内容");

        // 回收站：块搜不到；恢复后回来
        note_delete(&conn, "n1", 3000).unwrap();
        assert!(search_note_chunks(&conn, "南极项目", 10).unwrap().is_empty());
        note_restore(&conn, "n1").unwrap();
        assert_eq!(search_note_chunks(&conn, "南极项目", 10).unwrap().len(), 1);
    }

    /// R2 映射：素材 → 笔记，幂等；原素材与旧卡片不受影响；映射后可编辑。
    #[test]
    fn material_maps_to_note_idempotently_and_original_survives() {
        let conn = temp_db("m2n");
        conn.execute(
            "INSERT INTO materials (id, source_type, title, raw_text, cleaned_markdown, content_hash,
             metadata_json, inbox_status, created_at, updated_at)
             VALUES ('m1','web','网页标题','原始全文','清理后的正文','h1','{}','inbox',1,1)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO cards (id, material_id, category, headline, summary, details, links_json, tags_json,
             source, created_at, updated_at, repetition, interval_days, ease_factor, stability, difficulty)
             VALUES ('c1','m1','x','旧卡','摘要','正文','[]','[]','imported',1,1, 3, 5.5, 2.8, 4.2, 5.1)",
            [],
        ).unwrap();

        let out = note_ensure_from_material(&conn, "m1", 1000).unwrap();
        assert!(out.created, "首次映射是新建");
        assert_eq!(out.revision, 1);

        // 幂等：再映射一次返回同一篇，不造副本
        let again = note_ensure_from_material(&conn, "m1", 2000).unwrap();
        assert!(!again.created && again.id == out.id);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM notes WHERE source_material_id = 'm1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);

        // 正文优先 cleaned_markdown；标题来自素材
        let note = note_get(&conn, &out.id).unwrap().unwrap();
        assert_eq!(note.title, "网页标题");
        assert_eq!(note.body_md, "清理后的正文");
        assert_eq!(note.source_material_id.as_deref(), Some("m1"));

        // 原素材与旧卡片（含 FSRS 字段）不受影响
        let mat: i64 = conn.query_row("SELECT COUNT(*) FROM materials WHERE id='m1'", [], |r| r.get(0)).unwrap();
        assert_eq!(mat, 1);
        let fsrs: (i64, f64) = conn
            .query_row("SELECT repetition, interval_days FROM cards WHERE id='c1'", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(fsrs, (3, 5.5));

        // 映射后的笔记可编辑（修订推进），原素材仍是原样
        let mut edited = note.clone();
        edited.body_md = "清理后的正文\n\n用户续写的一段。".to_string();
        let e2 = note_upsert(&conn, &edited, note.current_revision, 3000).unwrap();
        assert_eq!(e2.revision, 2);
        let raw_now: String = conn.query_row("SELECT raw_text FROM materials WHERE id='m1'", [], |r| r.get(0)).unwrap();
        assert_eq!(raw_now, "原始全文", "映射编辑不回写素材原件");

        // 不存在的素材报中文错
        assert!(note_ensure_from_material(&conn, "ghost", 4000).is_err());
    }

    /// 老库（只有旧表）打开后建笔记：迁移路径不丢旧数据、新表即建即用。
    #[test]
    fn legacy_library_upgrades_and_keeps_old_data() {
        let dir = env::temp_dir().join(format!("kf-notes-legacy-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("knowflick.db");
        {
            let conn = crate::db::open_db(&db_path).unwrap();
            crate::db::save_material(
                &conn,
                &crate::db::RawMaterialDto {
                    id: "m1".into(),
                    source_type: "manual".into(),
                    title: "旧素材".into(),
                    source_url: None,
                    raw_text: "旧素材正文".into(),
                    cleaned_markdown: None,
                    content_hash: "h1".into(),
                    media_path: None,
                    media_size_bytes: 0,
                    metadata_json: "{}".into(),
                    inbox_status: "inbox".into(),
                    created_at: 1,
                    updated_at: 1,
                },
            )
            .unwrap();
        }
        // 重新打开（迁移路径）后新表可用、旧数据仍在
        let conn = crate::db::open_db(&db_path).unwrap();
        note_upsert(&conn, &draft("n1", "新笔记", "新正文"), 0, 1000).unwrap();
        let old: i64 = conn
            .query_row("SELECT COUNT(*) FROM materials WHERE id = 'm1' AND is_deleted = 0", [], |r| r.get(0))
            .unwrap();
        assert_eq!(old, 1, "旧素材不因升级消失");
        assert_eq!(search_notes(&conn, "新正文", None, 10).unwrap().len(), 1);
    }
}
