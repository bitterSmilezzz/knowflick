use std::path::Path;
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScienceLinkDto {
    pub title: String,
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeCardDto {
    pub id: String,
    #[serde(default)]
    pub material_id: Option<String>,
    pub category: String,
    pub headline: String,
    pub summary: String,
    pub details: String,
    #[serde(default)]
    pub links: Vec<ScienceLinkDto>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub source: String,
    pub created_at: i64,
    pub edited_at: Option<i64>,
    pub seen_at: Option<i64>,
    pub swiped: Option<String>,
    pub is_favorite: bool,
    pub favorited_at: Option<i64>,
    pub review_count: i64,
    pub mastery_level: i64,
    pub last_reviewed_at: Option<i64>,
    pub repetition: i64,
    pub interval_days: f64,
    pub ease_factor: f64,
    pub stability: f64,
    pub difficulty: f64,
    pub subject: Option<String>,
    pub branch: Option<String>,
    pub level: Option<i64>,
    pub track: Option<String>,
    pub order_key: Option<String>,
    #[serde(default)]
    pub prereq: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RawMaterialDto {
    pub id: String,
    pub source_type: String, // "manual", "web", "note", "document", "audio", "image"
    pub title: String,
    pub source_url: Option<String>,
    pub raw_text: String,
    pub cleaned_markdown: Option<String>,
    pub content_hash: String,
    pub media_path: Option<String>,
    pub media_size_bytes: i64,
    pub metadata_json: String,
    pub inbox_status: String, // "inbox", "processed", "dismissed"
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DbStatsDto {
    pub total_cards: i64,
    pub total_materials: i64,
    pub inbox_materials: i64,
    pub favorite_cards: i64,
    pub seen_cards: i64,
    pub due_cards: i64,
}

pub fn open_db(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    init_tables(&conn)?;
    Ok(conn)
}

pub fn init_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS materials (
            id                  TEXT PRIMARY KEY,
            source_type         TEXT NOT NULL,
            title               TEXT NOT NULL,
            source_url          TEXT,
            raw_text            TEXT NOT NULL,
            cleaned_markdown    TEXT,
            content_hash        TEXT NOT NULL,
            media_path          TEXT,
            media_size_bytes    INTEGER DEFAULT 0,
            metadata_json       TEXT NOT NULL DEFAULT '{}',
            inbox_status        TEXT NOT NULL DEFAULT 'inbox',
            created_at          INTEGER NOT NULL,
            updated_at          INTEGER NOT NULL,
            version             INTEGER NOT NULL DEFAULT 1,
            is_deleted          INTEGER NOT NULL DEFAULT 0,
            deleted_at          INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_materials_hash ON materials(content_hash);
        CREATE INDEX IF NOT EXISTS idx_materials_inbox ON materials(inbox_status, is_deleted);
        CREATE INDEX IF NOT EXISTS idx_materials_created ON materials(created_at DESC);

        CREATE TABLE IF NOT EXISTS cards (
            id                  TEXT PRIMARY KEY,
            material_id         TEXT REFERENCES materials(id) ON DELETE SET NULL,
            category            TEXT NOT NULL DEFAULT '未分类',
            headline            TEXT NOT NULL,
            summary             TEXT NOT NULL,
            details             TEXT NOT NULL,
            links_json          TEXT NOT NULL DEFAULT '[]',
            tags_json           TEXT NOT NULL DEFAULT '[]',
            source              TEXT NOT NULL DEFAULT 'imported',
            seen_at             INTEGER,
            swiped              TEXT,
            is_favorite         INTEGER NOT NULL DEFAULT 0,
            favorited_at        INTEGER,
            review_count        INTEGER NOT NULL DEFAULT 0,
            mastery_level       INTEGER NOT NULL DEFAULT 0,
            last_reviewed_at    INTEGER,
            repetition          INTEGER NOT NULL DEFAULT 0,
            interval_days       REAL NOT NULL DEFAULT 0.0,
            ease_factor         REAL NOT NULL DEFAULT 2.5,
            stability           REAL NOT NULL DEFAULT 0.0,
            difficulty          REAL NOT NULL DEFAULT 0.0,
            subject             TEXT,
            branch              TEXT,
            level               INTEGER,
            track               TEXT,
            order_key           TEXT,
            prereq_json         TEXT NOT NULL DEFAULT '[]',
            created_at          INTEGER NOT NULL,
            updated_at          INTEGER NOT NULL,
            version             INTEGER NOT NULL DEFAULT 1,
            is_deleted          INTEGER NOT NULL DEFAULT 0,
            deleted_at          INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_cards_material ON cards(material_id);
        CREATE INDEX IF NOT EXISTS idx_cards_category ON cards(category, is_deleted);
        CREATE INDEX IF NOT EXISTS idx_cards_favorite ON cards(is_favorite, is_deleted);
        CREATE INDEX IF NOT EXISTS idx_cards_updated ON cards(updated_at DESC);

        CREATE VIRTUAL TABLE IF NOT EXISTS fts_cards USING fts5(
            card_id UNINDEXED,
            headline,
            summary,
            details,
            category,
            tags,
            tokenize = 'unicode61 remove_diacritics 2'
        );

        CREATE TABLE IF NOT EXISTS artifacts (
            id                  TEXT PRIMARY KEY,
            artifact_type       TEXT NOT NULL,
            title               TEXT NOT NULL,
            content_markdown    TEXT NOT NULL,
            source_card_ids     TEXT NOT NULL DEFAULT '[]',
            date_scope_start    INTEGER,
            date_scope_end      INTEGER,
            created_at          INTEGER NOT NULL,
            updated_at          INTEGER NOT NULL,
            is_deleted          INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS subscriptions (
            id                  TEXT PRIMARY KEY,
            type                TEXT NOT NULL,
            title               TEXT NOT NULL,
            target_url          TEXT NOT NULL,
            interval_minutes    INTEGER NOT NULL DEFAULT 360,
            last_polled_at      INTEGER,
            is_active           INTEGER NOT NULL DEFAULT 1,
            created_at          INTEGER NOT NULL
        );
        "#,
    )?;
    Ok(())
}

pub fn calculate_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn save_material(conn: &Connection, material: &RawMaterialDto) -> Result<()> {
    conn.execute(
        r#"
        INSERT INTO materials (
            id, source_type, title, source_url, raw_text, cleaned_markdown,
            content_hash, media_path, media_size_bytes, metadata_json,
            inbox_status, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            raw_text = excluded.raw_text,
            cleaned_markdown = excluded.cleaned_markdown,
            inbox_status = excluded.inbox_status,
            updated_at = excluded.updated_at
        "#,
        params![
            material.id,
            material.source_type,
            material.title,
            material.source_url,
            material.raw_text,
            material.cleaned_markdown,
            material.content_hash,
            material.media_path,
            material.media_size_bytes,
            material.metadata_json,
            material.inbox_status,
            material.created_at,
            material.updated_at,
        ],
    )?;
    Ok(())
}

pub fn list_materials(conn: &Connection, inbox_only: bool, limit: i64) -> Result<Vec<RawMaterialDto>> {
    let sql = if inbox_only {
        "SELECT id, source_type, title, source_url, raw_text, cleaned_markdown, content_hash, media_path, media_size_bytes, metadata_json, inbox_status, created_at, updated_at
         FROM materials WHERE is_deleted = 0 AND inbox_status = 'inbox' ORDER BY created_at DESC LIMIT ?1"
    } else {
        "SELECT id, source_type, title, source_url, raw_text, cleaned_markdown, content_hash, media_path, media_size_bytes, metadata_json, inbox_status, created_at, updated_at
         FROM materials WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT ?1"
    };

    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params![limit], |row| {
        Ok(RawMaterialDto {
            id: row.get(0)?,
            source_type: row.get(1)?,
            title: row.get(2)?,
            source_url: row.get(3)?,
            raw_text: row.get(4)?,
            cleaned_markdown: row.get(5)?,
            content_hash: row.get(6)?,
            media_path: row.get(7)?,
            media_size_bytes: row.get(8)?,
            metadata_json: row.get(9)?,
            inbox_status: row.get(10)?,
            created_at: row.get(11)?,
            updated_at: row.get(12)?,
        })
    })?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r?);
    }
    Ok(result)
}

pub fn update_material_status(conn: &Connection, id: &str, status: &str) -> Result<()> {
    let now = chrono_or_epoch_now();
    conn.execute(
        "UPDATE materials SET inbox_status = ?1, updated_at = ?2 WHERE id = ?3",
        params![status, now, id],
    )?;
    Ok(())
}

pub fn upsert_card(conn: &Connection, card: &KnowledgeCardDto) -> Result<()> {
    let links_json = serde_json::to_string(&card.links).unwrap_or_else(|_| "[]".to_string());
    let tags_json = serde_json::to_string(&card.tags).unwrap_or_else(|_| "[]".to_string());
    let prereq_json = serde_json::to_string(&card.prereq).unwrap_or_else(|_| "[]".to_string());
    let updated_at = card.edited_at.unwrap_or(card.created_at);

    conn.execute(
        r#"
        INSERT INTO cards (
            id, material_id, category, headline, summary, details,
            links_json, tags_json, source, seen_at, swiped, is_favorite,
            favorited_at, review_count, mastery_level, last_reviewed_at,
            repetition, interval_days, ease_factor, stability, difficulty,
            subject, branch, level, track, order_key, prereq_json,
            created_at, updated_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6,
            ?7, ?8, ?9, ?10, ?11, ?12,
            ?13, ?14, ?15, ?16,
            ?17, ?18, ?19, ?20, ?21,
            ?22, ?23, ?24, ?25, ?26, ?27,
            ?28, ?29
        )
        ON CONFLICT(id) DO UPDATE SET
            category = excluded.category,
            headline = excluded.headline,
            summary = excluded.summary,
            details = excluded.details,
            links_json = excluded.links_json,
            tags_json = excluded.tags_json,
            source = excluded.source,
            seen_at = excluded.seen_at,
            swiped = excluded.swiped,
            is_favorite = excluded.is_favorite,
            favorited_at = excluded.favorited_at,
            review_count = excluded.review_count,
            mastery_level = excluded.mastery_level,
            last_reviewed_at = excluded.last_reviewed_at,
            repetition = excluded.repetition,
            interval_days = excluded.interval_days,
            ease_factor = excluded.ease_factor,
            stability = excluded.stability,
            difficulty = excluded.difficulty,
            subject = excluded.subject,
            branch = excluded.branch,
            level = excluded.level,
            track = excluded.track,
            order_key = excluded.order_key,
            prereq_json = excluded.prereq_json,
            updated_at = excluded.updated_at
        "#,
        params![
            card.id,
            card.material_id,
            card.category,
            card.headline,
            card.summary,
            card.details,
            links_json,
            tags_json,
            card.source,
            card.seen_at,
            card.swiped,
            if card.is_favorite { 1 } else { 0 },
            card.favorited_at,
            card.review_count,
            card.mastery_level,
            card.last_reviewed_at,
            card.repetition,
            card.interval_days,
            card.ease_factor,
            card.stability,
            card.difficulty,
            card.subject,
            card.branch,
            card.level,
            card.track,
            card.order_key,
            prereq_json,
            card.created_at,
            updated_at,
        ],
    )?;

    // 同步刷新 FTS5
    conn.execute("DELETE FROM fts_cards WHERE card_id = ?1", params![card.id])?;
    let tags_text = card.tags.join(" ");
    conn.execute(
        "INSERT INTO fts_cards (card_id, headline, summary, details, category, tags) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![card.id, card.headline, card.summary, card.details, card.category, tags_text],
    )?;

    Ok(())
}

pub fn delete_card(conn: &Connection, id: &str) -> Result<()> {
    let now = chrono_or_epoch_now();
    conn.execute(
        "UPDATE cards SET is_deleted = 1, deleted_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    conn.execute("DELETE FROM fts_cards WHERE card_id = ?1", params![id])?;
    Ok(())
}

pub fn list_cards(conn: &Connection, limit: i64, offset: i64) -> Result<Vec<KnowledgeCardDto>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT
            id, material_id, category, headline, summary, details,
            links_json, tags_json, source, seen_at, swiped, is_favorite,
            favorited_at, review_count, mastery_level, last_reviewed_at,
            repetition, interval_days, ease_factor, stability, difficulty,
            subject, branch, level, track, order_key, prereq_json,
            created_at, updated_at
        FROM cards
        WHERE is_deleted = 0
        ORDER BY created_at DESC
        LIMIT ?1 OFFSET ?2
        "#,
    )?;

    let rows = stmt.query_map(params![limit, offset], |row| {
        let links_str: String = row.get(6)?;
        let tags_str: String = row.get(7)?;
        let prereq_str: String = row.get(26)?;
        let is_fav_int: i64 = row.get(11)?;

        Ok(KnowledgeCardDto {
            id: row.get(0)?,
            material_id: row.get(1)?,
            category: row.get(2)?,
            headline: row.get(3)?,
            summary: row.get(4)?,
            details: row.get(5)?,
            links: serde_json::from_str(&links_str).unwrap_or_default(),
            tags: serde_json::from_str(&tags_str).unwrap_or_default(),
            source: row.get(8)?,
            seen_at: row.get(9)?,
            swiped: row.get(10)?,
            is_favorite: is_fav_int != 0,
            favorited_at: row.get(12)?,
            review_count: row.get(13)?,
            mastery_level: row.get(14)?,
            last_reviewed_at: row.get(15)?,
            repetition: row.get(16)?,
            interval_days: row.get(17)?,
            ease_factor: row.get(18)?,
            stability: row.get(19)?,
            difficulty: row.get(20)?,
            subject: row.get(21)?,
            branch: row.get(22)?,
            level: row.get(23)?,
            track: row.get(24)?,
            order_key: row.get(25)?,
            prereq: serde_json::from_str(&prereq_str).unwrap_or_default(),
            created_at: row.get(27)?,
            edited_at: row.get(28)?,
        })
    })?;

    let mut cards = Vec::new();
    for r in rows {
        cards.push(r?);
    }
    Ok(cards)
}

pub fn search_cards_fts(conn: &Connection, query: &str, limit: i64) -> Result<Vec<KnowledgeCardDto>> {
    let clean_query = query.trim();
    if clean_query.is_empty() {
        return list_cards(conn, limit, 0);
    }

    // 将用户输入按空格拆分构造 FTS5 match 表达式，以支持多关键词
    let words: Vec<&str> = clean_query.split_whitespace().collect();
    let match_query = words
        .iter()
        .map(|w| format!("\"{}\"*", w.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND ");

    let mut stmt = conn.prepare(
        r#"
        SELECT
            c.id, c.material_id, c.category, c.headline, c.summary, c.details,
            c.links_json, c.tags_json, c.source, c.seen_at, c.swiped, c.is_favorite,
            c.favorited_at, c.review_count, c.mastery_level, c.last_reviewed_at,
            c.repetition, c.interval_days, c.ease_factor, c.stability, c.difficulty,
            c.subject, c.branch, c.level, c.track, c.order_key, c.prereq_json,
            c.created_at, c.updated_at
        FROM fts_cards f
        JOIN cards c ON f.card_id = c.id
        WHERE c.is_deleted = 0 AND fts_cards MATCH ?1
        ORDER BY bm25(fts_cards) ASC
        LIMIT ?2
        "#,
    )?;

    let rows = stmt.query_map(params![match_query, limit], |row| {
        let links_str: String = row.get(6)?;
        let tags_str: String = row.get(7)?;
        let prereq_str: String = row.get(26)?;
        let is_fav_int: i64 = row.get(11)?;

        Ok(KnowledgeCardDto {
            id: row.get(0)?,
            material_id: row.get(1)?,
            category: row.get(2)?,
            headline: row.get(3)?,
            summary: row.get(4)?,
            details: row.get(5)?,
            links: serde_json::from_str(&links_str).unwrap_or_default(),
            tags: serde_json::from_str(&tags_str).unwrap_or_default(),
            source: row.get(8)?,
            seen_at: row.get(9)?,
            swiped: row.get(10)?,
            is_favorite: is_fav_int != 0,
            favorited_at: row.get(12)?,
            review_count: row.get(13)?,
            mastery_level: row.get(14)?,
            last_reviewed_at: row.get(15)?,
            repetition: row.get(16)?,
            interval_days: row.get(17)?,
            ease_factor: row.get(18)?,
            stability: row.get(19)?,
            difficulty: row.get(20)?,
            subject: row.get(21)?,
            branch: row.get(22)?,
            level: row.get(23)?,
            track: row.get(24)?,
            order_key: row.get(25)?,
            prereq: serde_json::from_str(&prereq_str).unwrap_or_default(),
            created_at: row.get(27)?,
            edited_at: row.get(28)?,
        })
    })?;

    let mut cards = Vec::new();
    for r in rows {
        cards.push(r?);
    }

    // 如果 FTS 没有结果（比如用户输入了特殊符号），退回 LIKE 查询兜底
    if cards.is_empty() {
        let wildcard = format!("%{}%", clean_query);
        let mut fallback_stmt = conn.prepare(
            r#"
            SELECT
                id, material_id, category, headline, summary, details,
                links_json, tags_json, source, seen_at, swiped, is_favorite,
                favorited_at, review_count, mastery_level, last_reviewed_at,
                repetition, interval_days, ease_factor, stability, difficulty,
                subject, branch, level, track, order_key, prereq_json,
                created_at, updated_at
            FROM cards
            WHERE is_deleted = 0 AND (headline LIKE ?1 OR details LIKE ?1 OR summary LIKE ?1 OR category LIKE ?1)
            ORDER BY created_at DESC
            LIMIT ?2
            "#,
        )?;
        let fb_rows = fallback_stmt.query_map(params![wildcard, limit], |row| {
            let links_str: String = row.get(6)?;
            let tags_str: String = row.get(7)?;
            let prereq_str: String = row.get(26)?;
            let is_fav_int: i64 = row.get(11)?;

            Ok(KnowledgeCardDto {
                id: row.get(0)?,
                material_id: row.get(1)?,
                category: row.get(2)?,
                headline: row.get(3)?,
                summary: row.get(4)?,
                details: row.get(5)?,
                links: serde_json::from_str(&links_str).unwrap_or_default(),
                tags: serde_json::from_str(&tags_str).unwrap_or_default(),
                source: row.get(8)?,
                seen_at: row.get(9)?,
                swiped: row.get(10)?,
                is_favorite: is_fav_int != 0,
                favorited_at: row.get(12)?,
                review_count: row.get(13)?,
                mastery_level: row.get(14)?,
                last_reviewed_at: row.get(15)?,
                repetition: row.get(16)?,
                interval_days: row.get(17)?,
                ease_factor: row.get(18)?,
                stability: row.get(19)?,
                difficulty: row.get(20)?,
                subject: row.get(21)?,
                branch: row.get(22)?,
                level: row.get(23)?,
                track: row.get(24)?,
                order_key: row.get(25)?,
                prereq: serde_json::from_str(&prereq_str).unwrap_or_default(),
                created_at: row.get(27)?,
                edited_at: row.get(28)?,
            })
        })?;
        for r in fb_rows {
            cards.push(r?);
        }
    }

    Ok(cards)
}

pub fn get_db_stats(conn: &Connection) -> Result<DbStatsDto> {
    let total_cards: i64 = conn.query_row(
        "SELECT COUNT(*) FROM cards WHERE is_deleted = 0",
        [],
        |r| r.get(0),
    )?;

    let total_materials: i64 = conn.query_row(
        "SELECT COUNT(*) FROM materials WHERE is_deleted = 0",
        [],
        |r| r.get(0),
    )?;

    let inbox_materials: i64 = conn.query_row(
        "SELECT COUNT(*) FROM materials WHERE is_deleted = 0 AND inbox_status = 'inbox'",
        [],
        |r| r.get(0),
    )?;

    let favorite_cards: i64 = conn.query_row(
        "SELECT COUNT(*) FROM cards WHERE is_deleted = 0 AND is_favorite = 1",
        [],
        |r| r.get(0),
    )?;

    let seen_cards: i64 = conn.query_row(
        "SELECT COUNT(*) FROM cards WHERE is_deleted = 0 AND seen_at IS NOT NULL",
        [],
        |r| r.get(0),
    )?;

    let now = chrono_or_epoch_now();
    let due_cards: i64 = conn.query_row(
        "SELECT COUNT(*) FROM cards WHERE is_deleted = 0 AND seen_at IS NOT NULL AND (last_reviewed_at IS NULL OR (?1 - last_reviewed_at) >= (interval_days * 86400000))",
        params![now],
        |r| r.get(0),
    )?;

    Ok(DbStatsDto {
        total_cards,
        total_materials,
        inbox_materials,
        favorite_cards,
        seen_cards,
        due_cards,
    })
}

pub fn migrate_legacy_cards_json(conn: &Connection, json_str: &str) -> Result<usize> {
    let cards: Vec<KnowledgeCardDto> = match serde_json::from_str(json_str) {
        Ok(c) => c,
        Err(_) => return Ok(0),
    };

    let count = cards.len();
    for card in &cards {
        upsert_card(conn, card)?;
    }
    Ok(count)
}

fn chrono_or_epoch_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_db_lifecycle_and_fts() {
        let conn = Connection::open_in_memory().unwrap();
        init_tables(&conn).unwrap();

        let card = KnowledgeCardDto {
            id: "card-1".to_string(),
            material_id: None,
            category: "AI架构".to_string(),
            headline: "SQLite-vec 暴力向量检索优势".to_string(),
            summary: "在万级知识库内，暴力搜索 p99 仅 12ms".to_string(),
            details: "不需要复杂的 HNSW ANN 索引，单文件内存开销仅几十兆。".to_string(),
            links: vec![],
            tags: vec!["AI".to_string(), "SQLite".to_string()],
            source: "manual".to_string(),
            created_at: 1700000000000,
            edited_at: None,
            seen_at: None,
            swiped: None,
            is_favorite: true,
            favorited_at: Some(1700000005000),
            review_count: 0,
            mastery_level: 0,
            last_reviewed_at: None,
            repetition: 0,
            interval_days: 0.0,
            ease_factor: 2.5,
            stability: 0.0,
            difficulty: 0.0,
            subject: None,
            branch: None,
            level: None,
            track: None,
            order_key: None,
            prereq: vec![],
        };

        upsert_card(&conn, &card).unwrap();

        // 验证读取
        let cards = list_cards(&conn, 10, 0).unwrap();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].headline, "SQLite-vec 暴力向量检索优势");
        assert!(cards[0].is_favorite);

        // 验证 FTS 搜索
        let search_results = search_cards_fts(&conn, "SQLite", 10).unwrap();
        assert_eq!(search_results.len(), 1);
        assert_eq!(search_results[0].id, "card-1");

        let search_no_match = search_cards_fts(&conn, "毫无关系的词汇", 10).unwrap();
        assert_eq!(search_no_match.len(), 0);

        // 验证 Material
        let material = RawMaterialDto {
            id: "mat-1".to_string(),
            source_type: "manual".to_string(),
            title: "灵感：设计闪念胶囊".to_string(),
            source_url: None,
            raw_text: "随时随地快捷键呼出，输入即走。".to_string(),
            cleaned_markdown: None,
            content_hash: calculate_hash("随时随地快捷键呼出，输入即走。"),
            media_path: None,
            media_size_bytes: 0,
            metadata_json: "{}".to_string(),
            inbox_status: "inbox".to_string(),
            created_at: 1700000010000,
            updated_at: 1700000010000,
        };
        save_material(&conn, &material).unwrap();

        let inbox = list_materials(&conn, true, 10).unwrap();
        assert_eq!(inbox.len(), 1);
        assert_eq!(inbox[0].title, "灵感：设计闪念胶囊");

        // 验证统计
        let stats = get_db_stats(&conn).unwrap();
        assert_eq!(stats.total_cards, 1);
        assert_eq!(stats.total_materials, 1);
        assert_eq!(stats.inbox_materials, 1);
        assert_eq!(stats.favorite_cards, 1);

        // 验证软删除
        delete_card(&conn, "card-1").unwrap();
        let empty_cards = list_cards(&conn, 10, 0).unwrap();
        assert_eq!(empty_cards.len(), 0);
    }
}
