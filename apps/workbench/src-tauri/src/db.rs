use std::path::{Path, PathBuf};
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScienceLinkDto {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeCardDto {
    pub id: String,
    #[serde(default)]
    pub material_id: Option<String>,
    #[serde(default = "default_category")]
    pub category: String,
    #[serde(default)]
    pub headline: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub details: String,
    #[serde(default)]
    pub links: Vec<ScienceLinkDto>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default = "chrono_or_epoch_now", deserialize_with = "deserialize_date_required")]
    pub created_at: i64,
    #[serde(default, deserialize_with = "deserialize_date_opt")]
    pub edited_at: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_date_opt")]
    pub seen_at: Option<i64>,
    #[serde(default)]
    pub swiped: Option<String>,
    #[serde(default, deserialize_with = "deserialize_is_favorite")]
    pub is_favorite: bool,
    #[serde(default, deserialize_with = "deserialize_date_opt")]
    pub favorited_at: Option<i64>,
    #[serde(default)]
    pub review_count: i64,
    #[serde(default)]
    pub mastery_level: i64,
    #[serde(default, deserialize_with = "deserialize_date_opt")]
    pub last_reviewed_at: Option<i64>,
    #[serde(default)]
    pub repetition: i64,
    #[serde(default)]
    pub interval_days: f64,
    #[serde(default = "default_ease_factor")]
    pub ease_factor: f64,
    #[serde(default)]
    pub stability: f64,
    #[serde(default)]
    pub difficulty: f64,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub level: Option<i64>,
    #[serde(default)]
    pub track: Option<String>,
    #[serde(default)]
    pub order_key: Option<String>,
    #[serde(default)]
    pub prereq: Vec<String>,
}

fn default_category() -> String {
    "未分类".to_string()
}

fn default_source() -> String {
    "imported".to_string()
}

fn default_ease_factor() -> f64 {
    2.5
}

fn deserialize_date_required<'de, D>(deserializer: D) -> std::result::Result<i64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let val = serde_json::Value::deserialize(deserializer)?;
    if val.is_null() {
        return Ok(chrono_or_epoch_now());
    }
    parse_date_millis(&val).ok_or_else(|| {
        serde::de::Error::custom(format!("invalid date value: {}", val))
    })
}

fn deserialize_date_opt<'de, D>(deserializer: D) -> std::result::Result<Option<i64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let opt = Option::<serde_json::Value>::deserialize(deserializer)?;
    match opt {
        Some(val) if !val.is_null() => Ok(parse_date_millis(&val)),
        _ => Ok(None),
    }
}

fn deserialize_is_favorite<'de, D>(deserializer: D) -> std::result::Result<bool, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let val = Option::<serde_json::Value>::deserialize(deserializer)?;
    match val {
        Some(serde_json::Value::Bool(b)) => Ok(b),
        Some(serde_json::Value::Number(n)) => Ok(n.as_i64().map(|i| i != 0).unwrap_or(false)),
        Some(serde_json::Value::String(s)) => {
            let s_lower = s.to_ascii_lowercase();
            Ok(s_lower == "true" || s_lower == "1")
        }
        _ => Ok(false),
    }
}

pub fn parse_date_millis(val: &serde_json::Value) -> Option<i64> {
    match val {
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Some(normalize_epoch_millis(i))
            } else if let Some(f) = n.as_f64() {
                if f.is_finite() {
                    Some(normalize_epoch_millis(f as i64))
                } else {
                    None
                }
            } else {
                None
            }
        }
        serde_json::Value::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                return None;
            }
            if let Ok(num) = trimmed.parse::<i64>() {
                return Some(normalize_epoch_millis(num));
            }
            if let Ok(num) = trimmed.parse::<f64>() {
                if num.is_finite() {
                    return Some(normalize_epoch_millis(num as i64));
                }
            }
            parse_iso_to_millis(trimmed)
        }
        _ => None,
    }
}

fn normalize_epoch_millis(val: i64) -> i64 {
    if val.abs() < 10_000_000_000 {
        val * 1000
    } else {
        val
    }
}

pub fn parse_iso_to_millis(s: &str) -> Option<i64> {
    let s = s.trim();
    if s.len() < 19 {
        return None;
    }
    let (date_str, rest) = if let Some(idx) = s.find('T').or_else(|| s.find(' ')) {
        (&s[..idx], &s[idx + 1..])
    } else {
        return None;
    };

    let date_parts: Vec<&str> = date_str.split('-').collect();
    if date_parts.len() != 3 {
        return None;
    }
    let year: i64 = date_parts[0].parse().ok()?;
    let month: i64 = date_parts[1].parse().ok()?;
    let day: i64 = date_parts[2].parse().ok()?;

    if month < 1 || month > 12 || day < 1 || day > 31 {
        return None;
    }

    let mut time_part = rest;
    let mut offset_seconds: i64 = 0;

    if time_part.ends_with('Z') || time_part.ends_with('z') {
        time_part = &time_part[..time_part.len() - 1];
    } else if let Some(plus_idx) = time_part.rfind('+') {
        let tz = &time_part[plus_idx + 1..];
        time_part = &time_part[..plus_idx];
        offset_seconds = parse_tz_offset(tz)?;
    } else if let Some(minus_idx) = time_part.rfind('-') {
        let tz = &time_part[minus_idx + 1..];
        time_part = &time_part[..minus_idx];
        offset_seconds = -parse_tz_offset(tz)?;
    }

    let (hms, frac_ms) = if let Some(dot_idx) = time_part.find('.') {
        let frac_str = &time_part[dot_idx + 1..];
        let hms = &time_part[..dot_idx];
        let frac_len = frac_str.len().min(3);
        let frac_digits = &frac_str[..frac_len];
        let mut ms: i64 = frac_digits.parse().ok()?;
        if frac_len == 1 {
            ms *= 100;
        } else if frac_len == 2 {
            ms *= 10;
        }
        (hms, ms)
    } else {
        (time_part, 0)
    };

    let hms_parts: Vec<&str> = hms.split(':').collect();
    if hms_parts.len() != 3 {
        return None;
    }
    let hour: i64 = hms_parts[0].parse().ok()?;
    let min: i64 = hms_parts[1].parse().ok()?;
    let sec: i64 = hms_parts[2].parse().ok()?;

    if hour > 23 || min > 59 || sec > 60 {
        return None;
    }

    let days = days_from_civil(year, month, day);
    let total_seconds = days * 86400 + hour * 3600 + min * 60 + sec - offset_seconds;
    Some(total_seconds * 1000 + frac_ms)
}

fn parse_tz_offset(tz: &str) -> Option<i64> {
    if let Some(colon) = tz.find(':') {
        let h: i64 = tz[..colon].parse().ok()?;
        let m: i64 = tz[colon + 1..].parse().ok()?;
        Some(h * 3600 + m * 60)
    } else if tz.len() == 4 {
        let h: i64 = tz[..2].parse().ok()?;
        let m: i64 = tz[2..].parse().ok()?;
        Some(h * 3600 + m * 60)
    } else if tz.len() == 2 {
        let h: i64 = tz.parse().ok()?;
        Some(h * 3600)
    } else {
        None
    }
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = y - if m <= 2 { 1 } else { 0 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u32;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe as i64 * 365 + (yoe as i64) / 4 - (yoe as i64) / 100 + doy;
    era * 146097 + doe - 719468
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RawMaterialDto {
    pub id: String,
    pub source_type: String, // "manual", "web", "note", "document", "audio", "image"
    pub title: String,
    pub source_url: Option<String>,
    pub raw_text: String,
    pub cleaned_markdown: Option<String>,
    #[serde(default)]
    pub content_hash: String,
    pub media_path: Option<String>,
    #[serde(default)]
    pub media_size_bytes: i64,
    #[serde(default = "default_metadata_json")]
    pub metadata_json: String,
    #[serde(default = "default_inbox_status")]
    pub inbox_status: String, // "inbox", "processed", "dismissed"
    pub created_at: i64,
    pub updated_at: i64,
}

fn default_metadata_json() -> String {
    "{}".to_string()
}

fn default_inbox_status() -> String {
    "inbox".to_string()
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

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactDto {
    pub id: String,
    pub artifact_type: String,
    pub title: String,
    pub content_markdown: String,
    #[serde(default)]
    pub source_card_ids: Vec<String>,
    pub date_scope_start: Option<i64>,
    pub date_scope_end: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub is_deleted: bool,
}

pub fn resolve_library_dir(dir: Option<&str>) -> PathBuf {
    match dir {
        Some(s) if !s.trim().is_empty() => PathBuf::from(s.trim()),
        _ => crate::store::default_library_dir(),
    }
}

pub fn open_db(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| {
                rusqlite::Error::ToSqlConversionFailure(Box::new(e))
            })?;
        }
    }
    let conn = Connection::open(path)?;
    conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()))?;
    conn.execute("PRAGMA foreign_keys = ON", [])?;
    conn.execute("PRAGMA synchronous = NORMAL", [])?;
    init_tables(&conn)?;
    Ok(conn)
}

pub fn init_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS meta (
            key                 TEXT PRIMARY KEY,
            value               TEXT NOT NULL
        );

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
            edited_at           INTEGER,
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

        CREATE VIRTUAL TABLE IF NOT EXISTS fts_materials USING fts5(
            material_id UNINDEXED,
            title,
            raw_text,
            source_url,
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

        CREATE TABLE IF NOT EXISTS card_embeddings (
            card_id             TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
            dim                 INTEGER NOT NULL,
            embedding           BLOB NOT NULL,
            updated_at          INTEGER NOT NULL
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

    // 针对可能已存在的旧 cards 表无 edited_at 字段进行平滑兼容升级
    let mut stmt = conn.prepare("PRAGMA table_info(cards)")?;
    let mut has_edited_at = false;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let col_name: String = row.get(1)?;
        if col_name == "edited_at" {
            has_edited_at = true;
            break;
        }
    }
    if !has_edited_at {
        let _ = conn.execute("ALTER TABLE cards ADD COLUMN edited_at INTEGER", []);
    }

    Ok(())
}

pub fn calculate_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn save_material(conn: &Connection, material: &RawMaterialDto) -> Result<()> {
    let content_hash = calculate_hash(&material.raw_text);
    let now = chrono_or_epoch_now();
    let updated_at = if material.updated_at > 0 { material.updated_at } else { now };

    conn.execute(
        r#"
        INSERT INTO materials (
            id, source_type, title, source_url, raw_text, cleaned_markdown,
            content_hash, media_path, media_size_bytes, metadata_json,
            inbox_status, created_at, updated_at, version, is_deleted
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 1, 0)
        ON CONFLICT(id) DO UPDATE SET
            source_type = excluded.source_type,
            title = excluded.title,
            source_url = excluded.source_url,
            raw_text = excluded.raw_text,
            cleaned_markdown = excluded.cleaned_markdown,
            content_hash = excluded.content_hash,
            media_path = excluded.media_path,
            media_size_bytes = excluded.media_size_bytes,
            metadata_json = excluded.metadata_json,
            inbox_status = excluded.inbox_status,
            updated_at = excluded.updated_at,
            version = materials.version + 1,
            is_deleted = 0,
            deleted_at = NULL
        "#,
        params![
            material.id,
            material.source_type,
            material.title,
            material.source_url,
            material.raw_text,
            material.cleaned_markdown,
            content_hash,
            material.media_path,
            material.media_size_bytes,
            material.metadata_json,
            material.inbox_status,
            material.created_at,
            updated_at,
        ],
    )?;

    // 同步刷新素材全文索引（与 cards 的 fts_cards 同构）
    conn.execute("DELETE FROM fts_materials WHERE material_id = ?1", params![material.id])?;
    conn.execute(
        "INSERT INTO fts_materials (material_id, title, raw_text, source_url) VALUES (?1, ?2, ?3, ?4)",
        params![
            material.id,
            material.title,
            material.raw_text,
            material.source_url.clone().unwrap_or_default(),
        ],
    )?;
    Ok(())
}

/// 把尚未进入 FTS 索引的素材补齐（老库升级、或索引与主表不同步时用）。
pub fn backfill_material_fts(conn: &Connection) -> Result<usize> {
    let missing: Vec<(String, String, String, Option<String>)> = {
        let mut stmt = conn.prepare(
            "SELECT m.id, m.title, m.raw_text, m.source_url
             FROM materials m
             LEFT JOIN fts_materials f ON f.material_id = m.id
             WHERE m.is_deleted = 0 AND f.material_id IS NULL",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        out
    };

    for (id, title, raw_text, source_url) in &missing {
        conn.execute(
            "INSERT INTO fts_materials (material_id, title, raw_text, source_url) VALUES (?1, ?2, ?3, ?4)",
            params![id, title, raw_text, source_url.clone().unwrap_or_default()],
        )?;
    }
    Ok(missing.len())
}

/// 素材全文检索：FTS5 前缀匹配 + LIKE 兜底，返回与卡片检索同形的 Entry 数据。
pub fn search_materials_fts(conn: &Connection, query: &str, limit: i64) -> Result<Vec<RawMaterialDto>> {
    let clean_query = query.trim();
    if clean_query.is_empty() {
        return list_materials(conn, false, limit);
    }

    let match_query = clean_query
        .split_whitespace()
        .map(|w| format!("\"{}\"*", w.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND ");

    let mut cards = Vec::new();
    {
        let mut stmt = conn.prepare(
            r#"
            SELECT m.id, m.source_type, m.title, m.source_url, m.raw_text, m.cleaned_markdown,
                   m.content_hash, m.media_path, m.media_size_bytes, m.metadata_json,
                   m.inbox_status, m.created_at, m.updated_at
            FROM fts_materials f
            JOIN materials m ON f.material_id = m.id
            WHERE m.is_deleted = 0 AND fts_materials MATCH ?1
            ORDER BY bm25(fts_materials) ASC
            LIMIT ?2
            "#,
        )?;
        let rows = stmt.query_map(params![match_query, limit], map_material_row)?;
        for r in rows {
            cards.push(r?);
        }
    }

    if cards.is_empty() {
        let wildcard = format!("%{}%", clean_query);
        let mut fallback = conn.prepare(
            r#"
            SELECT id, source_type, title, source_url, raw_text, cleaned_markdown,
                   content_hash, media_path, media_size_bytes, metadata_json,
                   inbox_status, created_at, updated_at
            FROM materials
            WHERE is_deleted = 0 AND (title LIKE ?1 OR raw_text LIKE ?1 OR source_url LIKE ?1)
            ORDER BY created_at DESC
            LIMIT ?2
            "#,
        )?;
        let rows = fallback.query_map(params![wildcard, limit], map_material_row)?;
        for r in rows {
            cards.push(r?);
        }
    }

    Ok(cards)
}

fn map_material_row(row: &rusqlite::Row) -> rusqlite::Result<RawMaterialDto> {
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
    let rows = stmt.query_map(params![limit], map_material_row)?;

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
    if conn.is_autocommit() {
        let tx = conn.unchecked_transaction()?;
        upsert_card_inner(&tx, card)?;
        tx.commit()
    } else {
        upsert_card_inner(conn, card)
    }
}

fn upsert_card_inner(conn: &Connection, card: &KnowledgeCardDto) -> Result<()> {
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
            created_at, edited_at, updated_at, version, is_deleted, deleted_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6,
            ?7, ?8, ?9, ?10, ?11, ?12,
            ?13, ?14, ?15, ?16,
            ?17, ?18, ?19, ?20, ?21,
            ?22, ?23, ?24, ?25, ?26, ?27,
            ?28, ?29, ?30, 1, 0, NULL
        )
        ON CONFLICT(id) DO UPDATE SET
            material_id = excluded.material_id,
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
            edited_at = excluded.edited_at,
            updated_at = excluded.updated_at,
            version = cards.version + 1,
            is_deleted = 0,
            deleted_at = NULL
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
            card.edited_at,
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

pub fn replace_cards(conn: &mut Connection, cards: &[KnowledgeCardDto]) -> Result<()> {
    let tx = conn.transaction()?;
    let now = chrono_or_epoch_now();

    tx.execute("CREATE TEMP TABLE IF NOT EXISTS temp_active_ids (id TEXT PRIMARY KEY)", [])?;
    tx.execute("DELETE FROM temp_active_ids", [])?;

    {
        let mut insert_temp_stmt = tx.prepare("INSERT OR REPLACE INTO temp_active_ids (id) VALUES (?1)")?;
        for card in cards {
            insert_temp_stmt.execute(params![card.id])?;
        }
    }

    // 将未在传入列表中的卡片软删除
    tx.execute(
        "UPDATE cards SET is_deleted = 1, deleted_at = ?1 WHERE is_deleted = 0 AND id NOT IN (SELECT id FROM temp_active_ids)",
        params![now],
    )?;

    // 从 FTS 索引中清理所有软删除的卡片
    tx.execute(
        "DELETE FROM fts_cards WHERE card_id IN (SELECT id FROM cards WHERE is_deleted = 1)",
        [],
    )?;

    // 全量 upsert 传入卡片并建立最新 FTS5 索引
    for card in cards {
        upsert_card(&tx, card)?;
    }

    tx.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('legacy_cards_migrated', '1')", [])?;
    tx.execute("DELETE FROM temp_active_ids", [])?;
    tx.commit()?;
    Ok(())
}

fn map_card_row(row: &rusqlite::Row) -> rusqlite::Result<KnowledgeCardDto> {
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
}

pub fn list_cards(conn: &Connection, limit: i64, offset: i64) -> Result<Vec<KnowledgeCardDto>> {
    let sql = if limit < 0 {
        r#"
        SELECT
            id, material_id, category, headline, summary, details,
            links_json, tags_json, source, seen_at, swiped, is_favorite,
            favorited_at, review_count, mastery_level, last_reviewed_at,
            repetition, interval_days, ease_factor, stability, difficulty,
            subject, branch, level, track, order_key, prereq_json,
            created_at, edited_at
        FROM cards
        WHERE is_deleted = 0
        ORDER BY created_at DESC
        LIMIT -1 OFFSET ?1
        "#
    } else {
        r#"
        SELECT
            id, material_id, category, headline, summary, details,
            links_json, tags_json, source, seen_at, swiped, is_favorite,
            favorited_at, review_count, mastery_level, last_reviewed_at,
            repetition, interval_days, ease_factor, stability, difficulty,
            subject, branch, level, track, order_key, prereq_json,
            created_at, edited_at
        FROM cards
        WHERE is_deleted = 0
        ORDER BY created_at DESC
        LIMIT ?1 OFFSET ?2
        "#
    };

    let mut stmt = conn.prepare(sql)?;
    let mut cards = Vec::new();
    if limit < 0 {
        let rows = stmt.query_map(params![offset], map_card_row)?;
        for r in rows {
            cards.push(r?);
        }
    } else {
        let rows = stmt.query_map(params![limit, offset], map_card_row)?;
        for r in rows {
            cards.push(r?);
        }
    }
    Ok(cards)
}

pub fn search_cards_fts(conn: &Connection, query: &str, limit: i64) -> Result<Vec<KnowledgeCardDto>> {
    let clean_query = query.trim();
    if clean_query.is_empty() {
        return list_cards(conn, limit, 0);
    }

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
            c.created_at, c.edited_at
        FROM fts_cards f
        JOIN cards c ON f.card_id = c.id
        WHERE c.is_deleted = 0 AND fts_cards MATCH ?1
        ORDER BY bm25(fts_cards) ASC
        LIMIT ?2
        "#,
    )?;

    let rows = stmt.query_map(params![match_query, limit], map_card_row)?;
    let mut cards = Vec::new();
    for r in rows {
        cards.push(r?);
    }

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
                created_at, edited_at
            FROM cards
            WHERE is_deleted = 0 AND (headline LIKE ?1 OR details LIKE ?1 OR summary LIKE ?1 OR category LIKE ?1)
            ORDER BY created_at DESC
            LIMIT ?2
            "#,
        )?;
        let fb_rows = fallback_stmt.query_map(params![wildcard, limit], map_card_row)?;
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

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionDto {
    pub id: String,
    /// 'rss' | 'github_release' | 'github_trending' | 'tech_board'
    pub r#type: String,
    pub title: String,
    pub target_url: String,
    pub interval_minutes: i64,
    pub last_polled_at: Option<i64>,
    pub is_active: bool,
    pub created_at: i64,
}

pub fn save_subscription(conn: &Connection, sub: &SubscriptionDto) -> Result<()> {
    conn.execute(
        r#"
        INSERT INTO subscriptions (id, type, title, target_url, interval_minutes, last_polled_at, is_active, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(id) DO UPDATE SET
            type = excluded.type,
            title = excluded.title,
            target_url = excluded.target_url,
            interval_minutes = excluded.interval_minutes,
            is_active = excluded.is_active
        "#,
        params![
            sub.id,
            sub.r#type,
            sub.title,
            sub.target_url,
            sub.interval_minutes,
            sub.last_polled_at,
            if sub.is_active { 1 } else { 0 },
            sub.created_at,
        ],
    )?;
    Ok(())
}

/// 只更新轮询时间：抓完一条订阅不该顺手把它的类型/标题也覆盖一遍。
pub fn mark_subscription_polled(conn: &Connection, id: &str, polled_at: i64) -> Result<()> {
    let changed = conn.execute(
        "UPDATE subscriptions SET last_polled_at = ?1 WHERE id = ?2",
        params![polled_at, id],
    )?;
    if changed == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    Ok(())
}

pub fn list_subscriptions(conn: &Connection) -> Result<Vec<SubscriptionDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, type, title, target_url, interval_minutes, last_polled_at, is_active, created_at
         FROM subscriptions ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(SubscriptionDto {
            id: row.get(0)?,
            r#type: row.get(1)?,
            title: row.get(2)?,
            target_url: row.get(3)?,
            interval_minutes: row.get(4)?,
            last_polled_at: row.get(5)?,
            is_active: row.get::<_, i64>(6)? != 0,
            created_at: row.get(7)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn delete_subscription(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM subscriptions WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn save_artifact(conn: &Connection, artifact: &ArtifactDto) -> Result<()> {
    let source_ids_json = serde_json::to_string(&artifact.source_card_ids)
        .unwrap_or_else(|_| "[]".to_string());
    conn.execute(
        r#"
        INSERT INTO artifacts (
            id, artifact_type, title, content_markdown, source_card_ids,
            date_scope_start, date_scope_end, created_at, updated_at, is_deleted
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0)
        ON CONFLICT(id) DO UPDATE SET
            artifact_type = excluded.artifact_type,
            title = excluded.title,
            content_markdown = excluded.content_markdown,
            source_card_ids = excluded.source_card_ids,
            date_scope_start = excluded.date_scope_start,
            date_scope_end = excluded.date_scope_end,
            updated_at = excluded.updated_at,
            is_deleted = 0
        "#,
        params![
            artifact.id,
            artifact.artifact_type,
            artifact.title,
            artifact.content_markdown,
            source_ids_json,
            artifact.date_scope_start,
            artifact.date_scope_end,
            artifact.created_at,
            artifact.updated_at,
        ],
    )?;
    Ok(())
}

pub fn list_artifacts(conn: &Connection, limit: i64) -> Result<Vec<ArtifactDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, artifact_type, title, content_markdown, source_card_ids, date_scope_start, date_scope_end, created_at, updated_at, is_deleted
         FROM artifacts WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT ?1"
    )?;
    let rows = stmt.query_map(params![limit], |row| {
        let source_ids_str: String = row.get(4)?;
        let source_ids: Vec<String> = serde_json::from_str(&source_ids_str).unwrap_or_default();
        let is_del_int: i64 = row.get(9)?;
        Ok(ArtifactDto {
            id: row.get(0)?,
            artifact_type: row.get(1)?,
            title: row.get(2)?,
            content_markdown: row.get(3)?,
            source_card_ids: source_ids,
            date_scope_start: row.get(5)?,
            date_scope_end: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
            is_deleted: is_del_int != 0,
        })
    })?;
    let mut list = Vec::new();
    for r in rows {
        list.push(r?);
    }
    Ok(list)
}

pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        norm_a += a[i] * a[i];
        norm_b += b[i] * b[i];
    }
    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom == 0.0 {
        0.0
    } else {
        dot / denom
    }
}

pub fn save_card_embedding(conn: &Connection, card_id: &str, embedding: &[f32]) -> Result<()> {
    let mut bytes = Vec::with_capacity(embedding.len() * 4);
    for &val in embedding {
        bytes.extend_from_slice(&val.to_le_bytes());
    }
    let now = chrono_or_epoch_now();
    conn.execute(
        r#"
        INSERT INTO card_embeddings (card_id, dim, embedding, updated_at)
        VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(card_id) DO UPDATE SET
            dim = excluded.dim,
            embedding = excluded.embedding,
            updated_at = excluded.updated_at
        "#,
        params![card_id, embedding.len() as i64, bytes, now],
    )?;
    Ok(())
}

pub fn list_unembedded_card_ids(conn: &Connection, limit: i64) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT c.id FROM cards c
         LEFT JOIN card_embeddings e ON c.id = e.card_id
         WHERE c.is_deleted = 0 AND e.card_id IS NULL
         ORDER BY c.created_at DESC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map([limit], |r| r.get(0))?;
    let mut ids = Vec::new();
    for r in rows {
        ids.push(r?);
    }
    Ok(ids)
}

pub fn save_card_embeddings_batch(
    conn: &mut Connection,
    items: &[(String, Vec<f32>)],
) -> Result<()> {
    let tx = conn.transaction()?;
    let now = chrono_or_epoch_now();
    for (card_id, embedding) in items {
        let mut bytes = Vec::with_capacity(embedding.len() * 4);
        for &val in embedding {
            bytes.extend_from_slice(&val.to_le_bytes());
        }
        tx.execute(
            r#"
            INSERT INTO card_embeddings (card_id, dim, embedding, updated_at)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(card_id) DO UPDATE SET
                dim = excluded.dim,
                embedding = excluded.embedding,
                updated_at = excluded.updated_at
            "#,
            params![card_id, embedding.len() as i64, bytes, now],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn search_cards_vector(
    conn: &Connection,
    query_embedding: &[f32],
    limit: usize,
) -> Result<Vec<(KnowledgeCardDto, f32)>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.material_id, c.category, c.headline, c.summary, c.details,
                c.links_json, c.tags_json, c.source, c.seen_at, c.swiped, c.is_favorite,
                c.favorited_at, c.review_count, c.mastery_level, c.last_reviewed_at,
                c.repetition, c.interval_days, c.ease_factor, c.stability, c.difficulty,
                c.subject, c.branch, c.level, c.track, c.order_key, c.prereq_json,
                c.created_at, c.edited_at, e.embedding
         FROM cards c
         INNER JOIN card_embeddings e ON c.id = e.card_id
         WHERE c.is_deleted = 0"
    )?;

    let rows = stmt.query_map([], |row| {
        let card = map_card_row(row)?;
        let emb_bytes: Vec<u8> = row.get(29)?;
        Ok((card, emb_bytes))
    })?;

    let mut scored: Vec<(KnowledgeCardDto, f32)> = Vec::new();
    for r in rows {
        let (card, bytes) = r?;
        if bytes.len() % 4 == 0 {
            let mut vec = Vec::with_capacity(bytes.len() / 4);
            for chunk in bytes.chunks_exact(4) {
                let arr: [u8; 4] = chunk.try_into().unwrap();
                vec.push(f32::from_le_bytes(arr));
            }
            let sim = cosine_similarity(query_embedding, &vec);
            scored.push((card, sim));
        }
    }

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    if scored.len() > limit {
        scored.truncate(limit);
    }
    Ok(scored)
}

pub fn search_cards_hybrid(
    conn: &Connection,
    query_text: &str,
    query_embedding: Option<&[f32]>,
    limit: usize,
) -> Result<Vec<KnowledgeCardDto>> {
    let k = 60.0f32;
    let mut rrf_scores: std::collections::HashMap<String, (KnowledgeCardDto, f32)> =
        std::collections::HashMap::new();

    // 1. FTS5 关键词排序
    if !query_text.trim().is_empty() {
        let fts_results = search_cards_fts(conn, query_text, (limit * 2) as i64).unwrap_or_default();
        for (rank, card) in fts_results.into_iter().enumerate() {
            let contrib = 1.0 / (k + rank as f32 + 1.0);
            let entry = rrf_scores.entry(card.id.clone()).or_insert_with(|| (card, 0.0));
            entry.1 += contrib;
        }
    }

    // 2. 向量相似度排序
    if let Some(emb) = query_embedding {
        if !emb.is_empty() {
            let vec_results = search_cards_vector(conn, emb, limit * 2).unwrap_or_default();
            for (rank, (card, _sim)) in vec_results.into_iter().enumerate() {
                let contrib = 1.0 / (k + rank as f32 + 1.0);
                let entry = rrf_scores.entry(card.id.clone()).or_insert_with(|| (card, 0.0));
                entry.1 += contrib;
            }
        }
    }

    let mut ranked: Vec<(KnowledgeCardDto, f32)> = rrf_scores.into_values().collect();
    ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    if ranked.len() > limit {
        ranked.truncate(limit);
    }
    Ok(ranked.into_iter().map(|(c, _)| c).collect())
}

pub fn migrate_legacy_cards_json(conn: &Connection, json_str: &str) -> Result<usize> {
    let cards: Vec<KnowledgeCardDto> = serde_json::from_str(json_str)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

    let count = cards.len();
    let tx = conn.unchecked_transaction()?;
    for card in &cards {
        upsert_card(&tx, card)?;
    }
    tx.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('legacy_cards_migrated', '1')",
        [],
    )?;
    tx.commit()?;
    Ok(count)
}

pub fn has_migrated_legacy_cards(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT value FROM meta WHERE key = 'legacy_cards_migrated'",
        [],
        |row| row.get::<_, String>(0),
    )
    .map(|val| val == "1" || val == "true")
    .unwrap_or(false)
}

pub fn is_cards_table_empty(conn: &Connection) -> bool {
    let total_rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM cards", [], |row| row.get(0))
        .unwrap_or(0);
    total_rows == 0
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

        let cards = list_cards(&conn, 10, 0).unwrap();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].headline, "SQLite-vec 暴力向量检索优势");
        assert!(cards[0].is_favorite);

        let search_results = search_cards_fts(&conn, "SQLite", 10).unwrap();
        assert_eq!(search_results.len(), 1);
        assert_eq!(search_results[0].id, "card-1");

        let search_no_match = search_cards_fts(&conn, "毫无关系的词汇", 10).unwrap();
        assert_eq!(search_no_match.len(), 0);

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

        let stats = get_db_stats(&conn).unwrap();
        assert_eq!(stats.total_cards, 1);
        assert_eq!(stats.total_materials, 1);
        assert_eq!(stats.inbox_materials, 1);
        assert_eq!(stats.favorite_cards, 1);

        delete_card(&conn, "card-1").unwrap();
        let empty_cards = list_cards(&conn, 10, 0).unwrap();
        assert_eq!(empty_cards.len(), 0);
    }

    #[test]
    fn test_material_fts_index_lifecycle() {
        let conn = Connection::open_in_memory().unwrap();
        init_tables(&conn).unwrap();

        let mut material = RawMaterialDto {
            id: "mat-fts-1".to_string(),
            source_type: "web".to_string(),
            title: "CMP 跨端渲染可行性备忘".to_string(),
            source_url: Some("https://example.com/cmp".to_string()),
            raw_text: "结论：共享界面用 Compose Multiplatform，宿主边界留在平台侧。".to_string(),
            cleaned_markdown: None,
            content_hash: calculate_hash("x"),
            media_path: None,
            media_size_bytes: 0,
            metadata_json: "{}".to_string(),
            inbox_status: "inbox".to_string(),
            created_at: 1700000000000,
            updated_at: 1700000000000,
        };
        save_material(&conn, &material).unwrap();

        // 中文前缀命中（FTS5 trigram + remove_diacritics 分词路径）
        let by_title = search_materials_fts(&conn, "跨端", 10).unwrap();
        assert_eq!(by_title.len(), 1);
        assert_eq!(by_title[0].id, "mat-fts-1");

        // 正文命中
        let by_body = search_materials_fts(&conn, "Compose", 10).unwrap();
        assert_eq!(by_body.len(), 1);

        // 未命中返回空，不回落出无关结果
        let miss = search_materials_fts(&conn, "完全无关的术语", 10).unwrap();
        assert_eq!(miss.len(), 0);

        // 空查询等于全量列举
        let all = search_materials_fts(&conn, "   ", 10).unwrap();
        assert_eq!(all.len(), 1);

        // 编辑正文后重建索引：旧词不再命中，新词命中
        material.raw_text = "改版：改用 Web 前端与 Tauri 壳承载同一套界面。".to_string();
        material.updated_at = 1700000099000;
        save_material(&conn, &material).unwrap();
        assert_eq!(search_materials_fts(&conn, "Compose", 10).unwrap().len(), 0);
        let after_edit = search_materials_fts(&conn, "Tauri", 10).unwrap();
        assert_eq!(after_edit.len(), 1);
        // 同一条素材不该在索引里留下重复行
        let dupes: i64 = conn
            .query_row("SELECT COUNT(*) FROM fts_materials WHERE material_id = 'mat-fts-1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(dupes, 1);

        // 索引被清空后（模拟老库升级），backfill 能补回主表里的素材
        conn.execute("DELETE FROM fts_materials", []).unwrap();
        let indexed_after_clear: i64 = conn
            .query_row("SELECT COUNT(*) FROM fts_materials", [], |r| r.get(0))
            .unwrap();
        assert_eq!(indexed_after_clear, 0);
        // 注意：此时 search 仍会命中——因为 FTS 空结果会走 LIKE 兜底，而不是返回空。
        // 兜底是「索引没建起来也别丢功能」的保险，不代表索引有效。
        assert_eq!(search_materials_fts(&conn, "Tauri", 10).unwrap().len(), 1);
        let synced = backfill_material_fts(&conn).unwrap();
        assert_eq!(synced, 1);
        let indexed_after_backfill: i64 = conn
            .query_row("SELECT COUNT(*) FROM fts_materials", [], |r| r.get(0))
            .unwrap();
        assert_eq!(indexed_after_backfill, 1);
        // 幂等：再跑一次不重复插入
        assert_eq!(backfill_material_fts(&conn).unwrap(), 0);
    }

    #[test]
    fn test_subscription_lifecycle() {
        let conn = Connection::open_in_memory().unwrap();
        init_tables(&conn).unwrap();

        let sub = SubscriptionDto {
            id: "sub-1".to_string(),
            r#type: "rss".to_string(),
            title: "技术周刊".to_string(),
            target_url: "https://example.com/feed.xml".to_string(),
            interval_minutes: 360,
            last_polled_at: None,
            is_active: true,
            created_at: 1700000000000,
        };
        save_subscription(&conn, &sub).unwrap();

        let list = list_subscriptions(&conn).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "技术周刊");
        assert!(list[0].is_active);
        assert_eq!(list[0].last_polled_at, None);

        // 同 id 再存是更新而不是插重复；但轮询时间不被 save 覆盖
        mark_subscription_polled(&conn, "sub-1", 1700000900000).unwrap();
        let mut updated = sub.clone();
        updated.is_active = false;
        updated.title = "技术周刊（改名）".to_string();
        save_subscription(&conn, &updated).unwrap();
        let after = list_subscriptions(&conn).unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].title, "技术周刊（改名）");
        assert!(!after[0].is_active);
        assert_eq!(after[0].last_polled_at, Some(1700000900000));

        // 标记不存在的订阅要报错，而不是静默成功
        assert!(mark_subscription_polled(&conn, "missing", 1).is_err());

        delete_subscription(&conn, "sub-1").unwrap();
        assert_eq!(list_subscriptions(&conn).unwrap().len(), 0);
    }

    #[test]
    fn test_empty_dir_normalization() {
        let default_dir = crate::store::default_library_dir();
        assert_eq!(resolve_library_dir(None), default_dir);
        assert_eq!(resolve_library_dir(Some("")), default_dir);
        assert_eq!(resolve_library_dir(Some("   ")), default_dir);
        assert_eq!(resolve_library_dir(Some("  \t\n  ")), default_dir);

        let custom = resolve_library_dir(Some("/tmp/custom_knowflick_dir"));
        assert_eq!(custom, PathBuf::from("/tmp/custom_knowflick_dir"));

        // 测试 open_db 面对多级不存在父目录时自动递归创建并成功建库
        let unique_id = uuid::Uuid::new_v4().to_string();
        let temp_parent = std::env::temp_dir()
            .join(format!("kf_test_dir_norm_{}", unique_id))
            .join("sub1")
            .join("sub2");
        let db_path = temp_parent.join("knowflick.db");

        assert!(!temp_parent.exists());
        let conn = open_db(&db_path).expect("open_db must auto-create parent dir");
        assert!(temp_parent.exists());
        assert!(db_path.exists());

        // 验证表成功初始化
        let stats = get_db_stats(&conn).unwrap();
        assert_eq!(stats.total_cards, 0);

        drop(conn);
        let _ = std::fs::remove_dir_all(std::env::temp_dir().join(format!("kf_test_dir_norm_{}", unique_id)));
    }

    #[test]
    fn test_legacy_format_migration() {
        let conn = Connection::open_in_memory().unwrap();
        init_tables(&conn).unwrap();

        // 模拟旧版 cards.json：带 ISO 8601 日期、毫秒浮点数、省略非必填字段
        let legacy_json = r#"[
            {
                "id": "legacy-1",
                "category": "历史",
                "headline": "印刷术的演进",
                "summary": "活字印刷的传播历程",
                "details": "毕昇发明的泥活字对后世书籍制作产生了深远影响。",
                "source": "imported",
                "createdAt": "2023-11-14T22:13:20Z",
                "isFavorite": true
            },
            {
                "id": "legacy-2",
                "category": "物理",
                "headline": "引力透镜效应",
                "summary": "时空弯曲对光线的偏折",
                "details": "爱因斯坦广义相对论预言的经典现象。",
                "createdAt": "2026-01-02T03:04:05.678Z",
                "seenAt": "2026-01-02T03:10:00Z",
                "swiped": "right"
            }
        ]"#;

        let migrated = migrate_legacy_cards_json(&conn, legacy_json).expect("should successfully migrate legacy cards");
        assert_eq!(migrated, 2);

        let cards = list_cards(&conn, -1, 0).unwrap();
        assert_eq!(cards.len(), 2);

        // 验证 ISO 日期解析精确度（2023-11-14T22:13:20Z = 1700000000000）
        let c1 = cards.iter().find(|c| c.id == "legacy-1").unwrap();
        assert_eq!(c1.created_at, 1700000000000);
        assert_eq!(c1.ease_factor, 2.5); // 省略字段使用默认值
        assert_eq!(c1.review_count, 0);
        assert!(c1.is_favorite);
        assert_eq!(c1.edited_at, None);

        let c2 = cards.iter().find(|c| c.id == "legacy-2").unwrap();
        assert_eq!(c2.created_at, 1767323045678);
        assert_eq!(c2.seen_at, Some(1767323400000));
        assert_eq!(c2.category, "物理");

        // 验证非法损坏 JSON 绝不静默返回 Ok(0)，必须报错
        let broken_json = "{ broken json content";
        let err_result = migrate_legacy_cards_json(&conn, broken_json);
        assert!(err_result.is_err(), "broken json must return Err");
    }

    #[test]
    fn test_delete_card_does_not_resurrect() {
        let unique_id = uuid::Uuid::new_v4().to_string();
        let test_dir = std::env::temp_dir().join(format!("kf_test_no_resurrect_{}", unique_id));
        std::fs::create_dir_all(&test_dir).unwrap();

        let cards_json_path = test_dir.join("cards.json");
        let initial_json = r#"[
            {
                "id": "del-1",
                "category": "哲学",
                "headline": "苏格拉底之死",
                "summary": "关于真理的坚持",
                "details": "雅典审判与申辩篇记录。",
                "createdAt": "2023-11-14T22:13:20Z"
            }
        ]"#;
        std::fs::write(&cards_json_path, initial_json).unwrap();

        let db_path = test_dir.join("knowflick.db");
        let mut conn = open_db(&db_path).unwrap();

        // 第一次启动模拟：迁移旧 JSON
        assert!(!has_migrated_legacy_cards(&conn));
        assert!(is_cards_table_empty(&conn));
        migrate_legacy_cards_json(&conn, initial_json).unwrap();
        assert!(has_migrated_legacy_cards(&conn));

        let loaded = list_cards(&conn, -1, 0).unwrap();
        assert_eq!(loaded.len(), 1);

        // 删除卡片
        delete_card(&conn, "del-1").unwrap();
        let after_delete = list_cards(&conn, -1, 0).unwrap();
        assert_eq!(after_delete.len(), 0);

        // 重启模拟：再次执行检测逻辑，验证已删除卡片绝不反复复活
        assert!(has_migrated_legacy_cards(&conn));
        assert!(!is_cards_table_empty(&conn)); // 表中有行（is_deleted = 1），绝不复活

        // 即使再次调用 migrate 守卫逻辑也不会重复迁移
        if !has_migrated_legacy_cards(&conn) && is_cards_table_empty(&conn) {
            let text = std::fs::read_to_string(&cards_json_path).unwrap();
            migrate_legacy_cards_json(&conn, &text).unwrap();
        }

        let final_cards = list_cards(&conn, -1, 0).unwrap();
        assert_eq!(final_cards.len(), 0, "deleted card must NOT resurrect");

        // 验证 replace_cards 传入空列表时同样彻底删除且不复活
        replace_cards(&mut conn, &[]).unwrap();
        let final_cards2 = list_cards(&conn, -1, 0).unwrap();
        assert_eq!(final_cards2.len(), 0);

        drop(conn);
        let _ = std::fs::remove_dir_all(&test_dir);
    }

    #[test]
    fn test_material_edit_restart_persistence() {
        let unique_id = uuid::Uuid::new_v4().to_string();
        let test_dir = std::env::temp_dir().join(format!("kf_test_mat_persist_{}", unique_id));
        std::fs::create_dir_all(&test_dir).unwrap();
        let db_path = test_dir.join("knowflick.db");

        {
            let conn = open_db(&db_path).unwrap();
            let mat = RawMaterialDto {
                id: "mat-persist-1".to_string(),
                source_type: "manual".to_string(),
                title: "初始标题".to_string(),
                source_url: Some("https://example.com/a".to_string()),
                raw_text: "初始文本内容".to_string(),
                cleaned_markdown: Some("初始 Markdown".to_string()),
                content_hash: "wrong_fake_hash".to_string(), // 后端应自行重新算
                media_path: Some("/tmp/old.png".to_string()),
                media_size_bytes: 1024,
                metadata_json: r#"{"author":"alice"}"#.to_string(),
                inbox_status: "inbox".to_string(),
                created_at: 1700000000000,
                updated_at: 1700000000000,
            };
            save_material(&conn, &mat).unwrap();

            // 验证 hash 是后端根据 raw_text 重新计算的
            let list = list_materials(&conn, false, 10).unwrap();
            assert_eq!(list.len(), 1);
            assert_eq!(list[0].content_hash, calculate_hash("初始文本内容"));

            // 编辑更新材料的所有字段
            let updated_mat = RawMaterialDto {
                id: "mat-persist-1".to_string(),
                source_type: "web".to_string(),
                title: "更新后的标题".to_string(),
                source_url: Some("https://example.com/updated".to_string()),
                raw_text: "更新后的文本正文".to_string(),
                cleaned_markdown: Some("更新后的 Markdown".to_string()),
                content_hash: "another_fake".to_string(),
                media_path: Some("/tmp/new.png".to_string()),
                media_size_bytes: 4096,
                metadata_json: r#"{"author":"bob","tags":["updated"]}"#.to_string(),
                inbox_status: "processed".to_string(),
                created_at: 1700000000000,
                updated_at: 1700000099000,
            };
            save_material(&conn, &updated_mat).unwrap();

            // 验证 version 自增为 2
            let version: i64 = conn.query_row(
                "SELECT version FROM materials WHERE id = 'mat-persist-1'",
                [],
                |r| r.get(0),
            ).unwrap();
            assert_eq!(version, 2);
        }

        // 模拟应用重启，重新打开连接
        {
            let conn = open_db(&db_path).unwrap();
            let list = list_materials(&conn, false, 10).unwrap();
            assert_eq!(list.len(), 1);
            let m = &list[0];
            assert_eq!(m.id, "mat-persist-1");
            assert_eq!(m.source_type, "web");
            assert_eq!(m.title, "更新后的标题");
            assert_eq!(m.source_url, Some("https://example.com/updated".to_string()));
            assert_eq!(m.raw_text, "更新后的文本正文");
            assert_eq!(m.cleaned_markdown, Some("更新后的 Markdown".to_string()));
            assert_eq!(m.content_hash, calculate_hash("更新后的文本正文"));
            assert_eq!(m.media_path, Some("/tmp/new.png".to_string()));
            assert_eq!(m.media_size_bytes, 4096);
            assert_eq!(m.metadata_json, r#"{"author":"bob","tags":["updated"]}"#);
            assert_eq!(m.inbox_status, "processed");
            assert_eq!(m.updated_at, 1700000099000);
        }

        let _ = std::fs::remove_dir_all(&test_dir);
    }

    #[test]
    fn test_card_roundtrip_fields() {
        let conn = Connection::open_in_memory().unwrap();
        init_tables(&conn).unwrap();

        // 插入被引用的素材以满足外键约束
        let parent_mat = RawMaterialDto {
            id: "mat-assoc-1".to_string(),
            source_type: "manual".to_string(),
            title: "关联素材".to_string(),
            source_url: None,
            raw_text: "关联素材正文".to_string(),
            cleaned_markdown: None,
            content_hash: calculate_hash("关联素材正文"),
            media_path: None,
            media_size_bytes: 0,
            metadata_json: "{}".to_string(),
            inbox_status: "inbox".to_string(),
            created_at: 1700000000000,
            updated_at: 1700000000000,
        };
        save_material(&conn, &parent_mat).unwrap();

        let original_card = KnowledgeCardDto {
            id: "card-roundtrip-1".to_string(),
            material_id: Some("mat-assoc-1".to_string()),
            category: "计算机科学".to_string(),
            headline: "B-Tree 索引分裂机制".to_string(),
            summary: "节点满时的向上分裂原理".to_string(),
            details: "当叶子节点容量达到阶数上限时，产生分裂并将中位键提升至父节点。".to_string(),
            links: vec![ScienceLinkDto {
                title: "Database Internals".to_string(),
                url: "https://example.com/btree".to_string(),
            }],
            tags: vec!["db".to_string(), "index".to_string(), "tree".to_string()],
            source: "manual".to_string(),
            created_at: 1700000000000,
            edited_at: None, // 验证 edited_at null 语义保持为 None
            seen_at: Some(1700000010000),
            swiped: Some("right".to_string()),
            is_favorite: true,
            favorited_at: Some(1700000015000),
            review_count: 7,
            mastery_level: 4,
            last_reviewed_at: Some(1700000020000),
            repetition: 3,
            interval_days: 6.5,
            ease_factor: 2.8,
            stability: 4.2,
            difficulty: 3.1,
            subject: Some("数据结构".to_string()),
            branch: Some("高级树结构".to_string()),
            level: Some(3),
            track: Some("核心课".to_string()),
            order_key: Some("003.01".to_string()),
            prereq: vec!["binary-search-tree".to_string()],
        };

        upsert_card(&conn, &original_card).unwrap();

        let cards = list_cards(&conn, -1, 0).unwrap();
        assert_eq!(cards.len(), 1);
        let loaded = &cards[0];

        assert_eq!(loaded.id, original_card.id);
        assert_eq!(loaded.material_id, Some("mat-assoc-1".to_string()));
        assert_eq!(loaded.category, original_card.category);
        assert_eq!(loaded.headline, original_card.headline);
        assert_eq!(loaded.summary, original_card.summary);
        assert_eq!(loaded.details, original_card.details);
        assert_eq!(loaded.links, original_card.links);
        assert_eq!(loaded.tags, original_card.tags);
        assert_eq!(loaded.source, original_card.source);
        assert_eq!(loaded.created_at, original_card.created_at);
        assert_eq!(loaded.edited_at, None, "edited_at null must roundtrip as None");
        assert_eq!(loaded.seen_at, original_card.seen_at);
        assert_eq!(loaded.swiped, original_card.swiped);
        assert_eq!(loaded.is_favorite, true);
        assert_eq!(loaded.favorited_at, original_card.favorited_at);
        assert_eq!(loaded.review_count, 7);
        assert_eq!(loaded.mastery_level, 4);
        assert_eq!(loaded.last_reviewed_at, original_card.last_reviewed_at);
        assert_eq!(loaded.repetition, 3);
        assert_eq!(loaded.interval_days, 6.5);
        assert_eq!(loaded.ease_factor, 2.8);
        assert_eq!(loaded.stability, 4.2);
        assert_eq!(loaded.difficulty, 3.1);
        assert_eq!(loaded.subject, Some("数据结构".to_string()));
        assert_eq!(loaded.branch, Some("高级树结构".to_string()));
        assert_eq!(loaded.level, Some(3));
        assert_eq!(loaded.track, Some("核心课".to_string()));
        assert_eq!(loaded.order_key, Some("003.01".to_string()));
        assert_eq!(loaded.prereq, vec!["binary-search-tree".to_string()]);

        // 更新卡片：赋予 edited_at 值并更改 material_id 为 None
        let mut updated = loaded.clone();
        updated.material_id = None;
        updated.edited_at = Some(1700000099999);
        updated.headline = "B-Tree 索引分裂机制（更新）".to_string();
        upsert_card(&conn, &updated).unwrap();

        let cards2 = list_cards(&conn, -1, 0).unwrap();
        assert_eq!(cards2.len(), 1);
        assert_eq!(cards2[0].material_id, None, "material_id can be updated to None");
        assert_eq!(cards2[0].edited_at, Some(1700000099999), "edited_at Some value preserved");
        assert_eq!(cards2[0].headline, "B-Tree 索引分裂机制（更新）");
    }

    #[test]
    fn test_failed_replace_rollback() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_tables(&conn).unwrap();

        let c1 = KnowledgeCardDto {
            id: "card-rb-1".to_string(),
            material_id: None,
            category: "基础".to_string(),
            headline: "原卡片 1".to_string(),
            summary: "摘要 1".to_string(),
            details: "详情 1".to_string(),
            links: vec![],
            tags: vec![],
            source: "seed".to_string(),
            created_at: 1700000001000,
            edited_at: None,
            seen_at: None,
            swiped: None,
            is_favorite: false,
            favorited_at: None,
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
        let c2 = KnowledgeCardDto {
            id: "card-rb-2".to_string(),
            headline: "原卡片 2".to_string(),
            summary: "摘要 2".to_string(),
            details: "详情 2".to_string(),
            ..c1.clone()
        };

        upsert_card(&conn, &c1).unwrap();
        upsert_card(&conn, &c2).unwrap();

        let initial_cards = list_cards(&conn, -1, 0).unwrap();
        assert_eq!(initial_cards.len(), 2);

        // Force an actual failure through replace_cards, after it has deleted stale rows.
        conn.execute_batch("CREATE TRIGGER reject_bad_card BEFORE INSERT ON cards WHEN NEW.id = 'bad' BEGIN SELECT RAISE(ABORT, 'forced write failure'); END;").unwrap();
        let bad = KnowledgeCardDto { id: "bad".into(), ..c1.clone() };
        assert!(replace_cards(&mut conn, &[bad]).is_err());
        conn.execute_batch("DROP TRIGGER reject_bad_card;").unwrap();

        // A standalone upsert must roll back its content when index maintenance fails.
        // SQLite virtual tables cannot carry triggers; dropping the index forces the same seam.
        conn.execute_batch("DROP TABLE fts_cards;").unwrap();
        let changed = KnowledgeCardDto { headline: "must roll back".into(), ..c1.clone() };
        assert!(upsert_card(&conn, &changed).is_err());
        assert_eq!(list_cards(&conn, -1, 0).unwrap().iter().find(|c| c.id == c1.id).unwrap().headline, c1.headline);
        init_tables(&conn).unwrap();
        upsert_card(&conn, &c1).unwrap();
        upsert_card(&conn, &c2).unwrap();

        // 验证原卡片与 FTS 全量保留无损
        let after_rollback = list_cards(&conn, -1, 0).unwrap();
        assert_eq!(after_rollback.len(), 2);
        let fts_match = search_cards_fts(&conn, "原卡片", 10).unwrap();
        assert_eq!(fts_match.len(), 2);

        // 测试正常 replace_cards 原子替换（只保留 c2 并新增 c3，彻底不保留已删 c1）
        let c3 = KnowledgeCardDto {
            id: "card-rb-3".to_string(),
            headline: "新卡片 3".to_string(),
            summary: "摘要 3".to_string(),
            details: "详情 3".to_string(),
            ..c1.clone()
        };
        replace_cards(&mut conn, &[c2.clone(), c3.clone()]).unwrap();

        let replaced = list_cards(&conn, -1, 0).unwrap();
        assert_eq!(replaced.len(), 2);
        let ids: Vec<&str> = replaced.iter().map(|c| c.id.as_str()).collect();
        assert!(ids.contains(&"card-rb-2"));
        assert!(ids.contains(&"card-rb-3"));
        assert!(!ids.contains(&"card-rb-1"), "c1 was excluded and must not be retained");

        // FTS 也同步更新
        let fts_c1 = search_cards_fts(&conn, "原卡片 1", 10).unwrap();
        assert_eq!(fts_c1.len(), 0);
        let fts_c3 = search_cards_fts(&conn, "新卡片 3", 10).unwrap();
        assert_eq!(fts_c3.len(), 1);
    }

    #[test]
    fn test_artifact_lifecycle() {
        let conn = Connection::open_in_memory().unwrap();
        init_tables(&conn).unwrap();

        let artifact = ArtifactDto {
            id: "artifact-1".to_string(),
            artifact_type: "briefing".to_string(),
            title: "认知简报 · 第 42 周".to_string(),
            content_markdown: "# 认知简报\n\n- 本周新增卡片: 12条".to_string(),
            source_card_ids: vec!["card-1".to_string(), "card-2".to_string()],
            date_scope_start: Some(1700000000000),
            date_scope_end: Some(1700000604800),
            created_at: 1700000605000,
            updated_at: 1700000605000,
            is_deleted: false,
        };

        save_artifact(&conn, &artifact).unwrap();

        let list = list_artifacts(&conn, 10).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "artifact-1");
        assert_eq!(list[0].title, "认知简报 · 第 42 周");
        assert_eq!(list[0].source_card_ids, vec!["card-1".to_string(), "card-2".to_string()]);

        // 测试幂等更新
        let mut updated = artifact.clone();
        updated.title = "认知简报 · 终稿".to_string();
        save_artifact(&conn, &updated).unwrap();

        let list2 = list_artifacts(&conn, 10).unwrap();
        assert_eq!(list2.len(), 1);
        assert_eq!(list2[0].title, "认知简报 · 终稿");
    }

    #[test]
    fn test_vector_similarity_and_hybrid_rrf() {
        let conn = Connection::open_in_memory().unwrap();
        init_tables(&conn).unwrap();

        // 1. 验证余弦相似度边界
        assert_eq!(cosine_similarity(&[], &[]), 0.0);
        let v1 = vec![1.0, 0.0, 0.0];
        let v2 = vec![0.0, 1.0, 0.0];
        let v3 = vec![1.0, 0.0, 0.0];
        assert_eq!(cosine_similarity(&v1, &v2), 0.0);
        assert!((cosine_similarity(&v1, &v3) - 1.0).abs() < 1e-5);

        // 2. 插入测试卡片与对应向量
        let c1 = KnowledgeCardDto {
            id: "card-vec-1".to_string(),
            material_id: None,
            category: "计算机".to_string(),
            headline: "SQLite 全文索引与向量存储".to_string(),
            summary: "SQLite 内置 FTS5 与向量扩展。".to_string(),
            details: "利用轻量单文件数据库构建端侧第二大脑。".to_string(),
            links: vec![],
            tags: vec!["SQLite".to_string(), "架构".to_string()],
            source: "imported".to_string(),
            created_at: 1700000000000,
            edited_at: None,
            seen_at: None,
            swiped: None,
            is_favorite: false,
            favorited_at: None,
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
        let c2 = KnowledgeCardDto {
            id: "card-vec-2".to_string(),
            headline: "深度学习中的反向传播算法".to_string(),
            summary: "微积分链式法则在神经网络权重更新中的应用。".to_string(),
            details: "通过梯度下降优化损失函数。".to_string(),
            ..c1.clone()
        };
        upsert_card(&conn, &c1).unwrap();
        upsert_card(&conn, &c2).unwrap();

        // 验证尚未向量化的卡片列表
        let unembedded = list_unembedded_card_ids(&conn, 10).unwrap();
        assert_eq!(unembedded.len(), 2);
        assert!(unembedded.contains(&"card-vec-1".to_string()));
        assert!(unembedded.contains(&"card-vec-2".to_string()));

        // 存储向量 (4维测试向量)，测试批量保存
        let mut conn_mut = conn;
        save_card_embeddings_batch(
            &mut conn_mut,
            &[
                ("card-vec-1".to_string(), vec![0.9, 0.1, 0.0, 0.0]),
                ("card-vec-2".to_string(), vec![0.0, 0.1, 0.9, 0.8]),
            ],
        )
        .unwrap();
        let conn = conn_mut;

        // 保存后无遗留未嵌入卡片
        let unembedded_after = list_unembedded_card_ids(&conn, 10).unwrap();
        assert_eq!(unembedded_after.len(), 0);

        // 3. 纯向量检索：查询更接近 c1
        let query_vec = vec![0.85, 0.15, 0.0, 0.0];
        let vec_hits = search_cards_vector(&conn, &query_vec, 2).unwrap();
        assert_eq!(vec_hits.len(), 2);
        assert_eq!(vec_hits[0].0.id, "card-vec-1");
        assert!(vec_hits[0].1 > 0.9);

        // 4. 混合检索 RRF：FTS 命中 + 向量命中融合
        let hybrid_hits = search_cards_hybrid(&conn, "SQLite", Some(&query_vec), 2).unwrap();
        assert_eq!(hybrid_hits.len(), 2);
        assert_eq!(hybrid_hits[0].id, "card-vec-1");
    }
}
