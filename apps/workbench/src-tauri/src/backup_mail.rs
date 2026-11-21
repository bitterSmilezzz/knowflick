//! Portable, credential-free snapshot for mailbox accounts and sync ledgers.
//! Mail bodies live in `materials.json`; these rows preserve account identity,
//! UID cursors, rejected messages, and deduplication after an account is removed.
use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{db::RawMaterialDto, mail::MailAccountConfig};

const MAX_UID: i64 = u32::MAX as i64;
const REJECTION_REASONS: &[&str] = &["邮件大小超过导入上限", "无法读取邮件正文或 MIME 结构"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupMailConfig {
    pub id: String,
    pub name: String,
    pub email: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub folder: String,
    pub sync_limit: u16,
    pub sync_interval_minutes: u16,
}

impl From<MailAccountConfig> for BackupMailConfig {
    fn from(value: MailAccountConfig) -> Self {
        Self {
            id: value.id,
            name: value.name,
            email: value.email,
            host: value.host,
            port: value.port,
            username: value.username,
            folder: value.folder,
            sync_limit: value.sync_limit,
            sync_interval_minutes: value.sync_interval_minutes,
        }
    }
}

impl From<&BackupMailConfig> for MailAccountConfig {
    fn from(value: &BackupMailConfig) -> Self {
        Self {
            id: value.id.clone(),
            name: value.name.clone(),
            email: value.email.clone(),
            host: value.host.clone(),
            port: value.port,
            username: value.username.clone(),
            folder: value.folder.clone(),
            sync_limit: value.sync_limit,
            sync_interval_minutes: value.sync_interval_minutes,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupMailAccount {
    pub config: BackupMailConfig,
    pub created_at: i64,
    pub last_sync_at: Option<i64>,
    pub uid_validity: Option<i64>,
    pub last_uid: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupMailSyncState {
    pub account_id: String,
    pub history_before: Option<i64>,
    pub history_complete: bool,
    pub last_attempt_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupMailImport {
    pub account_id: String,
    pub folder: String,
    pub uid_validity: i64,
    pub uid: i64,
    pub message_id: String,
    pub material_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupMailRejected {
    pub account_id: String,
    pub folder: String,
    pub uid_validity: i64,
    pub uid: i64,
    pub reason: String,
    pub rejected_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MailMaterialBinding {
    pub state: String,
    pub fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MailSnapshot {
    pub version: u32,
    pub accounts: Vec<BackupMailAccount>,
    pub sync_states: Vec<BackupMailSyncState>,
    pub imports: Vec<BackupMailImport>,
    pub rejected: Vec<BackupMailRejected>,
    /// One entry for each material referenced by an imported message. Deleted
    /// and missing sources remain explicit so restoring a ledger cannot bind it
    /// to an unrelated item that happens to reuse the same ID.
    pub material_bindings: BTreeMap<String, MailMaterialBinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MailRestoreCounts {
    pub accounts: usize,
    pub sync_states: usize,
    pub imports: usize,
    pub rejected: usize,
}

impl MailSnapshot {
    fn empty() -> Self {
        Self { version: 1, accounts: Vec::new(), sync_states: Vec::new(), imports: Vec::new(), rejected: Vec::new(), material_bindings: BTreeMap::new() }
    }
}

fn sql_error(action: &str, error: rusqlite::Error) -> String {
    if matches!(error, rusqlite::Error::FromSqlConversionFailure(..)) {
        format!("{action}：邮箱记录字段损坏，无法安全处理")
    } else {
        format!("{action}：数据库读取或写入失败")
    }
}

fn has_table(conn: &Connection, name: &str) -> Result<bool, String> {
    conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)", [name], |row| row.get(0))
        .map_err(|e| sql_error("检查邮箱备份结构", e))
}

fn verify_schema(conn: &Connection, table: &str) -> Result<(), String> {
    let expected: &[(&str, &str, bool, i64)] = match table {
        "mail_accounts" => &[("id", "TEXT", false, 1), ("config_json", "TEXT", true, 0), ("created_at", "INTEGER", true, 0), ("last_sync_at", "INTEGER", false, 0), ("last_error", "TEXT", false, 0), ("uid_validity", "INTEGER", false, 0), ("last_uid", "INTEGER", true, 0)],
        "mail_imports" => &[("account_id", "TEXT", true, 1), ("folder", "TEXT", true, 2), ("uid_validity", "INTEGER", true, 3), ("uid", "INTEGER", true, 4), ("message_id", "TEXT", true, 0), ("material_id", "TEXT", true, 0)],
        "mail_rejected" => &[("account_id", "TEXT", true, 1), ("folder", "TEXT", true, 2), ("uid_validity", "INTEGER", true, 3), ("uid", "INTEGER", true, 4), ("reason", "TEXT", true, 0), ("rejected_at", "INTEGER", true, 0)],
        "mail_sync_state" => &[("account_id", "TEXT", false, 1), ("history_before", "INTEGER", false, 0), ("history_complete", "INTEGER", true, 0), ("last_attempt_at", "INTEGER", false, 0)],
        _ => return Err("邮箱备份包含未知表".into()),
    };
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})")).map_err(|e| sql_error("检查邮箱表结构", e))?;
    let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, i64>(3)? != 0, row.get::<_, i64>(5)?)))
        .map_err(|e| sql_error("检查邮箱表结构", e))?;
    let actual = rows.collect::<Result<Vec<_>, _>>().map_err(|e| sql_error("检查邮箱表结构", e))?;
    if actual.len() != expected.len() || actual.iter().zip(expected).any(|(a, e)| (a.0.as_str(), a.1.as_str(), a.2, a.3) != *e) {
        return Err(format!("邮箱表 {table} 的结构发生变化，需更新备份版本"));
    }
    Ok(())
}

fn config_from_json(json: &str) -> Result<BackupMailConfig, String> {
    let value: serde_json::Value = serde_json::from_str(json).map_err(|_| "邮箱账号配置损坏，未纳入备份".to_string())?;
    let object = value.as_object().ok_or("邮箱账号配置损坏，未纳入备份")?;
    let expected: BTreeSet<&str> = ["id", "name", "email", "host", "port", "username", "folder", "syncLimit", "syncIntervalMinutes"].into_iter().collect();
    if object.keys().any(|key| !expected.contains(key.as_str())) {
        return Err("邮箱账号含有未识别字段，无法确认不含凭据，未纳入备份".into());
    }
    let config: MailAccountConfig = serde_json::from_value(value).map_err(|_| "邮箱账号配置损坏，未纳入备份".to_string())?;
    let normalized = crate::mail::validate_backup_config(config.clone()).map_err(|_| "邮箱账号配置无效，未纳入备份".to_string())?;
    if normalized != config {
        return Err("邮箱账号配置未规范化，无法安全迁移".into());
    }
    Ok(config.into())
}

fn valid_id(id: &str) -> bool {
    uuid::Uuid::parse_str(id).is_ok_and(|parsed| parsed.to_string() == id)
}

fn valid_label(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}

fn valid_time(value: Option<i64>) -> bool {
    value.map_or(true, |n| n >= 0)
}

fn material_fingerprint(material: &crate::db::RawMaterialDto, deleted: i64) -> Result<String, String> {
    let bytes = serde_json::to_vec(&(
        &material.id,
        &material.source_type,
        &material.title,
        &material.source_url,
        &material.raw_text,
        &material.cleaned_markdown,
        &material.content_hash,
        &material.media_path,
        material.media_size_bytes,
        &material.metadata_json,
        &material.inbox_status,
        material.created_at,
        material.updated_at,
        deleted,
    )).map_err(|_| "邮件素材指纹计算失败".to_string())?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn material_record(conn: &Connection, id: &str) -> Result<Option<(crate::db::RawMaterialDto, i64)>, String> {
    conn.query_row(
        "SELECT id,source_type,title,source_url,raw_text,cleaned_markdown,content_hash,media_path,media_size_bytes,metadata_json,inbox_status,created_at,updated_at,is_deleted FROM materials WHERE id=?1", [id],
        |row| Ok((crate::db::RawMaterialDto {
            id: row.get(0)?, source_type: row.get(1)?, title: row.get(2)?, source_url: row.get(3)?, raw_text: row.get(4)?,
            cleaned_markdown: row.get(5)?, content_hash: row.get(6)?, media_path: row.get(7)?, media_size_bytes: row.get(8)?,
            metadata_json: row.get(9)?, inbox_status: row.get(10)?, created_at: row.get(11)?, updated_at: row.get(12)?,
        }, row.get(13)?)),
    ).optional().map_err(|e| sql_error("读取邮件来源素材", e))
}

fn material_binding(conn: &Connection, id: &str) -> Result<MailMaterialBinding, String> {
    let record = material_record(conn, id)?;
    match record {
        None => Ok(MailMaterialBinding { state: "missing".into(), fingerprint: None }),
        Some((material, deleted)) if matches!(deleted, 0 | 1) => Ok(MailMaterialBinding {
            state: if deleted == 0 { "active" } else { "deleted" }.into(),
            fingerprint: Some(material_fingerprint(&material, deleted)?),
        }),
        Some(_) => Err("邮件来源素材删除状态无效，无法安全备份".into()),
    }
}

/// Capture all mail-owned rows from the caller's read transaction. The caller
/// supplies the ordinary material export so live imports cannot point outside
/// the package unnoticed.
pub fn capture(conn: &Connection, materials: &[RawMaterialDto]) -> Result<MailSnapshot, String> {
    let tables = ["mail_accounts", "mail_imports", "mail_rejected", "mail_sync_state"];
    let present = tables.iter().map(|table| has_table(conn, table)).collect::<Result<Vec<_>, _>>()?;
    if present.iter().all(|value| !value) { return Ok(MailSnapshot::empty()); }
    if present.iter().any(|value| !value) { return Err("邮箱同步表结构不完整，未纳入备份".into()); }
    for table in tables { verify_schema(conn, table)?; }

    let mut snapshot = MailSnapshot::empty();
    {
        let mut stmt = conn.prepare("SELECT account_id,history_before,history_complete,last_attempt_at FROM mail_sync_state ORDER BY account_id")
            .map_err(|e| sql_error("读取邮箱同步状态", e))?;
        let rows = stmt.query_map([], |row| {
            let complete: i64 = row.get(2)?;
            if !matches!(complete, 0 | 1) { return Err(rusqlite::Error::IntegralValueOutOfRange(2, complete)); }
            Ok(BackupMailSyncState { account_id: row.get(0)?, history_before: row.get(1)?, history_complete: complete == 1, last_attempt_at: row.get(3)? })
        }).map_err(|e| sql_error("读取邮箱同步状态", e))?;
        snapshot.sync_states = rows.collect::<Result<Vec<_>, _>>().map_err(|e| sql_error("读取邮箱同步状态", e))?;
    }
    {
        let mut stmt = conn.prepare("SELECT a.id,a.config_json,a.created_at,a.last_sync_at,a.uid_validity,a.last_uid FROM mail_accounts a ORDER BY a.created_at,a.id")
            .map_err(|e| sql_error("读取邮箱账号", e))?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?, row.get::<_, Option<i64>>(3)?, row.get::<_, Option<i64>>(4)?, row.get::<_, i64>(5)?)))
            .map_err(|e| sql_error("读取邮箱账号", e))?;
        for row in rows {
            let (id, json, created_at, last_sync_at, uid_validity, last_uid) = row.map_err(|e| sql_error("读取邮箱账号", e))?;
            let config = config_from_json(&json)?;
            if id != config.id { return Err("邮箱账号标识不一致，未纳入备份".into()); }
            snapshot.accounts.push(BackupMailAccount { config, created_at, last_sync_at, uid_validity, last_uid });
        }
    }
    {
        let mut stmt = conn.prepare("SELECT account_id,folder,uid_validity,uid,message_id,material_id FROM mail_imports ORDER BY account_id,folder,uid_validity,uid")
            .map_err(|e| sql_error("读取邮件去重记录", e))?;
        let rows = stmt.query_map([], |row| Ok(BackupMailImport { account_id: row.get(0)?, folder: row.get(1)?, uid_validity: row.get(2)?, uid: row.get(3)?, message_id: row.get(4)?, material_id: row.get(5)? }))
            .map_err(|e| sql_error("读取邮件去重记录", e))?;
        snapshot.imports = rows.collect::<Result<Vec<_>, _>>().map_err(|e| sql_error("读取邮件去重记录", e))?;
    }
    {
        let mut stmt = conn.prepare("SELECT account_id,folder,uid_validity,uid,reason,rejected_at FROM mail_rejected ORDER BY account_id,folder,uid_validity,uid")
            .map_err(|e| sql_error("读取邮件隔离记录", e))?;
        let rows = stmt.query_map([], |row| Ok(BackupMailRejected { account_id: row.get(0)?, folder: row.get(1)?, uid_validity: row.get(2)?, uid: row.get(3)?, reason: row.get(4)?, rejected_at: row.get(5)? }))
            .map_err(|e| sql_error("读取邮件隔离记录", e))?;
        snapshot.rejected = rows.collect::<Result<Vec<_>, _>>().map_err(|e| sql_error("读取邮件隔离记录", e))?;
    }

    for row in &snapshot.imports {
        snapshot.material_bindings.entry(row.material_id.clone()).or_insert(material_binding(conn, &row.material_id)?);
    }
    validate(&snapshot)?;
    let materials_by_id: BTreeMap<_, _> = materials.iter().map(|item| (item.id.as_str(), item)).collect();
    for (id, binding) in &snapshot.material_bindings {
        match (binding.state.as_str(), materials_by_id.get(id.as_str())) {
            ("active", Some(material)) => {
                let actual = material_fingerprint(material, 0)?;
                if binding.fingerprint.as_deref() != Some(actual.as_str()) {
                    return Err("邮件去重记录引用的素材与备份正文不一致".into());
                }
            }
            ("deleted" | "missing", None) => {}
            ("active", None) => return Err("邮件去重记录引用的有效素材未纳入备份".into()),
            ("deleted" | "missing", Some(_)) => return Err("邮件去重记录的来源状态与素材备份不一致".into()),
            _ => return Err("邮件素材绑定无效".into()),
        }
    }
    Ok(snapshot)
}

pub fn validate(snapshot: &MailSnapshot) -> Result<(), String> {
    if snapshot.version != 1 { return Err("不支持的邮箱备份版本".into()); }
    let mut account_ids = BTreeSet::new();
    for account in &snapshot.accounts {
        let config = MailAccountConfig::from(&account.config);
        let normalized = crate::mail::validate_backup_config(config.clone()).map_err(|_| "邮箱账号配置无效".to_string())?;
        if normalized != config || account.config.id != config.id || !account_ids.insert(config.id.clone()) || account.created_at < 0 || !valid_time(account.last_sync_at) || account.last_uid < 0 || account.last_uid > MAX_UID || account.uid_validity.is_some_and(|n| !(1..=MAX_UID).contains(&n)) {
            return Err("邮箱账号或同步游标无效".into());
        }
    }
    let mut sync_ids = BTreeSet::new();
    for state in &snapshot.sync_states {
        if !valid_id(&state.account_id) || !sync_ids.insert(&state.account_id) || state.history_before.is_some_and(|n| !(1..=MAX_UID).contains(&n)) || !valid_time(state.last_attempt_at) {
            return Err("邮箱同步状态无效".into());
        }
    }
    for id in &account_ids {
        if !sync_ids.contains(id) { return Err("邮箱账号缺少同步状态".into()); }
    }
    let mut keys = BTreeSet::new();
    let mut material_ids = BTreeSet::new();
    for row in &snapshot.imports {
        if !valid_id(&row.account_id) || !valid_label(&row.folder, 512) || !(1..=MAX_UID).contains(&row.uid_validity) || !(1..=MAX_UID).contains(&row.uid) || row.message_id.len() > 4096 || row.message_id.chars().any(char::is_control) || !valid_label(&row.material_id, 512) {
            return Err("邮件去重记录字段无效".into());
        }
        let key = (row.account_id.as_str(), row.folder.as_str(), row.uid_validity, row.uid);
        if !keys.insert(key) { return Err("邮箱备份包含重复邮件标识".into()); }
        material_ids.insert(row.material_id.as_str());
    }
    for row in &snapshot.rejected {
        if !valid_id(&row.account_id) || !valid_label(&row.folder, 512) || !(1..=MAX_UID).contains(&row.uid_validity) || !(1..=MAX_UID).contains(&row.uid) || !REJECTION_REASONS.contains(&row.reason.as_str()) || row.rejected_at < 0 {
            return Err("邮件隔离记录字段无效".into());
        }
        let key = (row.account_id.as_str(), row.folder.as_str(), row.uid_validity, row.uid);
        if !keys.insert(key) { return Err("邮箱备份包含重复或冲突的邮件标识".into()); }
    }
    let binding_ids: BTreeSet<_> = snapshot.material_bindings.keys().map(String::as_str).collect();
    if binding_ids != material_ids { return Err("邮件素材绑定清单与去重记录不一致".into()); }
    for binding in snapshot.material_bindings.values() {
        match (binding.state.as_str(), binding.fingerprint.as_deref()) {
            ("active" | "deleted", Some(value)) if value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) => {}
            ("missing", None) => {}
            _ => return Err("邮件素材绑定字段无效".into()),
        }
    }
    Ok(())
}

fn current_material_binding(conn: &Connection, id: &str) -> Result<Option<MailMaterialBinding>, String> {
    let record = material_record(conn, id)?;
    record.map(|(material, deleted)| {
        if !matches!(deleted, 0 | 1) { return Err("本地邮件素材删除状态无效".into()); }
        Ok(MailMaterialBinding { state: if deleted == 0 { "active".into() } else { "deleted".into() }, fingerprint: Some(material_fingerprint(&material, deleted)?) })
    }).transpose()
}

fn validate_material_destination(conn: &Connection, snapshot: &MailSnapshot, require_ready: bool) -> Result<(), String> {
    for (id, archived) in &snapshot.material_bindings {
        let local = current_material_binding(conn, id)?;
        match (archived.state.as_str(), local.as_ref()) {
            ("active", None) if !require_ready => {}
            ("active", Some(found)) if found == archived => {}
            ("active", _) => return Err("邮件去重记录所指素材缺失或内容冲突，未恢复邮箱数据".into()),
            ("deleted", None) if !require_ready => {}
            ("deleted", None) if require_ready => {}
            ("deleted", Some(found)) if found == archived => {}
            ("deleted", _) => return Err("邮件去重记录所指删除素材状态冲突，未恢复邮箱数据".into()),
            ("missing", None) => {}
            ("missing", Some(_)) => return Err("邮件去重记录原本没有来源素材，但本地出现了同标识素材，未恢复邮箱数据".into()),
            _ => return Err("邮件素材绑定无效".into()),
        }
    }
    Ok(())
}

fn existing_account(conn: &Connection, id: &str) -> Result<Option<BackupMailAccount>, String> {
    let raw: Option<(String, String, i64, Option<i64>, Option<i64>, i64)> = conn.query_row(
        "SELECT id,config_json,created_at,last_sync_at,uid_validity,last_uid FROM mail_accounts WHERE id=?1", [id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
    ).optional().map_err(|e| sql_error("读取本地邮箱账号", e))?;
    raw.map(|(id, json, created_at, last_sync_at, uid_validity, last_uid)| {
        let config = config_from_json(&json)?;
        if id != config.id { return Err("本地邮箱账号标识不一致".into()); }
        Ok(BackupMailAccount { config, created_at, last_sync_at, uid_validity, last_uid })
    }).transpose()
}

fn existing_sync_state(conn: &Connection, id: &str) -> Result<Option<BackupMailSyncState>, String> {
    conn.query_row("SELECT account_id,history_before,history_complete,last_attempt_at FROM mail_sync_state WHERE account_id=?1", [id], |row| {
        let complete: i64 = row.get(2)?;
        if !matches!(complete, 0 | 1) { return Err(rusqlite::Error::IntegralValueOutOfRange(2, complete)); }
        Ok(BackupMailSyncState { account_id: row.get(0)?, history_before: row.get(1)?, history_complete: complete == 1, last_attempt_at: row.get(3)? })
    }).optional().map_err(|e| sql_error("读取本地邮箱同步状态", e))
}

fn existing_import(conn: &Connection, row: &BackupMailImport) -> Result<Option<BackupMailImport>, String> {
    conn.query_row("SELECT account_id,folder,uid_validity,uid,message_id,material_id FROM mail_imports WHERE account_id=?1 AND folder=?2 AND uid_validity=?3 AND uid=?4", params![row.account_id,row.folder,row.uid_validity,row.uid], |r| {
        Ok(BackupMailImport { account_id: r.get(0)?, folder: r.get(1)?, uid_validity: r.get(2)?, uid: r.get(3)?, message_id: r.get(4)?, material_id: r.get(5)? })
    }).optional().map_err(|e| sql_error("读取本地邮件去重记录", e))
}

fn existing_rejected(conn: &Connection, row: &BackupMailRejected) -> Result<Option<BackupMailRejected>, String> {
    conn.query_row("SELECT account_id,folder,uid_validity,uid,reason,rejected_at FROM mail_rejected WHERE account_id=?1 AND folder=?2 AND uid_validity=?3 AND uid=?4", params![row.account_id,row.folder,row.uid_validity,row.uid], |r| {
        Ok(BackupMailRejected { account_id: r.get(0)?, folder: r.get(1)?, uid_validity: r.get(2)?, uid: r.get(3)?, reason: r.get(4)?, rejected_at: r.get(5)? })
    }).optional().map_err(|e| sql_error("读取本地邮件隔离记录", e))
}

pub fn validate_destination(conn: &Connection, snapshot: &MailSnapshot) -> Result<(), String> {
    crate::mail::ensure_backup_schema(conn)?;
    validate(snapshot)?;
    validate_material_destination(conn, snapshot, false)?;
    for account in &snapshot.accounts {
        if existing_account(conn, &account.config.id)?.is_some_and(|local| local != *account) {
            return Err("本地存在同标识但配置或游标不同的邮箱账号，未恢复邮箱数据".into());
        }
    }
    for state in &snapshot.sync_states {
        if existing_sync_state(conn, &state.account_id)?.is_some_and(|local| local != *state) {
            return Err("本地存在冲突的邮箱同步状态，未恢复邮箱数据".into());
        }
    }
    for row in &snapshot.imports {
        if existing_import(conn, row)?.is_some_and(|local| local != *row) {
            return Err("本地存在冲突的邮件去重记录，未恢复邮箱数据".into());
        }
        if existing_rejected(conn, &BackupMailRejected { account_id: row.account_id.clone(), folder: row.folder.clone(), uid_validity: row.uid_validity, uid: row.uid, reason: String::new(), rejected_at: 0 })?.is_some() {
            return Err("本地邮件标识已被隔离记录占用，未恢复邮箱数据".into());
        }
    }
    for row in &snapshot.rejected {
        if existing_rejected(conn, row)?.is_some_and(|local| local != *row) {
            return Err("本地存在冲突的邮件隔离记录，未恢复邮箱数据".into());
        }
        if existing_import(conn, &BackupMailImport { account_id: row.account_id.clone(), folder: row.folder.clone(), uid_validity: row.uid_validity, uid: row.uid, message_id: String::new(), material_id: String::new() })?.is_some() {
            return Err("本地邮件标识已被导入记录占用，未恢复邮箱数据".into());
        }
    }
    Ok(())
}

pub fn restore(conn: &mut Connection, snapshot: &MailSnapshot) -> Result<MailRestoreCounts, String> {
    let _guard = crate::mail::backup_guard()?;
    crate::mail::ensure_backup_schema(conn)?;
    validate(snapshot)?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| sql_error("恢复邮箱数据", e))?;
    validate_destination(&tx, snapshot)?;
    validate_material_destination(&tx, snapshot, true)?;
    let mut counts = MailRestoreCounts { accounts: 0, sync_states: 0, imports: 0, rejected: 0 };
    for account in &snapshot.accounts {
        if existing_account(&tx, &account.config.id)?.is_some() { continue; }
        let config_json = serde_json::to_string(&MailAccountConfig::from(&account.config)).map_err(|_| "邮箱账号序列化失败".to_string())?;
        tx.execute("INSERT INTO mail_accounts(id,config_json,created_at,last_sync_at,last_error,uid_validity,last_uid) VALUES(?1,?2,?3,?4,NULL,?5,?6)",
            params![account.config.id,config_json,account.created_at,account.last_sync_at,account.uid_validity,account.last_uid])
            .map_err(|e| sql_error("恢复邮箱账号", e))?;
        counts.accounts += 1;
    }
    for state in &snapshot.sync_states {
        if existing_sync_state(&tx, &state.account_id)?.is_some() { continue; }
        tx.execute("INSERT INTO mail_sync_state(account_id,history_before,history_complete,last_attempt_at) VALUES(?1,?2,?3,?4)",
            params![state.account_id,state.history_before,state.history_complete as i64,state.last_attempt_at])
            .map_err(|e| sql_error("恢复邮箱同步状态", e))?;
        counts.sync_states += 1;
    }
    for row in &snapshot.imports {
        if existing_import(&tx, row)?.is_some() { continue; }
        tx.execute("INSERT INTO mail_imports(account_id,folder,uid_validity,uid,message_id,material_id) VALUES(?1,?2,?3,?4,?5,?6)",
            params![row.account_id,row.folder,row.uid_validity,row.uid,row.message_id,row.material_id])
            .map_err(|e| sql_error("恢复邮件去重记录", e))?;
        counts.imports += 1;
    }
    for row in &snapshot.rejected {
        if existing_rejected(&tx, row)?.is_some() { continue; }
        tx.execute("INSERT INTO mail_rejected(account_id,folder,uid_validity,uid,reason,rejected_at) VALUES(?1,?2,?3,?4,?5,?6)",
            params![row.account_id,row.folder,row.uid_validity,row.uid,row.reason,row.rejected_at])
            .map_err(|e| sql_error("恢复邮件隔离记录", e))?;
        counts.rejected += 1;
    }
    tx.commit().map_err(|e| sql_error("恢复邮箱数据", e))?;
    Ok(counts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    fn database() -> Connection {
        let dir = std::env::temp_dir().join(format!("kf-mail-backup-{}", uuid::Uuid::new_v4()));
        let conn = crate::db::open_db(&dir.join("knowflick.db")).unwrap();
        crate::mail::ensure_backup_schema(&conn).unwrap();
        conn
    }

    fn config(id: &str) -> BackupMailConfig {
        BackupMailConfig { id: id.into(), name: "工作邮箱".into(), email: "reader@example.org".into(), host: "imap.example.org".into(), port: 993, username: "reader".into(), folder: "INBOX".into(), sync_limit: 50, sync_interval_minutes: 0 }
    }

    #[test]
    fn material_fingerprint_covers_all_exported_fields() {
        let material = crate::db::RawMaterialDto {
            id: "mail-material".into(), source_type: "email".into(), title: "标题".into(), source_url: None,
            raw_text: "正文".into(), cleaned_markdown: Some("整理正文".into()), content_hash: "hash".into(),
            media_path: None, media_size_bytes: 0, metadata_json: "{}".into(), inbox_status: "inbox".into(),
            created_at: 10, updated_at: 11,
        };
        let fingerprint = material_fingerprint(&material, 0).unwrap();
        let mut changed = material.clone();
        changed.metadata_json = r#"{"messageId":"different"}"#.into();
        assert_ne!(fingerprint, material_fingerprint(&changed, 0).unwrap());
        changed = material.clone();
        changed.source_type = "manual".into();
        assert_ne!(fingerprint, material_fingerprint(&changed, 0).unwrap());
    }

    fn snapshot() -> MailSnapshot {
        let id = "00000000-0000-4000-8000-000000000001";
        MailSnapshot {
            version: 1,
            accounts: vec![BackupMailAccount { config: config(id), created_at: 10, last_sync_at: Some(20), uid_validity: Some(7), last_uid: 9 }],
            sync_states: vec![BackupMailSyncState { account_id: id.into(), history_before: Some(1), history_complete: false, last_attempt_at: Some(19) }, BackupMailSyncState { account_id: "00000000-0000-4000-8000-000000000002".into(), history_before: None, history_complete: true, last_attempt_at: None }],
            imports: vec![BackupMailImport { account_id: id.into(), folder: "INBOX".into(), uid_validity: 7, uid: 9, message_id: "<mail@example.org>".into(), material_id: "mat-1".into() }],
            rejected: vec![BackupMailRejected { account_id: id.into(), folder: "INBOX".into(), uid_validity: 7, uid: 8, reason: REJECTION_REASONS[0].into(), rejected_at: 18 }],
            material_bindings: BTreeMap::from([("mat-1".into(), MailMaterialBinding { state: "active".into(), fingerprint: Some("a".repeat(64)) })]),
        }
    }

    #[test]
    fn roundtrip_preserves_ledgers_orphans_and_cursor_without_credentials() {
        let source = database();
        let mut source_snapshot = snapshot();
        source_snapshot.material_bindings.clear();
        source.execute("INSERT INTO materials(id,source_type,title,raw_text,content_hash,created_at,updated_at) VALUES('mat-1','email','M','Body','hash',1,2)", []).unwrap();
        source.execute("INSERT INTO mail_accounts(id,config_json,created_at,last_sync_at,uid_validity,last_uid) VALUES(?1,?2,10,20,7,9)", params![source_snapshot.accounts[0].config.id, serde_json::to_string(&MailAccountConfig::from(&source_snapshot.accounts[0].config)).unwrap()]).unwrap();
        source.execute("INSERT INTO mail_sync_state(account_id,history_before,history_complete,last_attempt_at) VALUES(?1,1,0,19)", params![source_snapshot.accounts[0].config.id]).unwrap();
        source.execute("INSERT INTO mail_imports(account_id,folder,uid_validity,uid,message_id,material_id) VALUES(?1,'INBOX',7,9,'<mail@example.org>','mat-1')", params![source_snapshot.accounts[0].config.id]).unwrap();
        source.execute("INSERT INTO mail_rejected(account_id,folder,uid_validity,uid,reason,rejected_at) VALUES(?1,'INBOX',7,8,?2,18)", params![source_snapshot.accounts[0].config.id,REJECTION_REASONS[0]]).unwrap();
        source.execute("INSERT INTO mail_sync_state(account_id,history_complete) VALUES('00000000-0000-4000-8000-000000000002',1)", []).unwrap();
        let source_snapshot = capture(&source, &[RawMaterialDto { id: "mat-1".into(), source_type: "email".into(), title: "M".into(), source_url: None, raw_text: "Body".into(), cleaned_markdown: None, content_hash: "hash".into(), media_path: None, media_size_bytes: 0, metadata_json: "{}".into(), inbox_status: "inbox".into(), created_at: 1, updated_at: 2 }]).unwrap();
        assert_eq!(source_snapshot.accounts.len(), 1);
        assert_eq!(source_snapshot.imports.len(), 1);
        let json = serde_json::to_string(&source_snapshot).unwrap();
        assert!(!json.contains("password"));
        assert!(!json.contains("last_error"));
        assert!(json.contains("<mail@example.org>"));
        let target = database();
        target.execute("INSERT INTO materials(id,source_type,title,raw_text,content_hash,created_at,updated_at) VALUES('mat-1','email','M','Body','hash',1,2)", []).unwrap();
        let mut target = target;
        let counts = restore(&mut target, &source_snapshot).unwrap();
        assert_eq!(counts, MailRestoreCounts { accounts: 1, sync_states: 2, imports: 1, rejected: 1 });
        assert_eq!(restore(&mut target, &source_snapshot).unwrap(), MailRestoreCounts { accounts: 0, sync_states: 0, imports: 0, rejected: 0 });
        assert_eq!(target.query_row("SELECT last_uid FROM mail_accounts WHERE id=?1", [&source_snapshot.accounts[0].config.id], |r| r.get::<_, i64>(0)).unwrap(), 9);
        assert_eq!(target.query_row("SELECT COUNT(*) FROM mail_imports", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        assert_eq!(target.query_row("SELECT COUNT(*) FROM mail_rejected", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    }

    #[test]
    fn preflight_rejects_material_conflicts_and_row_conflicts_before_any_write() {
        let _source = database();
        let mut s = snapshot();
        s.material_bindings.get_mut("mat-1").unwrap().state = "missing".into();
        s.material_bindings.get_mut("mat-1").unwrap().fingerprint = None;
        let mut target = database();
        target.execute("INSERT INTO materials(id,source_type,title,raw_text,content_hash,created_at,updated_at) VALUES('mat-1','email','Other','Other','hash',1,2)", []).unwrap();
        assert!(validate_destination(&target, &s).is_err());
        assert!(restore(&mut target, &s).is_err());
        assert_eq!(target.query_row("SELECT COUNT(*) FROM mail_accounts", [], |r| r.get::<_, i64>(0)).unwrap(), 0);

        let s = snapshot();
        let mut s = s;
        s.material_bindings.get_mut("mat-1").unwrap().state = "missing".into();
        s.material_bindings.get_mut("mat-1").unwrap().fingerprint = None;
        target.execute("DELETE FROM materials WHERE id='mat-1'", []).unwrap();
        target.execute("INSERT INTO mail_imports(account_id,folder,uid_validity,uid,message_id,material_id) VALUES(?1,'INBOX',7,9,'different','mat-1')", params![s.accounts[0].config.id]).unwrap();
        assert!(restore(&mut target, &s).is_err());
        assert_eq!(target.query_row("SELECT COUNT(*) FROM mail_accounts", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    }

    #[test]
    fn capture_marks_deleted_and_missing_sources_and_fails_closed_on_unknown_config_fields() {
        let conn = database();
        let mut s = snapshot();
        s.material_bindings.clear();
        conn.execute("INSERT INTO mail_imports(account_id,folder,uid_validity,uid,message_id,material_id) VALUES(?1,'INBOX',7,9,'m','gone')", params![s.accounts[0].config.id]).unwrap();
        let captured = capture(&conn, &[]).unwrap();
        assert_eq!(captured.material_bindings["gone"].state, "missing");
        conn.execute("INSERT INTO materials(id,source_type,title,raw_text,content_hash,created_at,updated_at,is_deleted) VALUES('gone','email','T','B','h',1,2,1)", []).unwrap();
        let captured = capture(&conn, &[]).unwrap();
        assert_eq!(captured.material_bindings["gone"].state, "deleted");
        let bad = serde_json::json!({"id":s.accounts[0].config.id,"name":"x","email":"x@example.org","host":"imap.example.org","port":993,"username":"x","folder":"INBOX","syncLimit":50,"syncIntervalMinutes":0,"password":"never-export"}).to_string();
        conn.execute("INSERT INTO mail_accounts(id,config_json) VALUES(?1,?2)", params![s.accounts[0].config.id,bad]).unwrap();
        assert!(capture(&conn, &[]).unwrap_err().contains("未识别字段"));
        s.accounts.clear();
    }

    #[test]
    fn schema_drift_fails_closed_instead_of_omitting_new_mail_fields() {
        let conn = database();
        conn.execute("ALTER TABLE mail_accounts ADD COLUMN access_token TEXT", []).unwrap();
        assert!(capture(&conn, &[]).unwrap_err().contains("结构发生变化"));
    }
}
