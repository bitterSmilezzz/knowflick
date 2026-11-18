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
    pub exclude_from_profile: bool,
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
            exclude_from_profile: false,
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
     archived_at, source_material_id, current_revision, created_at, updated_at, is_deleted, deleted_at, exclude_from_profile";

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
        exclude_from_profile: row.get::<_, i64>(14)? != 0,
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
                 updated_at = ?11, exclude_from_profile = ?12
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
                    note.exclude_from_profile as i64,
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
                 archived_at, source_material_id, current_revision, created_at, updated_at, is_deleted, deleted_at, exclude_from_profile)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, ?10, 0, NULL, ?11)",
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
                    note.exclude_from_profile as i64,
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

/// 列表范围（T02，审计 KF-005）：旧布尔 `include_deleted` 的真实语义是「只列回收站」，
/// 调用方却当「包含全部」用——桌面回收站因此读不到、全量备份漏掉删过的笔记。
/// 显式三段：active 正常 / deleted 仅回收站 / all 全量（备份采集、恢复对账用）。
pub fn note_list_scoped(
    conn: &Connection,
    scope: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<NoteDto>> {
    let where_clause = match scope {
        "active" => "WHERE is_deleted = 0",
        "deleted" => "WHERE is_deleted = 1",
        "all" => "",
        other => {
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "未知的笔记列表范围：{other}"
            )))
        }
    };
    let sql = format!(
        "SELECT {NOTE_COLUMNS} FROM notes {where_clause} ORDER BY is_pinned DESC, updated_at DESC LIMIT ?1 OFFSET ?2"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![limit, offset], map_note_row)?;
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

// ---------- 备份恢复专用写入（T04，审计 KF-003） ----------

/// 恢复落库结果：每条都有明确处置，回执不再吞错假计数。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NoteRestoreOutcome {
    /// 包内条目原样建入（修订号、时间、删除态全部保留）。
    Created,
    /// 包内修订号更大：以包内容覆盖本地。
    Updated,
    /// 本地修订号更新：不回退本地（「本地修订不可无声回退」）。
    SkippedLocalNewer,
    /// 修订号相同但内容分歧：保守保留本地，等人工处置。
    SkippedDivergent,
    /// 已一致（重复恢复的幂等结果）。
    Current,
}

pub(crate) fn explain_restore_error(action: &str, error: &rusqlite::Error) -> String {
    match error {
        // Restore validation uses this rusqlite variant to carry domain messages.
        // Keep the useful Chinese reason, without exposing the driver prefix.
        rusqlite::Error::InvalidParameterName(reason) => format!("{action}：{reason}"),
        _ => crate::error_text::explain(action, error),
    }
}

/// Versioned archive representation of an immutable content revision.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoteRevision {
    pub note_id: String,
    pub revision: i64,
    pub title: String,
    pub body_md: String,
    pub saved_at: i64,
}

pub(crate) fn revisions_for_backup(conn: &Connection) -> Result<Vec<NoteRevision>> {
    let mut stmt = conn.prepare("SELECT note_id, revision, title, body_md, saved_at FROM note_revisions ORDER BY note_id, revision")?;
    let rows = stmt.query_map([], |row| Ok(NoteRevision {
        note_id: row.get(0)?, revision: row.get(1)?, title: row.get(2)?, body_md: row.get(3)?, saved_at: row.get(4)?,
    }))?;
    rows.collect()
}

/// 备份恢复专用写入：按包内当前态**原样**落库，不追加修订、不重置时间、
/// 不复活回收站。恢复是「显式用户动作」，与普通编辑（`note_upsert`）是两个
/// 入口——审计 KF-003 的根因就是恢复走了普通编辑：revision=9 的包落库变成
/// 修订 1、时间改成恢复时刻、回收站内容自动复活。
///
/// 旧包没有历史明细，只落一条恢复时的基线修订行。新包通过专用入口
/// 在同一事务中恢复原有历史，不另造基线。
pub fn note_restore_upsert(conn: &Connection, note: &NoteDto) -> Result<NoteRestoreOutcome> {
    note_restore_upsert_checked(conn, note, None)
}

/// Optional source binding is checked while holding the SQLite write lock.
pub(crate) fn note_restore_upsert_checked(conn: &Connection, note: &NoteDto, binding: Option<Option<&str>>) -> Result<NoteRestoreOutcome> {
    note_restore_upsert_with_history(conn, note, binding, None)
}

/// When supplied, history is restored together with its note in one transaction.
pub(crate) fn note_restore_upsert_with_history(conn: &Connection, note: &NoteDto, binding: Option<Option<&str>>, history: Option<&[NoteRevision]>) -> Result<NoteRestoreOutcome> {
    if note.id.is_empty() {
        return Err(rusqlite::Error::InvalidParameterName(
            "恢复的笔记缺少 id".to_string(),
        ));
    }
    let revision = if note.current_revision < 1 { 1 } else { note.current_revision };
    let tx = rusqlite::Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Immediate)?;
    let existing = note_get(&tx, &note.id)?;
    if let Some(history) = history {
        let mut incoming = std::collections::BTreeMap::new();
        if note.current_revision < 1 { return Err(rusqlite::Error::InvalidParameterName("笔记修订号无效".into())); }
        for item in history {
            if item.note_id != note.id || item.revision < 1 || item.revision > note.current_revision || incoming.insert(item.revision, item).is_some() {
                return Err(rusqlite::Error::InvalidParameterName("笔记历史修订无效或重复".into()));
            }
            if item.revision == note.current_revision && (item.title != note.title || item.body_md != note.body_md) {
                return Err(rusqlite::Error::InvalidParameterName("当前笔记与历史修订不一致".into()));
            }
        }
        if existing.as_ref().is_none_or(|local| local.current_revision <= revision) {
            // A newer local note is skipped below, including all history writes.
            // Its additional revisions must not turn that safe skip into a restore failure.
            let mut stmt = tx.prepare("SELECT note_id, revision, title, body_md, saved_at FROM note_revisions WHERE note_id=?1")?;
            let rows = stmt.query_map([&note.id], |row| Ok(NoteRevision {
                note_id: row.get(0)?, revision: row.get(1)?, title: row.get(2)?, body_md: row.get(3)?, saved_at: row.get(4)?,
            }))?;
            for row in rows {
                let local = row?;
                if incoming.get(&local.revision).copied() != Some(&local) {
                    return Err(rusqlite::Error::InvalidParameterName("本地笔记历史与备份不同，未覆盖".into()));
                }
            }
            if let Some(local) = &existing {
                if local.current_revision < revision {
                    let parent = incoming.get(&local.current_revision);
                    let same_ancestor = parent.is_some_and(|item| item.title == local.title && item.body_md == local.body_md);
                    let same_metadata = local.notebook == note.notebook && local.tags_json == note.tags_json &&
                        local.is_pinned == note.is_pinned && local.is_favorite == note.is_favorite &&
                        local.archived_at == note.archived_at && local.source_material_id == note.source_material_id &&
                        local.is_deleted == note.is_deleted && local.deleted_at == note.deleted_at &&
                        local.exclude_from_profile == note.exclude_from_profile;
                    if !same_ancestor || !same_metadata {
                        return Err(rusqlite::Error::InvalidParameterName("本地笔记与备份的历史或属性存在分歧，未覆盖".into()));
                    }
                }
            }
        }
    }
    if let Some(expected) = binding {
        let current = crate::backup_r4::note_fingerprint(&tx, &note.id)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(e))))?;
        if (current.is_some() && current.as_deref() != expected) || (current.is_none() && expected.is_none()) {
            return Err(rusqlite::Error::InvalidParameterName("本地笔记与备份的关联原件不一致，未覆盖".into()));
        }
    }
    let mut outcome;
    match &existing {
        Some(local) if local.current_revision > revision => {
            outcome = NoteRestoreOutcome::SkippedLocalNewer;
        }
        Some(local) if local.current_revision == revision => {
            let same = local.title == note.title
                && local.body_md == note.body_md
                && local.notebook == note.notebook
                && local.tags_json == note.tags_json
                && local.is_pinned == note.is_pinned
                && local.is_favorite == note.is_favorite
                && local.archived_at == note.archived_at
                && local.source_material_id == note.source_material_id
                && local.is_deleted == note.is_deleted
                && local.deleted_at == note.deleted_at
                && local.exclude_from_profile == note.exclude_from_profile;
            outcome = if same {
                NoteRestoreOutcome::Current
            } else {
                NoteRestoreOutcome::SkippedDivergent
            };
        }
        Some(_) => {
            tx.execute(
                "UPDATE notes SET title = ?2, body_md = ?3, notebook = ?4, tags_json = ?5, is_pinned = ?6,
                 is_favorite = ?7, archived_at = ?8, source_material_id = ?9, current_revision = ?10,
                 created_at = ?11, updated_at = ?12, is_deleted = ?13, deleted_at = ?14, exclude_from_profile = ?15
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
                    revision,
                    note.created_at,
                    note.updated_at,
                    note.is_deleted as i64,
                    note.deleted_at,
                    note.exclude_from_profile as i64,
                ],
            )?;
            if history.is_none() {
                tx.execute("INSERT INTO note_revisions (note_id, revision, title, body_md, saved_at) VALUES (?1, ?2, ?3, ?4, ?5)", params![note.id, revision, note.title, note.body_md, note.updated_at])?;
            }
            sync_restored_indexes(&tx, note, revision)?;
            outcome = NoteRestoreOutcome::Updated;
        }
        None => {
            tx.execute(
                "INSERT INTO notes (id, title, body_md, notebook, tags_json, is_pinned, is_favorite,
                 archived_at, source_material_id, current_revision, created_at, updated_at, is_deleted, deleted_at, exclude_from_profile)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
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
                    revision,
                    note.created_at,
                    note.updated_at,
                    note.is_deleted as i64,
                    note.deleted_at,
                    note.exclude_from_profile as i64,
                ],
            )?;
            if history.is_none() {
                tx.execute("INSERT INTO note_revisions (note_id, revision, title, body_md, saved_at) VALUES (?1, ?2, ?3, ?4, ?5)", params![note.id, revision, note.title, note.body_md, note.updated_at])?;
            }
            sync_restored_indexes(&tx, note, revision)?;
            outcome = NoteRestoreOutcome::Created;
        }
    }
    if let Some(history) = history {
        if !matches!(outcome, NoteRestoreOutcome::SkippedLocalNewer | NoteRestoreOutcome::SkippedDivergent) {
            let mut added = 0;
            for item in history {
                added += tx.execute("INSERT OR IGNORE INTO note_revisions (note_id, revision, title, body_md, saved_at) VALUES (?1, ?2, ?3, ?4, ?5)", params![item.note_id, item.revision, item.title, item.body_md, item.saved_at])?;
            }
            if added > 0 && matches!(outcome, NoteRestoreOutcome::Current) { outcome = NoteRestoreOutcome::Updated; }
        }
    }
    if let Some(expected) = binding {
        let current = crate::backup_r4::note_fingerprint(&tx, &note.id)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(e))))?;
        if current.as_deref() != expected {
            return Err(rusqlite::Error::InvalidParameterName("备份笔记与关联原件指纹不一致，未写入".into()));
        }
    }
    tx.commit()?;
    Ok(outcome)
}

/// 恢复后的索引对齐：删除态保持不可检索（回收站不复活）、无分块；
/// 活动态重建 FTS 与分块索引（修订号随包内当前修订）。
fn sync_restored_indexes(tx: &Connection, note: &NoteDto, revision: i64) -> Result<()> {
    sync_note_fts(tx, &note.id, &note.title, &note.body_md, note.is_deleted)?;
    if note.is_deleted {
        tx.execute("DELETE FROM note_chunks WHERE note_id = ?1", params![note.id])?;
        tx.execute("DELETE FROM fts_note_chunks WHERE note_id = ?1", params![note.id])?;
    } else {
        rebuild_note_chunks(tx, &note.id, &note.body_md, revision)?;
    }
    Ok(())
}

/// MCP 服务端入口的绝对路径（T10，审计 KF-013）：
/// 安装用户复制到外部客户端的配置必须指向真实存在的文件，
/// 不能是仓库相对路径（外部客户端的 cwd 不保证是仓库）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerPaths {
    /// MCP 服务端脚本的绝对路径。
    pub script_path: String,
    /// 知识库目录的绝对路径（外部进程用它定位 knowflick.db）。
    pub library_dir: String,
    /// 脚本是否真的存在（不存在时界面要如实说明，而不是给一段不能用的配置）。
    pub script_exists: bool,
}

// ---------- 知识库 ----------

/// 恢复成员关系的单条输入（T04：addedAt 保留包内值，不换成恢复时刻）。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KbMembershipRestore {
    pub kb_id: String,
    pub note_id: String,
    pub added_at: i64,
}

/// 单条处置结果：逐条上报，不吞错假计数。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KbMembershipRestoreOutcome {
    pub kb_id: String,
    pub note_id: String,
    /// added | existing | failed
    pub action: String,
    pub error: Option<String>,
}

/// 备份恢复专用：按包内 added_at 挂成员关系（幂等，已有即 existing）。
/// 知识库或笔记不存在 → 该条 failed，由调用方计入报告。
pub fn kb_restore_membership(
    conn: &Connection,
    entries: &[KbMembershipRestore],
) -> Result<Vec<KbMembershipRestoreOutcome>> {
    let mut out = Vec::with_capacity(entries.len());
    for e in entries {
        let outcome = |action: &str, error: Option<String>| KbMembershipRestoreOutcome {
            kb_id: e.kb_id.clone(),
            note_id: e.note_id.clone(),
            action: action.to_string(),
            error,
        };
        let kb_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM knowledge_bases WHERE id = ?1",
                params![e.kb_id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if kb_exists == 0 {
            out.push(outcome("failed", Some("知识库不存在".to_string())));
            continue;
        }
        let note_exists: i64 = conn
            .query_row("SELECT COUNT(*) FROM notes WHERE id = ?1", params![e.note_id], |r| r.get(0))
            .unwrap_or(0);
        if note_exists == 0 {
            out.push(outcome("failed", Some("笔记不存在".to_string())));
            continue;
        }
        let existing: Option<i64> = conn
            .query_row(
                "SELECT added_at FROM kb_membership WHERE kb_id = ?1 AND note_id = ?2",
                params![e.kb_id, e.note_id],
                |r| r.get(0),
            )
            .optional()?;
        if existing.is_some() {
            out.push(outcome("existing", None));
            continue;
        }
        conn.execute(
            "INSERT INTO kb_membership (kb_id, note_id, added_at) VALUES (?1, ?2, ?3)",
            params![e.kb_id, e.note_id, e.added_at],
        )?;
        out.push(outcome("added", None));
    }
    Ok(out)
}

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
                n.archived_at, n.source_material_id, n.current_revision, n.created_at, n.updated_at, n.is_deleted, n.deleted_at,
                n.exclude_from_profile
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
        exclude_from_profile: false,
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
        v2.exclude_from_profile = true;
        let out2 = note_upsert(&conn, &v2, 1, 2000).unwrap();
        assert_eq!(out2.revision, 2, "内容变了要追加修订");

        let got = note_get(&conn, "n1").unwrap().unwrap();
        assert_eq!((got.title.as_str(), got.body_md.as_str(), got.is_favorite), (v2.title.as_str(), v2.body_md.as_str(), true));
        assert!(got.exclude_from_profile);
        assert_eq!(got.created_at, 1000, "创建时间不被更新改写");
        assert_eq!(got.updated_at, 2000);

        let revs: i64 = conn
            .query_row("SELECT COUNT(*) FROM note_revisions WHERE note_id = 'n1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(revs, 2);

        // 只改元数据（收藏）不追加修订
        let mut metadata_edit = v2.clone();
        metadata_edit.exclude_from_profile = false;
        let out3 = note_upsert(&conn, &metadata_edit, 2, 3000).unwrap();
        assert_eq!(out3.revision, 2, "元数据变化不产生修订");
        assert!(!note_get(&conn, "n1").unwrap().unwrap().exclude_from_profile);
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
        let listed = note_list_scoped(&conn, "active", 10, 0).unwrap();
        assert!(listed.is_empty(), "默认列表不含回收站");
        let trashed = note_list_scoped(&conn, "deleted", 10, 0).unwrap();
        assert_eq!(trashed.len(), 1, "回收站视图能看到");
        // 三段范围的会计恒等式（KF-005 的反例：旧布尔语义下 all 与 deleted 混同）
        let all = note_list_scoped(&conn, "all", 10, 0).unwrap();
        assert_eq!(all.len(), listed.len() + trashed.len(), "all = active + deleted");
        assert!(all.iter().any(|n| n.id == "n1"), "全量范围包含回收站里的笔记");

        assert!(note_restore(&conn, "n1").unwrap());
        assert_eq!(search_notes(&conn, "北极项目", None, 10).unwrap().len(), 1, "恢复后回到检索");
        assert_eq!(note_get(&conn, "n1").unwrap().unwrap().current_revision, 1, "修订不因回收站重置");
    }

    #[test]
    fn note_list_pagination_walks_all_pages() {
        let conn = temp_db("pager");
        for i in 0..7 {
            note_upsert(&conn, &draft(&format!("n{i}"), &format!("笔记{i}"), "正文"), 0, 1000 + i).unwrap();
        }
        // 一页 3 条走两轮半；翻页不许重、不许漏（10000 上限不再是隐含契约）
        let mut seen = Vec::new();
        let mut offset = 0;
        loop {
            let page = note_list_scoped(&conn, "active", 3, offset).unwrap();
            let page_len = page.len();
            seen.extend(page.into_iter().map(|n| n.id));
            if page_len < 3 {
                break;
            }
            offset += 3;
        }
        seen.sort();
        let expected: Vec<String> = (0..7).map(|i| format!("n{i}")).collect();
        assert_eq!(seen, expected, "分页遍历恰好覆盖全部 7 条");
        // 越过末页：返回空页而不是错误
        assert!(note_list_scoped(&conn, "active", 3, 9).unwrap().is_empty());
        // 未知范围：显式报错，不静默当成 active
        assert!(note_list_scoped(&conn, "everything", 3, 0).is_err());
    }

    #[test]
    fn restore_upsert_preserves_revision_times_and_deleted_state() {
        let conn = temp_db("restore");
        // KF-003 的原始反例：revision=9、createdAt=1000、isDeleted=true 的包
        let mut pkg = draft("n1", "旧笔记", "恢复前的重要正文");
        pkg.current_revision = 9;
        pkg.created_at = 1000;
        pkg.updated_at = 8000;
        pkg.is_favorite = true;
        pkg.is_deleted = true;
        pkg.deleted_at = Some(8001);

        match note_restore_upsert(&conn, &pkg).unwrap() {
            NoteRestoreOutcome::Created => {}
            other => panic!("期望 Created，得到 {other:?}"),
        }
        let got = note_get(&conn, "n1").unwrap().unwrap();
        assert_eq!(got.current_revision, 9, "修订号不因恢复重置");
        assert_eq!(got.created_at, 1000, "创建时间保留包内值");
        assert_eq!(got.updated_at, 8000, "更新时间保留包内值");
        assert!(got.is_deleted, "回收站内容不因恢复复活");
        assert_eq!(got.deleted_at, Some(8001));
        assert!(got.is_favorite);
        // 删除态不可检索、无分块（索引与状态对齐）
        assert!(search_notes(&conn, "重要正文", None, 10).unwrap().is_empty());
        let chunks: i64 = conn
            .query_row("SELECT COUNT(*) FROM note_chunks WHERE note_id = 'n1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(chunks, 0, "回收站笔记不建分块索引");

        // 活动态 + 修订 9 恢复 → 可检索、有分块，随后编辑产出修订 10
        let mut active = draft("n2", "活动笔记", "活动正文第九版");
        active.current_revision = 9;
        active.created_at = 2000;
        active.updated_at = 9000;
        match note_restore_upsert(&conn, &active).unwrap() {
            NoteRestoreOutcome::Created => {}
            other => panic!("期望 Created，得到 {other:?}"),
        }
        assert_eq!(search_notes(&conn, "活动正文", None, 10).unwrap().len(), 1);
        let chunks: i64 = conn
            .query_row("SELECT COUNT(*) FROM note_chunks WHERE note_id = 'n2'", [], |r| r.get(0))
            .unwrap();
        assert!(chunks > 0, "活动笔记恢复后重建分块索引");

        // 重复恢复（编辑前）：幂等 Current，不产生任何变化
        match note_restore_upsert(&conn, &active).unwrap() {
            NoteRestoreOutcome::Current => {}
            other => panic!("期望 Current，得到 {other:?}"),
        }

        // 恢复后的下一笔编辑从包内修订继续：9 → 10（不从 1 重新计数）
        let out = note_upsert(&conn, &draft("n2", "活动笔记", "恢复后第一次编辑"), 9, 10_000).unwrap();
        assert_eq!(out.revision, 10, "恢复后编辑产生正确的下一修订");
        // 编辑之后再恢复旧包：本地修订 10 > 包内 9，不回退
        match note_restore_upsert(&conn, &active).unwrap() {
            NoteRestoreOutcome::SkippedLocalNewer => {}
            other => panic!("期望 SkippedLocalNewer，得到 {other:?}"),
        }
        assert_eq!(note_get(&conn, "n2").unwrap().unwrap().body_md, "恢复后第一次编辑");
    }

    #[test]
    fn restore_upsert_never_regresses_local_revision() {
        let conn = temp_db("restore-merge");
        note_upsert(&conn, &draft("n1", "本地新版", "本地修订 5 的内容"), 0, 1000).unwrap();
        note_upsert(&conn, &draft("n1", "本地新版", "本地修订 5 的内容（改）"), 1, 2000).unwrap();

        // 包内修订 3 > 本地 2：以包内容覆盖
        let mut pkg_newer = draft("n1", "包内新版", "包内修订 3 的内容");
        pkg_newer.current_revision = 3;
        pkg_newer.created_at = 500;
        pkg_newer.updated_at = 6000;
        match note_restore_upsert(&conn, &pkg_newer).unwrap() {
            NoteRestoreOutcome::Updated => {}
            other => panic!("期望 Updated，得到 {other:?}"),
        }
        let got = note_get(&conn, "n1").unwrap().unwrap();
        assert_eq!(got.current_revision, 3);
        assert_eq!(got.body_md, "包内修订 3 的内容");

        // 包内修订 2 < 本地 3：不回退本地
        let mut pkg_older = draft("n1", "包内旧版", "包内修订 2 的内容");
        pkg_older.current_revision = 2;
        match note_restore_upsert(&conn, &pkg_older).unwrap() {
            NoteRestoreOutcome::SkippedLocalNewer => {}
            other => panic!("期望 SkippedLocalNewer，得到 {other:?}"),
        }
        assert_eq!(note_get(&conn, "n1").unwrap().unwrap().body_md, "包内修订 3 的内容");

        // 修订相同但内容分歧：保守保留本地，等待人工处置
        let mut pkg_divergent = draft("n1", "分歧版", "同修订号不同内容");
        pkg_divergent.current_revision = 3;
        match note_restore_upsert(&conn, &pkg_divergent).unwrap() {
            NoteRestoreOutcome::SkippedDivergent => {}
            other => panic!("期望 SkippedDivergent，得到 {other:?}"),
        }
        assert_eq!(note_get(&conn, "n1").unwrap().unwrap().body_md, "包内修订 3 的内容");
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

    /// 分块向量：保存/召回往返、身份隔离、修订过期不写回、删除不召回。
    #[test]
    fn chunk_embeddings_identity_and_staleness() {
        let conn = temp_db("chunkvec");
        // 两个标题节 → 两个块（只有标题强制分块；小段落会合并）
        let body = "# 检索\n\n关于检索性能的第一段。\n\n# 索引\n\n关于语义索引的第二段，内容足够长以形成独立的分块边界。";
        note_upsert(&conn, &draft("n1", "长文", body), 0, 1000).unwrap();
        let chunks = list_chunk_texts(&conn, 100, "local", "e5-small").unwrap();
        assert_eq!(chunks.len(), 2);

        let items: Vec<_> = chunks
            .iter()
            .enumerate()
            .map(|(i, c)| embedding_item(c, if i == 0 { vec![1.0, 0.0] } else { vec![0.0, 1.0] }))
            .collect();
        assert_eq!(save_note_chunk_embeddings(&conn, &items, "local", "e5-small").unwrap(), 2);
        assert_eq!(save_note_chunk_embeddings(&conn, &items, "local", "e5-small").unwrap(), 0);
        assert!(list_chunk_texts(&conn, 100, "local", "e5-small").unwrap().is_empty());
        assert_eq!(list_chunk_texts(&conn, 100, "local", "other-model").unwrap().len(), 2);

        let query = &items[0].embedding;
        let hits = search_note_chunks_vector(&conn, query, "local", "e5-small", 10).unwrap();
        assert_eq!(hits[0].note_id, "n1");
        assert_eq!(hits[0].chunk_index, 0);
        assert!(hits[0].content.contains("检索性能"), "{:?}", hits[0].content);
        assert!(hits[0].score > 0.9);
        assert!(search_note_chunks_vector(&conn, query, "local", "other-model", 10).unwrap().is_empty());

        // 第 0 块仍存在，但不能把旧正文的向量登记为当前修订。
        note_upsert(&conn, &draft("n1", "长文", "全新的正文，与之前完全不同。"), 1, 2000).unwrap();
        assert_eq!(save_note_chunk_embeddings(&conn, &items, "local", "e5-small").unwrap(), 0);
        assert!(search_note_chunks_vector(&conn, query, "local", "e5-small", 10).unwrap().is_empty());
        let pending = list_chunk_texts(&conn, 100, "local", "e5-small").unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].content_revision, 2);
        let fresh = [embedding_item(&pending[0], vec![1.0, 0.0])];
        assert_eq!(save_note_chunk_embeddings(&conn, &fresh, "local", "e5-small").unwrap(), 1);
        assert_eq!(search_note_chunks_vector(&conn, query, "local", "e5-small", 10).unwrap()[0].content,
            "全新的正文，与之前完全不同。");
        note_delete(&conn, "n1", 3000).unwrap();
        assert_eq!(save_note_chunk_embeddings(&conn, &fresh, "local", "other-model").unwrap(), 0);
        assert!(search_note_chunks_vector(&conn, query, "local", "e5-small", 10).unwrap().is_empty());
    }

    fn embedding_item(chunk: &NoteChunkText, embedding: Vec<f32>) -> NoteChunkEmbeddingItem {
        NoteChunkEmbeddingItem {
            note_id: chunk.note_id.clone(), chunk_index: chunk.chunk_index,
            content_revision: chunk.content_revision, embedding,
        }
    }

    #[test]
    fn chunk_commands_keep_same_note_id_isolated_between_libraries() {
        let root = env::temp_dir().join(format!("kf-chunk-roots-{}", uuid::Uuid::new_v4()));
        let a = root.join("a");
        let b = root.join("b");
        let dir_a = Some(a.to_string_lossy().into_owned());
        let dir_b = Some(b.to_string_lossy().into_owned());
        for (dir, body) in [(&a, "alpha island"), (&b, "beta island")] {
            let conn = crate::db::open_db(&dir.join("knowflick.db")).unwrap();
            note_upsert(&conn, &draft("same-id", "同名笔记", body), 0, 1000).unwrap();
            project_create(&conn, "same-project", "同名项目", "", 1000).unwrap();
            project_add_note(&conn, "same-project", "same-id", 1000).unwrap();
        }

        let limit = Some(1);
        let provider = Some("local".to_owned());
        let model = Some("isolation".to_owned());
        assert!(crate::note_search_chunks(dir_b.clone(), "alpha".into(), limit).unwrap().is_empty());
        let fts = crate::note_search_chunks(dir_a.clone(), "alpha".into(), limit).unwrap();
        assert_eq!(fts[0].content, "alpha island");
        let pending = crate::note_list_chunk_texts(dir_a.clone(), limit, provider.clone(), model.clone()).unwrap();
        assert_eq!(pending[0].content, "alpha island");
        let query = vec![1.0, 0.0];
        assert_eq!(crate::note_save_chunk_embeddings(
            dir_a.clone(), vec![embedding_item(&pending[0], query.clone())], provider.clone(), model.clone(),
        ).unwrap(), 1);

        let vector = |dir, project: &str| crate::note_search_chunks_vector(
            dir, query.clone(), provider.clone(), model.clone(), limit, Some(project.into()),
        ).unwrap();
        assert_eq!(vector(dir_a.clone(), "same-project")[0].content, "alpha island");
        assert!(vector(dir_a.clone(), "missing-project").is_empty());
        assert!(vector(dir_b.clone(), "same-project").is_empty());
        assert!(crate::note_list_chunk_texts(dir_a.clone(), limit, provider.clone(), model.clone()).unwrap().is_empty());
        let pending_b = crate::note_list_chunk_texts(dir_b, limit, provider.clone(), model.clone()).unwrap();
        assert_eq!(pending_b[0].content, "beta island");

        // 老版缓存无可信修订；模拟升级，只移除缓存且只执行一次。
        let conn = crate::db::open_db(&a.join("knowflick.db")).unwrap();
        conn.execute("DELETE FROM meta WHERE key = 'note_chunk_revision_verified'", []).unwrap();
        drop(conn);
        assert!(vector(dir_a.clone(), "same-project").is_empty());
        let conn = crate::db::open_db(&a.join("knowflick.db")).unwrap();
        let chunks = list_chunk_texts(&conn, 1, "local", "isolation").unwrap();
        assert_eq!(save_note_chunk_embeddings(&conn, &[embedding_item(&chunks[0], query.clone())], "local", "isolation").unwrap(), 1);
        drop(conn);
        assert_eq!(vector(dir_a, "same-project")[0].content, "alpha island");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn chunk_vector_search_respects_active_project_membership_before_limit() {
        let conn = temp_db("chunk-project-scope");
        note_upsert(&conn, &draft("note-a", "项目甲笔记", "scope retrieval notes for project alpha"), 0, 1000).unwrap();
        note_upsert(&conn, &draft("note-b", "项目乙笔记", "scope retrieval notes for project beta"), 0, 1000).unwrap();
        project_create(&conn, "project-a", "项目甲", "", 1000).unwrap();
        project_create(&conn, "project-b", "项目乙", "", 1000).unwrap();
        project_add_note(&conn, "project-a", "note-a", 1000).unwrap();
        project_add_note(&conn, "project-b", "note-b", 1000).unwrap();

        let chunks = list_chunk_texts(&conn, 100, "local", "scope-test").unwrap();
        let embeddings: Vec<_> = chunks.iter().map(|chunk| {
            let vector = if chunk.note_id == "note-a" { vec![1.0, 0.0] } else { vec![0.0, 1.0] };
            embedding_item(chunk, vector)
        }).collect();
        assert_eq!(save_note_chunk_embeddings(&conn, &embeddings, "local", "scope-test").unwrap(), 2);

        let hits = search_note_chunks_vector_scoped(&conn, &[0.0, 1.0], "local", "scope-test", 1, Some("project-a")).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].note_id, "note-a", "项目范围过滤应先于向量排名与 limit");
        assert_eq!(search_note_chunks_vector_scoped(&conn, &[0.0, 1.0], "local", "scope-test", 10, Some("project-b")).unwrap()[0].note_id, "note-b");
        assert_eq!(search_note_chunks_vector(&conn, &[0.0, 1.0], "local", "scope-test", 10).unwrap().len(), 2);

        project_archive(&conn, "project-a", 2000).unwrap();
        assert!(search_note_chunks_vector_scoped(&conn, &[0.0, 1.0], "local", "scope-test", 10, Some("project-a")).unwrap().is_empty());
    }

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

// ---------- 分块向量（R2 向量化分块：块级语义召回） ----------

/// 待嵌入的分块清单：内容 + 写入时的修订号（回传保存时做一致性校验）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteChunkText {
    pub note_id: String,
    pub chunk_index: i64,
    pub content: String,
    pub content_revision: i64,
}

/// 跳过当前模型已完成的块，避免每批重复索引最近的同一组笔记。
pub fn list_chunk_texts(conn: &Connection, limit: i64, provider: &str, model: &str) -> Result<Vec<NoteChunkText>> {
    let mut stmt = conn.prepare(
        "SELECT n.note_id, n.chunk_index, n.content, n.content_revision
         FROM note_chunks n JOIN notes n2 ON n2.id = n.note_id
         WHERE n2.is_deleted = 0 AND NOT EXISTS (
             SELECT 1 FROM note_chunk_embeddings e
             WHERE e.note_id = n.note_id AND e.chunk_index = n.chunk_index
               AND e.content_revision = n.content_revision AND e.provider = ?2 AND e.model = ?3
         )
         ORDER BY n2.updated_at DESC, n.note_id, n.chunk_index LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit, provider, model], |row| {
        Ok(NoteChunkText {
            note_id: row.get(0)?,
            chunk_index: row.get(1)?,
            content: row.get(2)?,
            content_revision: row.get(3)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

#[derive(Deserialize)]
pub struct NoteChunkEmbeddingItem {
    pub note_id: String,
    pub chunk_index: i64,
    pub content_revision: i64,
    pub embedding: Vec<f32>,
}

/// 在写入语句内核对读取时的修订号，避免检查后、写入前发生编辑。
pub fn save_note_chunk_embeddings(
    conn: &Connection,
    items: &[NoteChunkEmbeddingItem],
    provider: &str,
    model: &str,
) -> Result<usize, String> {
    let now = crate::db::chrono_or_epoch_now();
    let mut saved = 0usize;
    for NoteChunkEmbeddingItem { note_id, chunk_index, content_revision, embedding } in items {
        if embedding.is_empty() || embedding.iter().any(|value| !value.is_finite()) {
            continue;
        }
        let mut bytes = Vec::with_capacity(embedding.len() * 4);
        for &val in embedding {
            bytes.extend_from_slice(&val.to_le_bytes());
        }
        saved += conn.execute(
            r#"
            INSERT INTO note_chunk_embeddings (note_id, chunk_index, dim, embedding, provider, model, content_revision, updated_at)
            SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
            FROM note_chunks n JOIN notes n2 ON n2.id = n.note_id
            WHERE n.note_id = ?1 AND n.chunk_index = ?2 AND n.content_revision = ?7 AND n2.is_deleted = 0
            ON CONFLICT(note_id, chunk_index) DO UPDATE SET
                dim = excluded.dim,
                embedding = excluded.embedding,
                provider = excluded.provider,
                model = excluded.model,
                content_revision = excluded.content_revision,
                updated_at = excluded.updated_at
            WHERE content_revision != excluded.content_revision OR provider != excluded.provider
               OR model != excluded.model OR dim != excluded.dim
            "#,
            params![note_id, chunk_index, embedding.len() as i64, bytes, provider, model, content_revision, now],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(saved)
}

/// 块级向量召回：命中块带父笔记标题与原文偏移。
/// 只比同 (provider, model, dim) 且 **嵌入的 content_revision == 分块的
/// content_revision** 的向量——笔记被编辑过、分块重建后，旧向量不参与召回。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteChunkVectorHit {
    pub note_id: String,
    pub chunk_index: i64,
    pub content: String,
    pub char_start: i64,
    pub char_end: i64,
    pub note_title: String,
    pub score: f32,
}

pub fn search_note_chunks_vector(
    conn: &Connection,
    query_embedding: &[f32],
    provider: &str,
    model: &str,
    limit: i64,
) -> Result<Vec<NoteChunkVectorHit>, String> {
    search_note_chunks_vector_scoped(conn, query_embedding, provider, model, limit, None)
}

pub fn search_note_chunks_vector_scoped(
    conn: &Connection,
    query_embedding: &[f32],
    provider: &str,
    model: &str,
    limit: i64,
    project_id: Option<&str>,
) -> Result<Vec<NoteChunkVectorHit>, String> {
    if query_embedding.is_empty() {
        return Ok(Vec::new());
    }
    let mut scored: Vec<(String, i64, f32)> = Vec::new();
    {
        let mut stmt = conn.prepare(
            "SELECT e.note_id, e.chunk_index, e.embedding
             FROM note_chunk_embeddings e
             JOIN note_chunks n ON n.note_id = e.note_id AND n.chunk_index = e.chunk_index
             JOIN notes n2 ON n2.id = e.note_id
             WHERE n2.is_deleted = 0 AND e.dim = ?1 AND e.provider = ?2 AND e.model = ?3
               AND e.content_revision = n.content_revision
               AND (?4 IS NULL OR EXISTS (
                   SELECT 1 FROM project_members scope_member
                   JOIN projects scope_project ON scope_project.id = scope_member.project_id
                   WHERE scope_member.note_id = n2.id
                     AND scope_project.archived_at IS NULL
                     AND scope_project.id = ?4
               ))",
        )
        .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![query_embedding.len() as i64, provider, model, project_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, Vec<u8>>(2)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (note_id, chunk_index, bytes) = row.map_err(|e| e.to_string())?;
            if bytes.len() % 4 != 0 {
                continue;
            }
            let mut vector = Vec::with_capacity(bytes.len() / 4);
            for chunk in bytes.chunks_exact(4) {
                vector.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
            }
            scored.push((note_id, chunk_index, crate::db::cosine_similarity(query_embedding, &vector)));
        }
    }
    scored.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(limit as usize);

    let mut out = Vec::new();
    for (note_id, chunk_index, score) in scored {
        let row = conn
            .query_row(
                "SELECT n.content, n.char_start, n.char_end, n2.title
                 FROM note_chunks n JOIN notes n2 ON n2.id = n.note_id
                 WHERE n.note_id = ?1 AND n.chunk_index = ?2 AND n2.is_deleted = 0
                   AND (?3 IS NULL OR EXISTS (
                       SELECT 1 FROM project_members scope_member
                       JOIN projects scope_project ON scope_project.id = scope_member.project_id
                       WHERE scope_member.note_id = n2.id
                         AND scope_project.archived_at IS NULL
                         AND scope_project.id = ?3
                   ))",
                params![note_id, chunk_index, project_id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, i64>(1)?,
                        r.get::<_, i64>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some((content, char_start, char_end, title)) = row {
            out.push(NoteChunkVectorHit {
                note_id,
                chunk_index,
                content,
                char_start,
                char_end,
                note_title: title,
                score,
            });
        }
    }
    Ok(out)
}

// ---------- 项目记忆（R4/D06 最小闭环） ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDto {
    pub id: String,
    pub name: String,
    pub description: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub archived_at: Option<i64>,
}

pub fn project_create(conn: &Connection, id: &str, name: &str, description: &str, now: i64) -> Result<usize, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("项目名不能为空".to_string());
    }
    let dup: i64 = conn
        .query_row("SELECT COUNT(*) FROM projects WHERE name = ?1", params![name], |r| r.get(0))
        .unwrap_or(0);
    if dup > 0 {
        return Err(format!("已有名为「{name}」的项目"));
    }
    conn.execute(
        "INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, name, description, now],
    )
    .map_err(|e| e.to_string())
}

pub fn project_list(conn: &Connection, include_archived: bool) -> Result<Vec<ProjectDto>> {
    let sql = if include_archived {
        "SELECT id, name, description, created_at, updated_at, archived_at FROM projects ORDER BY created_at ASC"
    } else {
        "SELECT id, name, description, created_at, updated_at, archived_at FROM projects WHERE archived_at IS NULL ORDER BY created_at ASC"
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |row| {
        Ok(ProjectDto {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
            archived_at: row.get(5)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// 幂等加入（与 kb_add_note 同语义：重复加入不报错、不重复行）。
pub fn project_add_note(conn: &Connection, project_id: &str, note_id: &str, now: i64) -> Result<usize, String> {
    let exists: i64 = conn
        .query_row("SELECT COUNT(*) FROM projects WHERE id = ?1", params![project_id], |r| r.get(0))
        .unwrap_or(0);
    if exists == 0 {
        return Err("项目不存在".to_string());
    }
    let note: i64 = conn
        .query_row("SELECT COUNT(*) FROM notes WHERE id = ?1", params![note_id], |r| r.get(0))
        .unwrap_or(0);
    if note == 0 {
        return Err("笔记不存在".to_string());
    }
    conn.execute(
        "INSERT INTO project_members (project_id, note_id, added_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(project_id, note_id) DO NOTHING",
        params![project_id, note_id, now],
    )
    .map_err(|e| e.to_string())
}

pub fn project_remove_note(conn: &Connection, project_id: &str, note_id: &str) -> Result<()> {
    conn.execute("DELETE FROM project_members WHERE project_id = ?1 AND note_id = ?2", params![project_id, note_id])?;
    Ok(())
}

/// 全部项目的成员关系索引（笔记 id → 项目 id）。
///
/// 为什么要有这个：`project_member_list` 只列**一个**项目的成员，
/// 而「这条提醒属于哪个项目」是跨项目的问题——限定项目范围时需要
/// 把笔记反查回项目。逐个项目去问会得到 N 次调用且顺序敏感，
/// 一次拿全量索引更简单，也和界面读到的项目列表对得上。
///
/// 封存项目的成员**不在索引里**：封存的项目不再参与其它上下文，
/// 把封存内容算进「项目范围」等于让用户以为它还活跃。
/// 一篇笔记可以属于多个项目，每条成员关系都必须保留。
pub fn project_member_index(conn: &Connection) -> Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT pm.note_id, pm.project_id
         FROM project_members pm
         JOIN projects p ON p.id = pm.project_id
         WHERE p.archived_at IS NULL
         ORDER BY pm.note_id, pm.project_id",
    )?;
    let rows = stmt.query_map(params![], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    rows.collect()
}

/// 封存：不删数据，导出与检索跳过（「过期项目不继续污染其它项目上下文」）。
/// 项目的一个成员笔记（供界面列出项目的上下文范围）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMemberDto {
    pub note_id: String,
    pub title: String,
    /// 正文摘录（界面显示用；导出仍取全文）。
    pub excerpt: String,
    pub added_at: i64,
    /// 成员笔记已被软删 —— 成员关系保留，但内容不再进导出。
    pub is_deleted: bool,
}

/// 列出某项目的成员笔记（R4/D06 界面入口）。
///
/// 只列**这一个**项目的成员——项目之间的上下文是隔离的：
/// 界面打开项目 A 时看不到项目 B 的成员，导出也只走所选项目（R4 门槛
/// 「项目 A 无权读取项目 B」）。
pub fn project_member_list(conn: &Connection, project_id: &str) -> Result<Vec<ProjectMemberDto>> {
    let mut stmt = conn.prepare(
        "SELECT n.id, n.title, n.body_md, pm.added_at, n.is_deleted
         FROM project_members pm
         JOIN notes n ON n.id = pm.note_id
         WHERE pm.project_id = ?1
         ORDER BY pm.added_at ASC",
    )?;
    let rows = stmt.query_map(params![project_id], |row| {
        let body: String = row.get(2)?;
        let flat = body.replace(char::is_whitespace, " ");
        let excerpt: String = flat.chars().take(80).collect();
        Ok(ProjectMemberDto {
            note_id: row.get(0)?,
            title: row.get(1)?,
            excerpt,
            added_at: row.get(3)?,
            is_deleted: row.get::<_, i64>(4)? != 0,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn project_archive(conn: &Connection, project_id: &str, now: i64) -> Result<bool> {
    let changed = conn.execute(
        "UPDATE projects SET archived_at = ?2, updated_at = ?2 WHERE id = ?1 AND archived_at IS NULL",
        params![project_id, now],
    )?;
    Ok(changed > 0)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectExportSnapshot {
    pub project: ProjectDto,
    pub members: Vec<NoteDto>,
}

/// The read transaction binds the project state and member contents to one snapshot.
pub fn project_export_snapshot(conn: &Connection, project_id: &str) -> Result<ProjectExportSnapshot, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let project = tx.query_row(
        "SELECT id, name, description, created_at, updated_at, archived_at FROM projects WHERE id = ?1",
        params![project_id],
        |row| Ok(ProjectDto {
            id: row.get(0)?, name: row.get(1)?, description: row.get(2)?,
            created_at: row.get(3)?, updated_at: row.get(4)?, archived_at: row.get(5)?,
        }),
    ).optional().map_err(|e| e.to_string())?.ok_or_else(|| "项目不存在".to_string())?;
    if project.archived_at.is_some() {
        return Err(format!("项目「{}」已封存，禁止导出技能包", project.name));
    }
    let members = {
        let mut stmt = tx.prepare(&format!(
            "SELECT {NOTE_COLUMNS} FROM notes WHERE is_deleted = 0 AND id IN
             (SELECT note_id FROM project_members WHERE project_id = ?1) ORDER BY id"
        )).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![project_id], map_note_row).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>>>().map_err(|e| e.to_string())?
    };
    tx.commit().map_err(|e| e.to_string())?;
    Ok(ProjectExportSnapshot { project, members })
}

/// 按项目导出 Markdown 上下文（E07 第一步：给外部 AI 工具的项目记忆包）。
/// 含项目说明 + 成员笔记全文（未删除的）+ 来源清单（note 的 source_material
/// 可回溯处）。封存项目导出返回错误（不悄悄导旧上下文）。
pub fn project_export_markdown(conn: &Connection, project_id: &str) -> Result<String, String> {
    let project = conn
        .query_row(
            "SELECT name, description, archived_at FROM projects WHERE id = ?1",
            params![project_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<i64>>(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "项目不存在".to_string())?;
    if project.2.is_some() {
        return Err(format!("项目「{}」已封存——封存的项目不导出（避免旧上下文继续污染）。如需导出请先解除封存", project.0));
    }

    let mut stmt = conn
        .prepare(
            "SELECT n.title, n.body_md, n.source_material_id
             FROM project_members pm
             JOIN notes n ON n.id = pm.note_id
             WHERE pm.project_id = ?1 AND n.is_deleted = 0
             ORDER BY pm.added_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?))
        })
        .map_err(|e| e.to_string())?;
    let mut notes = Vec::new();
    for r in rows {
        notes.push(r.map_err(|e| e.to_string())?);
    }

    let mut out = String::new();
    out.push_str(&format!("# 项目：{}\n\n", project.0));
    if !project.1.is_empty() {
        out.push_str(&format!("{}\n\n", project.1));
    }
    out.push_str(&format!("导出时间：{} ｜ 成员笔记 {} 篇\n\n---\n\n", chrono_date_label(), notes.len()));
    for (i, (title, body, source)) in notes.iter().enumerate() {
        out.push_str(&format!("## 笔记 {}：{}\n\n{}\n\n", i + 1, title, body));
        if let Some(material_id) = source {
            out.push_str(&format!("（来源素材：{material_id}，可在应用中回溯原文）\n\n"));
        }
        out.push_str("---\n\n");
    }
    Ok(out)
}

fn chrono_date_label() -> String {
    let now = crate::db::chrono_or_epoch_now();
    let (y, m, d) = crate::civil_from_days(now / 1000 / 86400);
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
mod project_tests {
    use super::*;
    use crate::db::init_tables;
    use std::env;
    use std::path::PathBuf;

    fn temp_db(tag: &str) -> Connection {
        let dir: PathBuf = env::temp_dir().join(format!("kf-proj-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = crate::db::open_db(&dir.join("knowflick.db")).unwrap();
        init_tables(&conn).unwrap();
        conn
    }

    fn draft(id: &str, title: &str, body: &str) -> NoteDto {
        NoteDto { id: id.to_string(), title: title.to_string(), body_md: body.to_string(), ..Default::default() }
    }

    #[test]
    fn project_lifecycle_idempotent_membership_and_export() {
        let conn = temp_db("lifecycle");
        note_upsert(&conn, &draft("n1", "决策A", "选了 SQLite 而不是 PG"), 0, 1000).unwrap();
        note_upsert(&conn, &draft("n2", "约束", "无我方云依赖"), 0, 1100).unwrap();
        project_create(&conn, "p1", "北极星", "检索与笔记", 1200).unwrap();

        // 同名拒绝、空名拒绝
        assert!(project_create(&conn, "p2", "北极星", "", 1300).is_err());
        assert!(project_create(&conn, "p3", "  ", "", 1300).is_err());

        // 幂等加入
        project_add_note(&conn, "p1", "n1", 1300).unwrap();
        project_add_note(&conn, "p1", "n1", 1400).unwrap();
        project_add_note(&conn, "p1", "n2", 1400).unwrap();
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM project_members", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 2, "重复加入不重复行");
        assert!(project_add_note(&conn, "ghost", "n1", 1500).is_err(), "不存在的项目报中文错");
        assert!(project_add_note(&conn, "p1", "ghost", 1500).is_err(), "不存在的笔记报中文错");

        // 默认列表只有未封存
        assert_eq!(project_list(&conn, false).unwrap().len(), 1);

        // 导出：项目说明 + 成员全文 + 来源可回溯
        let md = project_export_markdown(&conn, "p1").unwrap();
        assert!(md.contains("# 项目：北极星"), "{md}");
        assert!(md.contains("选了 SQLite 而不是 PG"), "成员笔记全文进上下文");
        assert!(md.contains("无我方云依赖"));
        assert!(md.contains("成员笔记 2 篇"));

        // 移除成员后导出不再包含
        project_remove_note(&conn, "p1", "n2").unwrap();
        let md2 = project_export_markdown(&conn, "p1").unwrap();
        assert!(!md2.contains("无我方云依赖"));

        // 封存后：默认列表消失、导出明确拒绝（不悄悄导旧上下文）
        assert!(project_archive(&conn, "p1", 1600).unwrap());
        assert!(project_list(&conn, false).unwrap().is_empty());
        assert_eq!(project_list(&conn, true).unwrap().len(), 1, "include_archived 能看到");
        let err = project_export_markdown(&conn, "p1").unwrap_err();
        assert!(err.contains("已封存") && err.contains("不导出"), "{err}");

        // 不存在的项目
        assert!(project_export_markdown(&conn, "ghost").is_err());
    }

    #[test]
    fn project_member_list_is_scoped_to_one_project() {
        let conn = temp_db("member-list");
        note_upsert(&conn, &draft("n1", "项目 A 的笔记", "A 的内容"), 0, 1000).unwrap();
        note_upsert(&conn, &draft("n2", "项目 B 的笔记", "B 的内容"), 0, 1100).unwrap();
        project_create(&conn, "pa", "项目 A", "", 1200).unwrap();
        project_create(&conn, "pb", "项目 B", "", 1200).unwrap();
        project_add_note(&conn, "pa", "n1", 1300).unwrap();
        project_add_note(&conn, "pb", "n2", 1300).unwrap();

        // 项目 A 只看得到自己的成员（R4 门槛：项目 A 无权读取项目 B）
        let a_members = project_member_list(&conn, "pa").unwrap();
        assert_eq!(a_members.len(), 1);
        assert_eq!(a_members[0].note_id, "n1");
        assert_eq!(a_members[0].title, "项目 A 的笔记");
        assert!(a_members[0].excerpt.contains("A 的内容"));
        assert!(!a_members[0].is_deleted);
        assert!(a_members[0].added_at == 1300);

        let b_members = project_member_list(&conn, "pb").unwrap();
        assert_eq!(b_members.len(), 1);
        assert_eq!(b_members[0].note_id, "n2");

        // 不存在的项目：空集而不是错误（界面据此显示「还没有成员」）
        assert!(project_member_list(&conn, "ghost").unwrap().is_empty());

        // 成员笔记被软删：成员关系保留，但标出已删除（界面能提示，不当它还在）
        note_delete(&conn, "n1", 2000).unwrap();
        let after = project_member_list(&conn, "pa").unwrap();
        assert_eq!(after.len(), 1);
        assert!(after[0].is_deleted, "已删的成员笔记标出来");
    }

    #[test]
    fn deleted_member_note_is_excluded_from_export() {
        let conn = temp_db("deleted-member");
        note_upsert(&conn, &draft("n1", "标题", "正文"), 0, 1000).unwrap();
        project_create(&conn, "p1", "P", "", 1100).unwrap();
        project_add_note(&conn, "p1", "n1", 1200).unwrap();
        note_delete(&conn, "n1", 1300).unwrap();
        let md = project_export_markdown(&conn, "p1").unwrap();
        assert!(!md.contains("正文"), "软删的成员笔记不进导出");
        assert!(md.contains("成员笔记 0 篇"));
    }

    #[test]
    fn project_export_snapshot_scoped_membership_and_archive_guard() {
        let conn = temp_db("export-snapshot");
        note_upsert(&conn, &draft("n1", "项目A决策", "采用Tauri"), 0, 1000).unwrap();
        note_upsert(&conn, &draft("n2", "项目B记录", "别的机密"), 0, 1050).unwrap();
        note_upsert(&conn, &draft("n3", "项目A已删", "过时信息"), 0, 1100).unwrap();

        project_create(&conn, "p_a", "项目A", "说明A", 1200).unwrap();
        project_create(&conn, "p_b", "项目B", "说明B", 1250).unwrap();

        project_add_note(&conn, "p_a", "n1", 1300).unwrap();
        project_add_note(&conn, "p_a", "n3", 1320).unwrap();
        project_add_note(&conn, "p_b", "n2", 1350).unwrap();

        // 软删成员 n3
        note_delete(&conn, "n3", 1400).unwrap();

        // 项目A快照：只含自身成员且排除已删除
        let snap_a = project_export_snapshot(&conn, "p_a").unwrap();
        assert_eq!(snap_a.project.id, "p_a");
        assert_eq!(snap_a.project.name, "项目A");
        assert_eq!(snap_a.members.len(), 1);
        assert_eq!(snap_a.members[0].id, "n1");
        assert_eq!(snap_a.members[0].body_md, "采用Tauri");

        // 项目B快照：只有项目B成员，不能串入项目A
        let snap_b = project_export_snapshot(&conn, "p_b").unwrap();
        assert_eq!(snap_b.members.len(), 1);
        assert_eq!(snap_b.members[0].id, "n2");

        // 封存项目拒绝导出快照
        project_archive(&conn, "p_a", 1500).unwrap();
        assert!(project_export_snapshot(&conn, "p_a").is_err());
    }

    /// 项目归属索引：复盘限定项目范围时用来把笔记反查回项目。
    ///
    /// 关键语义：封存项目不在索引里（封存 = 不再参与其它上下文）；
    /// 一篇笔记属于多个项目时每条关系都返回。
    #[test]
    fn project_member_index_maps_notes_to_active_projects() {
        let conn = temp_db("member-index");
        note_upsert(&conn, &draft("n1", "共享笔记", "内容"), 0, 1000).unwrap();
        note_upsert(&conn, &draft("n2", "封存里的笔记", "内容"), 0, 1000).unwrap();

        project_create(&conn, "pa", "项目A", "", 1100).unwrap();
        project_create(&conn, "pb", "项目B", "", 1100).unwrap();
        project_create(&conn, "pc", "封存项目", "", 1100).unwrap();

        project_add_note(&conn, "pa", "n1", 1200).unwrap();
        project_add_note(&conn, "pb", "n1", 1300).unwrap();
        project_add_note(&conn, "pc", "n2", 1200).unwrap();

        let index = project_member_index(&conn).unwrap();
        assert!(index.iter().any(|(n, p)| n == "n1" && p == "pa"));
        assert!(index.iter().any(|(n, p)| n == "n1" && p == "pb"));
        assert!(
            index.iter().any(|(n, p)| n == "n2" && p == "pc"),
            "未封存项目的成员在索引里"
        );

        // 封存项目后，它的成员不再有归属
        project_archive(&conn, "pc", 1400).unwrap();
        let after = project_member_index(&conn).unwrap();
        assert!(
            !after.iter().any(|(n, _)| n == "n2"),
            "封存项目的成员不该出现在归属索引里"
        );

        // n1 同时属于未封存的 A 与已封存的 B → 只保留 A
        project_archive(&conn, "pb", 1500).unwrap();
        let after2 = project_member_index(&conn).unwrap();
        assert_eq!(
            after2.iter().find(|(n, _)| n == "n1").map(|(_, p)| p.as_str()),
            Some("pa"),
            "封存掉最近加入的项目后，归属回落到仍在的那个"
        );
        assert!(!after2.iter().any(|(n, p)| n == "n1" && p == "pb"));
    }
}

// ---------- 个人画像（R4/D05：可治理的声明 + 阻止同源重建） ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileClaimDto {
    pub id: String,
    pub kind: String,
    pub content: String,
    pub evidence_json: String,
    pub scope: String,
    pub created_at: i64,
    pub confirmed_at: Option<i64>,
    pub expires_at: Option<i64>,
    pub denied_at: Option<i64>,
    pub superseded_by: Option<String>,
    pub status: String,
}

fn map_claim_row(row: &rusqlite::Row<'_>) -> Result<ProfileClaimDto> {
    Ok(ProfileClaimDto {
        id: row.get(0)?,
        kind: row.get(1)?,
        content: row.get(2)?,
        evidence_json: row.get(3)?,
        scope: row.get(4)?,
        created_at: row.get(5)?,
        confirmed_at: row.get(6)?,
        expires_at: row.get(7)?,
        denied_at: row.get(8)?,
        superseded_by: row.get(9)?,
        status: row.get(10)?,
    })
}

const CLAIM_COLUMNS: &str =
    "id, kind, content, evidence_json, scope, created_at, confirmed_at, expires_at, denied_at, superseded_by, status";

/// 证据集合 → 稳定指纹（排序后 SHA-256 前 16 字节）：同源证据认得出。
fn evidence_fingerprint(evidence_json: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut ids: Vec<String> = serde_json::from_str::<Vec<String>>(evidence_json)
        .unwrap_or_default();
    ids.sort();
    let canonical = serde_json::to_string(&ids).unwrap_or_default();
    let digest = Sha256::digest(canonical.as_bytes());
    let mut head = [0u8; 8];
    head.copy_from_slice(&digest[..8]);
    format!("{:016x}", u64::from_be_bytes(head))
}

/// 新增声明。**被否认过的证据源不得重建**——同指纹在 profile_denials
/// 里就直接拒绝（路线图：删除应生成阻止同源旧证据自动重建的标记）。
pub fn claim_add(conn: &Connection, claim: &ProfileClaimDto, now: i64) -> Result<usize, String> {
    let fp = evidence_fingerprint(&claim.evidence_json);
    let denied: i64 = conn
        .query_row("SELECT COUNT(*) FROM profile_denials WHERE evidence_fingerprint = ?1", params![fp], |r| r.get(0))
        .unwrap_or(0);
    if denied > 0 {
        return Err("这条声明的证据源已被否认过——不自动重建。如需重新学习，请先在画像里清除该否认".to_string());
    }
    conn.execute(
        "INSERT INTO profile_claims (id, kind, content, evidence_json, scope, created_at, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active')",
        params![claim.id, claim.kind, claim.content, claim.evidence_json, claim.scope, now],
    )
    .map_err(|e| e.to_string())
}

/// 只列有效声明：未否认、未过期、未暂停（回答与建议的可用记忆）。
pub fn claim_list_active(conn: &Connection, now: i64) -> Result<Vec<ProfileClaimDto>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {CLAIM_COLUMNS} FROM profile_claims
         WHERE denied_at IS NULL
           AND status = 'active'
           AND (expires_at IS NULL OR expires_at > ?1)
           AND superseded_by IS NULL
         ORDER BY created_at DESC"
    ))?;
    let rows = stmt.query_map(params![now], map_claim_row)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// 治理界面读取全部仍保留的声明，包括暂停、否认、过期和已被修正取代的记录。
pub fn claim_list_all(conn: &Connection) -> Result<Vec<ProfileClaimDto>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {CLAIM_COLUMNS} FROM profile_claims ORDER BY created_at DESC"
    ))?;
    let rows = stmt.query_map([], map_claim_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// 全局问答可以使用的个人记忆：必须已确认、仍生效、未过期、未否认且未被取代。
/// 项目范围记忆必须由带项目选择器的消费端另行显式筛选，不能进入全局问答。
pub fn claim_list_for_answer(conn: &Connection, now: i64) -> Result<Vec<ProfileClaimDto>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {CLAIM_COLUMNS} FROM profile_claims
         WHERE confirmed_at IS NOT NULL
           AND denied_at IS NULL
           AND status = 'active'
           AND scope = 'global'
           AND (expires_at IS NULL OR expires_at > ?1)
           AND superseded_by IS NULL
         ORDER BY created_at DESC"
    ))?;
    let rows = stmt.query_map(params![now], map_claim_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// 项目问答只列所选且仍活跃项目的记忆；项目 ID 无效或已封存时失败关闭。
pub fn claim_list_for_project_answer(
    conn: &Connection,
    now: i64,
    project_id: &str,
) -> Result<Vec<ProfileClaimDto>, String> {
    let active: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1 AND archived_at IS NULL)",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !active {
        return Err("所选项目不存在或已封存".to_string());
    }
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {CLAIM_COLUMNS} FROM profile_claims
             WHERE confirmed_at IS NOT NULL
               AND denied_at IS NULL
               AND status = 'active'
               AND scope = ?2
               AND (expires_at IS NULL OR expires_at > ?1)
               AND superseded_by IS NULL
             ORDER BY created_at DESC"
        ))
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(params![now, project_id], map_claim_row)
        .map_err(|error| error.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|error| error.to_string())?);
    }
    Ok(out)
}

/// 用户确认事实（fact 类从推测转正）。
pub fn claim_confirm(conn: &Connection, id: &str, now: i64) -> Result<bool> {
    let changed = conn.execute(
        "UPDATE profile_claims SET confirmed_at = ?2 WHERE id = ?1 AND denied_at IS NULL",
        params![id, now],
    )?;
    Ok(changed > 0)
}

/// 暂停学习/使用（不删数据，恢复 = 再调 resume）。
pub fn claim_pause(conn: &Connection, id: &str) -> Result<bool> {
    let changed = conn.execute(
        "UPDATE profile_claims SET status = 'paused' WHERE id = ?1",
        params![id],
    )?;
    Ok(changed > 0)
}

pub fn claim_resume(conn: &Connection, id: &str) -> Result<bool> {
    let changed = conn.execute(
        "UPDATE profile_claims SET status = 'active' WHERE id = ?1",
        params![id],
    )?;
    Ok(changed > 0)
}

/// 否认 + 阻止同源重建：denied_at 标记本条，证据指纹写进 profile_denials。
pub fn claim_deny(conn: &Connection, id: &str, now: i64) -> Result<bool, String> {
    let evidence: Option<String> = conn
        .query_row("SELECT evidence_json FROM profile_claims WHERE id = ?1", params![id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(evidence_json) = evidence else { return Ok(false) };
    let fp = evidence_fingerprint(&evidence_json);
    conn.execute(
        "UPDATE profile_claims SET denied_at = ?2 WHERE id = ?1 AND denied_at IS NULL",
        params![id, now],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO profile_denials (evidence_fingerprint, denied_at) VALUES (?1, ?2)",
        params![fp, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(true)
}

/// 删除 = 否认 + 物理移除声明（否认指纹保留，防同源重建）。
pub fn claim_delete(conn: &Connection, id: &str, now: i64) -> Result<bool, String> {
    let denied = claim_deny(conn, id, now)?;
    if !denied {
        return Ok(false);
    }
    conn.execute("DELETE FROM profile_claims WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    Ok(true)
}

/// 清除某证据源的否认（用户主动允许重新学习）。
pub fn denial_clear_by_evidence(conn: &Connection, evidence_json: &str) -> Result<bool> {
    let fp = evidence_fingerprint(evidence_json);
    let changed = conn.execute("DELETE FROM profile_denials WHERE evidence_fingerprint = ?1", params![fp])?;
    Ok(changed > 0)
}

#[cfg(test)]
mod profile_tests {
    use super::*;

    fn temp_db(tag: &str) -> Connection {
        let dir = std::env::temp_dir().join(format!("kf-profile-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = crate::db::open_db(&dir.join("knowflick.db")).unwrap();
        conn
    }

    fn claim(id: &str, evidence: &[&str]) -> ProfileClaimDto {
        ProfileClaimDto {
            id: id.to_string(),
            kind: "inference".to_string(),
            content: "用户在做检索方向的工作".to_string(),
            evidence_json: serde_json::to_string(&evidence.iter().map(|s| s.to_string()).collect::<Vec<_>>()).unwrap(),
            scope: "global".to_string(),
            created_at: 0,
            confirmed_at: None,
            expires_at: None,
            denied_at: None,
            superseded_by: None,
            status: "active".to_string(),
        }
    }

    #[test]
    fn deny_blocks_same_evidence_rebuild_and_user_can_clear() {
        let conn = temp_db("deny");
        claim_add(&conn, &claim("c1", &["m1", "m2"]), 1000).unwrap();
        assert_eq!(claim_list_active(&conn, 2000).unwrap().len(), 1);

        // 否认后：列表消失；同证据的新声明被拒绝（阻同源重建）；
        // 不同证据的声明不受影响。
        claim_deny(&conn, "c1", 2000).unwrap();
        assert!(claim_list_active(&conn, 3000).unwrap().is_empty());
        let err = claim_add(&conn, &claim("c2", &["m2", "m1"]), 3000).unwrap_err();
        assert!(err.contains("不自动重建"), "{err}");
        claim_add(&conn, &claim("c3", &["m9"]), 3000).unwrap();

        // 用户清除否认后可重新学习
        denial_clear_by_evidence(&conn, &claim("c2", &["m1", "m2"]).evidence_json).unwrap();
        claim_add(&conn, &claim("c4", &["m1", "m2"]), 4000).unwrap();
    }

    #[test]
    fn delete_leaves_denial_pause_and_expiry_and_confirm() {
        let conn = temp_db("governance");

        // 删除 = 声明没了 + 同源被阻
        claim_add(&conn, &claim("c1", &["a1"]), 1000).unwrap();
        claim_delete(&conn, "c1", 2000).unwrap();
        let gone: i64 = conn.query_row("SELECT COUNT(*) FROM profile_claims WHERE id='c1'", [], |r| r.get(0)).unwrap();
        assert_eq!(gone, 0);
        assert!(claim_add(&conn, &claim("c1b", &["a1"]), 3000).is_err(), "删除留下阻建标记");

        // 暂停/恢复
        claim_add(&conn, &claim("c2", &["a2"]), 1000).unwrap();
        claim_pause(&conn, "c2").unwrap();
        assert!(claim_list_active(&conn, 2000).unwrap().is_empty());
        claim_resume(&conn, "c2").unwrap();
        assert_eq!(claim_list_active(&conn, 2000).unwrap().len(), 1);

        // 过期不进列表
        claim_add(&conn, &claim("c3", &["a3"]), 1000).unwrap();
        conn.execute("UPDATE profile_claims SET expires_at = 1500 WHERE id = 'c3'", []).unwrap();
        assert!(claim_list_active(&conn, 2000).unwrap().iter().all(|c| c.id != "c3"), "过期声明不进可用列表");

        // 确认事实
        claim_confirm(&conn, "c2", 3000).unwrap();
        let confirmed: Option<i64> = conn
            .query_row("SELECT confirmed_at FROM profile_claims WHERE id='c2'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(confirmed, Some(3000));
    }

    #[test]
    fn answer_memory_requires_confirmed_active_global_claims() {
        let conn = temp_db("answer-scope");
        let global = claim("global-confirmed", &["n1"]);
        claim_add(&conn, &global, 1000).unwrap();
        claim_confirm(&conn, "global-confirmed", 1000).unwrap();

        let unconfirmed = claim("global-unconfirmed", &["n2"]);
        claim_add(&conn, &unconfirmed, 1000).unwrap();

        let mut project = claim("project-confirmed", &["n3"]);
        project.scope = "project-a".to_string();
        claim_add(&conn, &project, 1000).unwrap();
        claim_confirm(&conn, "project-confirmed", 1000).unwrap();

        let expired = claim("global-expired", &["n4"]);
        claim_add(&conn, &expired, 1000).unwrap();
        claim_confirm(&conn, "global-expired", 1000).unwrap();
        conn.execute("UPDATE profile_claims SET expires_at = 1500 WHERE id = 'global-expired'", []).unwrap();

        let paused = claim("global-paused", &["n5"]);
        claim_add(&conn, &paused, 1000).unwrap();
        claim_confirm(&conn, "global-paused", 1000).unwrap();
        claim_pause(&conn, "global-paused").unwrap();

        let denied = claim("global-denied", &["n6"]);
        claim_add(&conn, &denied, 1000).unwrap();
        claim_confirm(&conn, "global-denied", 1000).unwrap();
        claim_deny(&conn, "global-denied", 1400).unwrap();

        let superseded = claim("global-superseded", &["n7"]);
        claim_add(&conn, &superseded, 1000).unwrap();
        claim_confirm(&conn, "global-superseded", 1000).unwrap();
        conn.execute("UPDATE profile_claims SET superseded_by = 'replacement' WHERE id = 'global-superseded'", []).unwrap();

        let claims = claim_list_for_answer(&conn, 2000).unwrap();
        assert_eq!(claims.iter().map(|claim| claim.id.as_str()).collect::<Vec<_>>(), vec!["global-confirmed"]);
    }

    #[test]
    fn project_answer_memory_is_confirmed_active_and_bound_to_selected_live_project() {
        let conn = temp_db("project-answer-scope");
        conn.execute(
            "INSERT INTO projects (id, name, created_at, updated_at, archived_at) VALUES
             ('project-a', '项目甲', 1, 1, NULL), ('project-b', '项目乙', 1, 1, NULL), ('project-archived', '已封存', 1, 1, 10)",
            [],
        ).unwrap();

        let global = claim("global", &["e-global"]);
        claim_add(&conn, &global, 1000).unwrap();
        claim_confirm(&conn, "global", 1000).unwrap();
        let mut project_a = claim("project-a-active", &["e-project-a"]);
        project_a.scope = "project-a".to_string();
        claim_add(&conn, &project_a, 1000).unwrap();
        claim_confirm(&conn, "project-a-active", 1000).unwrap();
        let mut project_b = claim("project-b-active", &["e-project-b"]);
        project_b.scope = "project-b".to_string();
        claim_add(&conn, &project_b, 1000).unwrap();
        claim_confirm(&conn, "project-b-active", 1000).unwrap();

        let mut unconfirmed = claim("project-a-unconfirmed", &["e-unconfirmed"]);
        unconfirmed.scope = "project-a".to_string();
        claim_add(&conn, &unconfirmed, 1000).unwrap();
        let mut expired = claim("project-a-expired", &["e-expired"]);
        expired.scope = "project-a".to_string();
        claim_add(&conn, &expired, 1000).unwrap();
        claim_confirm(&conn, "project-a-expired", 1000).unwrap();
        conn.execute("UPDATE profile_claims SET expires_at = 1500 WHERE id = 'project-a-expired'", []).unwrap();
        let mut paused = claim("project-a-paused", &["e-paused"]);
        paused.scope = "project-a".to_string();
        claim_add(&conn, &paused, 1000).unwrap();
        claim_confirm(&conn, "project-a-paused", 1000).unwrap();
        claim_pause(&conn, "project-a-paused").unwrap();
        let mut denied = claim("project-a-denied", &["e-denied"]);
        denied.scope = "project-a".to_string();
        claim_add(&conn, &denied, 1000).unwrap();
        claim_confirm(&conn, "project-a-denied", 1000).unwrap();
        claim_deny(&conn, "project-a-denied", 1100).unwrap();

        let selected = claim_list_for_project_answer(&conn, 2000, "project-a").unwrap();
        assert_eq!(selected.iter().map(|claim| claim.id.as_str()).collect::<Vec<_>>(), vec!["project-a-active"]);
        let other = claim_list_for_project_answer(&conn, 2000, "project-b").unwrap();
        assert_eq!(other.iter().map(|claim| claim.id.as_str()).collect::<Vec<_>>(), vec!["project-b-active"]);
        assert!(claim_list_for_project_answer(&conn, 2000, "project-archived").is_err());
        assert!(claim_list_for_project_answer(&conn, 2000, "missing-project").is_err());
        assert_eq!(claim_list_for_answer(&conn, 2000).unwrap().iter().map(|claim| claim.id.as_str()).collect::<Vec<_>>(), vec!["global"]);
    }

    #[test]
    fn governance_list_includes_paused_denied_and_expired_claims() {
        let conn = temp_db("all-claims");
        claim_add(&conn, &claim("paused", &["n1"]), 1000).unwrap();
        claim_pause(&conn, "paused").unwrap();
        claim_add(&conn, &claim("denied", &["n2"]), 1000).unwrap();
        claim_deny(&conn, "denied", 1100).unwrap();
        claim_add(&conn, &claim("expired", &["n3"]), 1000).unwrap();
        conn.execute("UPDATE profile_claims SET expires_at = 900 WHERE id = 'expired'", []).unwrap();

        let ids = claim_list_all(&conn).unwrap().into_iter().map(|claim| claim.id).collect::<Vec<_>>();
        assert_eq!(ids.len(), 3);
        assert!(ids.contains(&"paused".to_string()));
        assert!(ids.contains(&"denied".to_string()));
        assert!(ids.contains(&"expired".to_string()));
    }
}

// ---------- 目标（R4/D04：完成条件 + 证据关联，缺记录不判失败） ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalDto {
    pub id: String,
    pub title: String,
    pub done_criteria: String,
    pub scope: Option<String>,
    pub created_at: i64,
    pub achieved_at: Option<i64>,
    pub abandoned_at: Option<i64>,
    pub review_note: String,
    /// 关联证据数（只读派生列；缺证据 ≠ 失败，只是 0）。
    pub evidence_count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalCreate {
    pub id: String,
    pub title: String,
    pub done_criteria: String,
    pub scope: Option<String>,
}

pub fn goal_create(conn: &Connection, goal: &GoalCreate, now: i64) -> Result<usize, String> {
    let title = goal.title.trim();
    let criteria = goal.done_criteria.trim();
    if title.is_empty() {
        return Err("目标标题不能为空".to_string());
    }
    if criteria.is_empty() {
        return Err("完成条件不能为空——判定只认这个，不靠记录多少（这是「缺少记录不得判为失败」的前提：条件必须显式）".to_string());
    }
    let changed = conn.execute(
        "INSERT INTO goals (id, title, done_criteria, scope, created_at, review_note)
         SELECT ?1, ?2, ?3, ?4, ?5, ''
         WHERE ?4 IS NULL OR EXISTS (SELECT 1 FROM projects WHERE id = ?4 AND archived_at IS NULL)",
        params![goal.id, title, criteria, goal.scope, now],
    )
    .map_err(|e| e.to_string())?;
    if changed == 0 { return Err("项目不存在或已封存，请重新选择".to_string()); }
    Ok(changed)
}

/// 仅活跃目标可调整归属；单条语句同时检查项目状态，避免封存与写入竞争。
pub fn goal_set_scope(conn: &Connection, id: &str, scope: Option<&str>) -> Result<(), String> {
    let changed = conn.execute(
        "UPDATE goals SET scope = ?2 WHERE id = ?1 AND achieved_at IS NULL AND abandoned_at IS NULL
         AND (?2 IS NULL OR EXISTS (SELECT 1 FROM projects WHERE id = ?2 AND archived_at IS NULL))",
        params![id, scope],
    ).map_err(|e| e.to_string())?;
    if changed == 0 { return Err("目标不可用，或项目不存在、已封存；请刷新后重试".to_string()); }
    Ok(())
}

/// 活跃目标（未达成未放弃）。证据数是 LEFT JOIN 派生——没有证据的
/// 目标照常出现，evidence_count = 0，没有「落后」「失败」状态。
pub fn goal_list_active(conn: &Connection) -> Result<Vec<GoalDto>> {
    let mut stmt = conn.prepare(
        "SELECT g.id, g.title, g.done_criteria, g.scope, g.created_at, g.achieved_at, g.abandoned_at, g.review_note,
                (SELECT COUNT(*) FROM goal_evidence e WHERE e.goal_id = g.id) AS evidence_count
         FROM goals g
         WHERE g.achieved_at IS NULL AND g.abandoned_at IS NULL
         ORDER BY g.created_at ASC",
    )?;
    let rows = stmt.query_map([], map_goal_row)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

fn map_goal_row(row: &rusqlite::Row<'_>) -> Result<GoalDto> {
    Ok(GoalDto {
        id: row.get(0)?,
        title: row.get(1)?,
        done_criteria: row.get(2)?,
        scope: row.get(3)?,
        created_at: row.get(4)?,
        achieved_at: row.get(5)?,
        abandoned_at: row.get(6)?,
        review_note: row.get(7)?,
        evidence_count: row.get(8)?,
    })
}

/// 关联证据（幂等：重复关联同一证据不重复行）。
pub fn goal_link_evidence(conn: &Connection, goal_id: &str, evidence_id: &str, kind: &str, now: i64) -> Result<usize, String> {
    let exists: i64 = conn
        .query_row("SELECT COUNT(*) FROM goals WHERE id = ?1", params![goal_id], |r| r.get(0))
        .unwrap_or(0);
    if exists == 0 {
        return Err("目标不存在".to_string());
    }
    if !matches!(kind, "note" | "material") {
        return Err(format!("证据类型只认 note 或 material，收到 {kind}"));
    }
    let table = if kind == "note" { "notes" } else { "materials" };
    let target: i64 = conn
        .query_row(&format!("SELECT COUNT(*) FROM {table} WHERE id = ?1"), params![evidence_id], |r| r.get(0))
        .unwrap_or(0);
    if target == 0 {
        return Err(format!("{kind} 里没有 id 为 {evidence_id} 的记录"));
    }
    conn.execute(
        "INSERT INTO goal_evidence (goal_id, evidence_id, kind, linked_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(goal_id, evidence_id) DO NOTHING",
        params![goal_id, evidence_id, kind, now],
    )
    .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalEvidenceItem {
    pub goal_id: String,
    pub evidence_id: String,
    pub kind: String,
    pub linked_at: i64,
    /// 不存在或已删除的原件不返回标题，调用方须标明不可用。
    pub title: Option<String>,
}

/// 在闭区间内关联的证据；保留已删除原件的关联事实。
pub fn goal_evidence_in_period(conn: &Connection, from: i64, to: i64) -> Result<Vec<GoalEvidenceItem>, String> {
    if from > to { return Err("复盘周期起点不能晚于终点".to_string()); }
    let mut stmt = conn.prepare(
        "SELECT e.goal_id, e.evidence_id, e.kind, e.linked_at,
                CASE e.kind WHEN 'note' THEN n.title WHEN 'material' THEN m.title ELSE NULL END
         FROM goal_evidence e JOIN goals g ON g.id = e.goal_id
         LEFT JOIN notes n ON e.kind = 'note' AND n.id = e.evidence_id AND n.is_deleted = 0
         LEFT JOIN materials m ON e.kind = 'material' AND m.id = e.evidence_id AND m.is_deleted = 0
         WHERE e.linked_at >= ?1 AND e.linked_at <= ?2 AND g.created_at <= ?2
           AND (g.achieved_at IS NULL OR g.achieved_at >= ?1)
           AND (g.abandoned_at IS NULL OR g.abandoned_at >= ?1)
         ORDER BY e.linked_at DESC, e.goal_id, e.evidence_id"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![from, to], |r| Ok(GoalEvidenceItem {
        goal_id: r.get(0)?, evidence_id: r.get(1)?, kind: r.get(2)?, linked_at: r.get(3)?, title: r.get(4)?,
    })).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalReviewSnapshot {
    pub goals: Vec<GoalDto>,
    pub evidence: Vec<GoalEvidenceItem>,
}

/// 同一只读事务中取得周期内存在的目标和关联，避免状态与明细来自不同时间点。
pub fn goal_review_snapshot(conn: &mut Connection, from: i64, to: i64) -> Result<GoalReviewSnapshot, String> {
    if from > to { return Err("复盘周期起点不能晚于终点".to_string()); }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let goals = {
        let mut stmt = tx.prepare(
            "SELECT g.id, g.title, g.done_criteria, g.scope, g.created_at, g.achieved_at, g.abandoned_at, g.review_note,
                    (SELECT COUNT(*) FROM goal_evidence e WHERE e.goal_id = g.id AND e.linked_at <= ?2)
             FROM goals g WHERE g.created_at <= ?2
             AND (g.achieved_at IS NULL OR g.achieved_at >= ?1)
             AND (g.abandoned_at IS NULL OR g.abandoned_at >= ?1)
             ORDER BY g.created_at ASC, g.id"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![from, to], map_goal_row).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };
    let evidence = goal_evidence_in_period(&tx, from, to)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(GoalReviewSnapshot { goals, evidence })
}

/// 用户确认达成：判定**只**来自这一步（显式确认），证据多少不参与。
pub fn goal_achieve(conn: &Connection, id: &str, review_note: &str, now: i64) -> Result<bool, String> {
    let changed = conn.execute(
        "UPDATE goals SET achieved_at = ?2, review_note = ?3 WHERE id = ?1 AND achieved_at IS NULL AND abandoned_at IS NULL",
        params![id, now, review_note],
    )
    .map_err(|e| e.to_string())?;
    Ok(changed > 0)
}

/// 放弃（与失败区分：这是用户决定，不是系统判定）。
pub fn goal_abandon(conn: &Connection, id: &str, review_note: &str, now: i64) -> Result<bool, String> {
    let changed = conn.execute(
        "UPDATE goals SET abandoned_at = ?2, review_note = ?3 WHERE id = ?1 AND achieved_at IS NULL AND abandoned_at IS NULL",
        params![id, now, review_note],
    )
    .map_err(|e| e.to_string())?;
    Ok(changed > 0)
}

#[cfg(test)]
mod goal_tests {
    use super::*;

    fn temp_db(tag: &str) -> Connection {
        let dir = std::env::temp_dir().join(format!("kf-goal-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        crate::db::open_db(&dir.join("knowflick.db")).unwrap()
    }

    fn draft(id: &str, title: &str, body: &str) -> NoteDto {
        NoteDto { id: id.to_string(), title: title.to_string(), body_md: body.to_string(), ..Default::default() }
    }

    fn goal(id: &str, title: &str, criteria: &str) -> GoalCreate {
        GoalCreate {
            id: id.to_string(),
            title: title.to_string(),
            done_criteria: criteria.to_string(),
            scope: None,
        }
    }

    #[test]
    fn goal_input_and_project_scope_work_for_new_and_existing_goals() {
        let conn = temp_db("scope");
        let draft: GoalCreate = serde_json::from_str(r#"{"id":"g1","title":"写作","doneCriteria":"完成文章","scope":"p1"}"#).unwrap();
        project_create(&conn, "p1", "项目一", "", 1).unwrap();
        goal_create(&conn, &draft, 2).unwrap();
        goal_create(&conn, &goal("g2", "旧目标", "完成"), 3).unwrap();
        assert_eq!(goal_list_active(&conn).unwrap()[0].scope.as_deref(), Some("p1"));
        goal_set_scope(&conn, "g2", Some("p1")).unwrap();
        assert_eq!(goal_list_active(&conn).unwrap()[1].scope.as_deref(), Some("p1"));
        assert!(goal_set_scope(&conn, "g2", Some("missing")).is_err());
        assert!(goal_create(&conn, &GoalCreate { id: "bad".into(), scope: Some("missing".into()), ..goal("x", "X", "完成") }, 4).is_err());
        conn.execute("UPDATE projects SET archived_at=5 WHERE id='p1'", []).unwrap();
        assert!(goal_set_scope(&conn, "g2", Some("p1")).is_err());
        goal_set_scope(&conn, "g2", None).unwrap();
        assert_eq!(goal_list_active(&conn).unwrap()[1].scope, None);
        goal_achieve(&conn, "g2", "完成", 6).unwrap();
        assert!(goal_set_scope(&conn, "g2", None).is_err());
    }

    #[test]
    fn evidence_period_has_inclusive_bounds_and_marks_missing_sources() {
        let mut conn = temp_db("evidence-period");
        goal_create(&conn, &goal("g1", "目标", "完成"), 1).unwrap();
        goal_create(&conn, &goal("done", "完成目标", "完成"), 1).unwrap();
        goal_create(&conn, &goal("abandoned", "放弃目标", "完成"), 1).unwrap();
        note_upsert(&conn, &draft("n1", "笔记", "内容"), 0, 1).unwrap();
        note_upsert(&conn, &draft("n2", "旧笔记", "内容"), 0, 1).unwrap();
        conn.execute("INSERT INTO materials(id,source_type,title,raw_text,content_hash,created_at,updated_at) VALUES ('m1','manual','素材','内容','h',1,1)", []).unwrap();
        goal_link_evidence(&conn, "g1", "n1", "note", 100).unwrap();
        goal_link_evidence(&conn, "g1", "m1", "material", 150).unwrap();
        goal_link_evidence(&conn, "g1", "n2", "note", 200).unwrap();
        goal_link_evidence(&conn, "done", "n1", "note", 150).unwrap();
        goal_link_evidence(&conn, "abandoned", "n1", "note", 150).unwrap();
        goal_achieve(&conn, "done", "已完成", 201).unwrap();
        goal_abandon(&conn, "abandoned", "变更计划", 199).unwrap();
        let rows = goal_evidence_in_period(&conn, 100, 200).unwrap();
        assert_eq!(rows.len(), 5);
        assert_eq!(rows[0].linked_at, 200);
        assert!(rows.iter().any(|row| row.title.as_deref() == Some("素材")));
        assert!(rows.iter().any(|row| row.title.as_deref() == Some("笔记")));
        assert_eq!(goal_evidence_in_period(&conn, 101, 199).unwrap().len(), 3);
        conn.execute("UPDATE notes SET is_deleted=1 WHERE id='n2'", []).unwrap();
        assert_eq!(goal_evidence_in_period(&conn, 100, 200).unwrap()[0].title, None);
        let snapshot = goal_review_snapshot(&mut conn, 100, 201).unwrap();
        assert!(snapshot.goals.iter().any(|g| g.id == "done" && g.achieved_at == Some(201)));
        assert!(snapshot.goals.iter().any(|g| g.id == "abandoned" && g.abandoned_at == Some(199)));
        assert!(snapshot.evidence.iter().any(|e| e.goal_id == "done"));
        let earlier = goal_review_snapshot(&mut conn, 100, 150).unwrap();
        assert_eq!(earlier.goals.iter().find(|g| g.id == "g1").unwrap().evidence_count, 2);
        let later = goal_review_snapshot(&mut conn, 202, 300).unwrap();
        assert!(!later.goals.iter().any(|g| g.id == "done"));
        assert!(goal_evidence_in_period(&conn, 201, 200).is_err());
    }

    #[test]
    fn no_evidence_is_not_failure_and_achievement_is_explicit() {
        let conn = temp_db("semantics");
        note_upsert(&conn, &draft("n1", "记录", "读完了第三章"), 0, 1000).unwrap();
        goal_create(&conn, &goal("g1", "读完这本书", "读完最后一章并写笔记"), 1000).unwrap();

        // 无证据目标照常出现，evidence_count = 0——没有「落后」状态
        let goals = goal_list_active(&conn).unwrap();
        assert_eq!(goals.len(), 1);
        assert_eq!(goals[0].evidence_count, 0);

        // 完成条件必填（判定的唯一依据）
        assert!(goal_create(&conn, &goal("g2", "X", "  "), 2000).is_err());

        // 关联证据幂等；不存在目标/笔记给中文错误
        goal_link_evidence(&conn, "g1", "n1", "note", 2000).unwrap();
        goal_link_evidence(&conn, "g1", "n1", "note", 2100).unwrap();
        let goals = goal_list_active(&conn).unwrap();
        assert_eq!(goals[0].evidence_count, 1, "重复关联不重复计数");
        assert!(goal_link_evidence(&conn, "ghost", "n1", "note", 2200).is_err());
        assert!(goal_link_evidence(&conn, "g1", "ghost", "note", 2200).is_err());
        assert!(goal_link_evidence(&conn, "g1", "n1", "card", 2200).is_err());

        // 达成是显式动作（与证据数无关）：无证据也能达成、有证据也能放弃
        assert!(goal_achieve(&conn, "g1", "最后一章笔记已写", 3000).unwrap());
        assert!(goal_list_active(&conn).unwrap().is_empty());
        assert!(!goal_achieve(&conn, "g1", "再确认一次", 3100).unwrap(), "已达成不能重复确认");

        // 放弃同理是显式动作
        goal_create(&conn, &goal("g3", "学 Rust", "完成 borrow checker 练习"), 3200).unwrap();
        assert!(goal_abandon(&conn, "g3", "优先级变化", 3300).unwrap());
        assert!(goal_list_active(&conn).unwrap().is_empty());
    }
}
