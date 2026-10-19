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
    let row_mapper = |row: &rusqlite::Row| {
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
    };

    let mut cards = Vec::new();
    if limit < 0 {
        let rows = stmt.query_map(params![offset], row_mapper)?;
        for r in rows {
            cards.push(r?);
        }
    } else {
        let rows = stmt.query_map(params![limit, offset], row_mapper)?;
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

    let row_mapper = |row: &rusqlite::Row| {
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
    };

    let rows = stmt.query_map(params![match_query, limit], row_mapper)?;
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
        let fb_rows = fallback_stmt.query_map(params![wildcard, limit], row_mapper)?;
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
}
