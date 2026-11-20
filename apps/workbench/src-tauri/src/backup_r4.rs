//! Versioned, transactional snapshot for R4 authority tables.
//! R4 snapshots are included in v5 archives when their source records are available.
use std::collections::{BTreeMap, BTreeSet};
use rusqlite::{params_from_iter, types::{Value as SqlValue, ValueRef}, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

// In dependency order. Never include MCP tokens, credentials, or derived indexes.
const TABLES: &[&str] = &["projects", "goals", "profile_claims", "profile_denials", "project_members", "goal_evidence"];
type Row = BTreeMap<String, Value>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct R4Snapshot {
    pub version: u32,
    pub tables: BTreeMap<String, Vec<Row>>,
    /// Content fingerprints bind project memberships to the correct note version.
    pub note_bindings: BTreeMap<String, String>,
    /// Preserve both source identity and missing/deleted state for goal evidence.
    pub evidence_bindings: BTreeMap<String, Option<String>>,
    /// Legacy profile evidence is untyped. Preserve the state of every supported
    /// source namespace instead of guessing a type from the ID.
    pub profile_bindings: BTreeMap<String, ProfileSourceBinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ProfileSourceBinding {
    #[serde(deserialize_with = "Option::deserialize")]
    pub note: Option<String>,
    #[serde(deserialize_with = "Option::deserialize")]
    pub material: Option<String>,
    #[serde(deserialize_with = "Option::deserialize")]
    pub card: Option<String>,
}

#[derive(Debug)]
struct Column { name: String, kind: String, not_null: bool, pk: i64 }

fn columns(conn: &Connection, table: &str) -> Result<Vec<Column>, String> {
    // Version 1 is an explicit wire contract. Schema drift must fail closed,
    // especially if a future column contains credentials or other private data.
    let expected: &[(&str, &str, bool, i64)] = match table {
        "projects" => &[("id","TEXT",false,1),("name","TEXT",true,0),("description","TEXT",true,0),("created_at","INTEGER",true,0),("updated_at","INTEGER",true,0),("archived_at","INTEGER",false,0)],
        "goals" => &[("id","TEXT",false,1),("title","TEXT",true,0),("done_criteria","TEXT",true,0),("scope","TEXT",false,0),("created_at","INTEGER",true,0),("achieved_at","INTEGER",false,0),("abandoned_at","INTEGER",false,0),("review_note","TEXT",true,0)],
        "profile_claims" => &[("id","TEXT",false,1),("kind","TEXT",true,0),("content","TEXT",true,0),("evidence_json","TEXT",true,0),("scope","TEXT",true,0),("created_at","INTEGER",true,0),("confirmed_at","INTEGER",false,0),("expires_at","INTEGER",false,0),("denied_at","INTEGER",false,0),("superseded_by","TEXT",false,0),("status","TEXT",true,0)],
        "profile_denials" => &[("evidence_fingerprint","TEXT",false,1),("denied_at","INTEGER",true,0)],
        "project_members" => &[("project_id","TEXT",true,1),("note_id","TEXT",true,2),("added_at","INTEGER",true,0)],
        "goal_evidence" => &[("goal_id","TEXT",true,1),("evidence_id","TEXT",true,2),("kind","TEXT",true,0),("linked_at","INTEGER",true,0)],
        _ => return Err("备份包含未知表".into()),
    };
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})")).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok(Column { name: r.get(1)?, kind: r.get(2)?, not_null: r.get::<_, i64>(3)? != 0, pk: r.get(5)? })).map_err(|e| e.to_string())?;
    let columns = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    let matches = columns.len() == expected.len() && columns.iter().zip(expected).all(|(col, spec)|
        (col.name.as_str(), col.kind.as_str(), col.not_null, col.pk) == *spec);
    if !matches { return Err(format!("备份表 {table} 的结构不匹配，需更新备份版本")); }
    Ok(columns)
}

fn row_value(row: &rusqlite::Row<'_>, cols: &[Column]) -> rusqlite::Result<Row> {
    let mut out = Row::new();
    for (i, col) in cols.iter().enumerate() {
        let value = match row.get_ref(i)? {
            ValueRef::Null => Value::Null,
            ValueRef::Integer(n) => Value::from(n),
            ValueRef::Text(text) => Value::String(std::str::from_utf8(text).map_err(|e| rusqlite::Error::FromSqlConversionFailure(i, rusqlite::types::Type::Text, Box::new(e)))?.to_owned()),
            other => return Err(rusqlite::Error::InvalidColumnType(i, col.name.clone(), other.data_type())),
        };
        out.insert(col.name.clone(), value);
    }
    Ok(out)
}

pub(crate) fn note_fingerprint(conn: &Connection, id: &str) -> Result<Option<String>, String> {
    let note: Option<(String, String, i64, i64)> = conn.query_row(
        "SELECT title, body_md, current_revision, is_deleted FROM notes WHERE id=?1", [id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    ).optional().map_err(|e| e.to_string())?;
    note.map(|record| serde_json::to_vec(&record).map(|bytes| format!("{:x}", Sha256::digest(bytes))).map_err(|e| e.to_string())).transpose()
}

fn evidence_fingerprint(conn: &Connection, kind: &str, id: &str) -> Result<Option<String>, String> {
    match kind {
        "note" => note_fingerprint(conn, id),
        "material" => {
            let item: Option<(String, String, Option<String>, i64, i64)> = conn.query_row(
                "SELECT title, raw_text, source_url, is_deleted, updated_at FROM materials WHERE id=?1", [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            ).optional().map_err(|e| e.to_string())?;
            item.map(|record| serde_json::to_vec(&record).map(|bytes| format!("{:x}", Sha256::digest(bytes))).map_err(|e| e.to_string())).transpose()
        }
        _ => Err("目标证据类型无效，无法安全备份".into()),
    }
}

fn profile_source_binding(conn: &Connection, id: &str) -> Result<ProfileSourceBinding, String> {
    // Review counters are deliberately excluded: scoring does not change a card's source text.
    let card: Option<(String, String, String, String, String, String, i64, Option<i64>)> = conn.query_row(
        "SELECT headline, summary, details, category, links_json, tags_json, is_deleted, edited_at FROM cards WHERE id=?1", [id],
        |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?)),
    ).optional().map_err(|e| e.to_string())?;
    let card = card.map(|record| serde_json::to_vec(&record).map(|bytes| format!("{:x}", Sha256::digest(bytes))).map_err(|e| e.to_string())).transpose()?;
    Ok(ProfileSourceBinding { note: note_fingerprint(conn, id)?, material: evidence_fingerprint(conn, "material", id)?, card })
}

fn profile_references(tables: &BTreeMap<String, Vec<Row>>) -> Result<BTreeSet<String>, String> {
    let mut references = BTreeSet::new();
    for row in &tables["profile_claims"] {
        let json = row.get("evidence_json").and_then(Value::as_str).ok_or("画像证据格式无效")?;
        let ids: Vec<String> = serde_json::from_str(json).map_err(|_| "画像证据格式无效，无法安全备份".to_string())?;
        references.extend(ids);
    }
    Ok(references)
}

fn evidence_references(tables: &BTreeMap<String, Vec<Row>>) -> Result<BTreeMap<String, (String, String)>, String> {
    let mut references = BTreeMap::new();
    for row in &tables["goal_evidence"] {
        let kind = row.get("kind").and_then(Value::as_str).ok_or("目标证据类型无效")?;
        let id = row.get("evidence_id").and_then(Value::as_str).ok_or("目标证据标识无效")?;
        if !matches!(kind, "note" | "material") { return Err("目标证据类型无效，无法安全备份".into()); }
        references.insert(format!("{kind}\n{id}"), (kind.to_owned(), id.to_owned()));
    }
    Ok(references)
}

/// Read all six tables from one SQLite read transaction; no unbounded UI pagination.
pub fn export_snapshot(conn: &mut Connection) -> Result<R4Snapshot, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let snapshot = export_from_connection(&tx)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(snapshot)
}

fn export_from_connection(tx: &Connection) -> Result<R4Snapshot, String> {
    let mut tables = BTreeMap::new();
    for &table in TABLES {
        let cols = columns(tx, table)?;
        let mut stmt = tx.prepare(&format!("SELECT * FROM {table}")).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| row_value(r, &cols)).map_err(|e| e.to_string())?;
        tables.insert(table.to_owned(), rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?);
    }
    let mut note_bindings = BTreeMap::new();
    for row in &tables["project_members"] {
        let id = row.get("note_id").and_then(Value::as_str).ok_or("项目成员笔记标识无效")?;
        let fingerprint = note_fingerprint(tx, id)?.ok_or("项目成员笔记不存在")?;
        note_bindings.insert(id.to_owned(), fingerprint);
    }
    let mut evidence_bindings = BTreeMap::new();
    for (key, (kind, id)) in evidence_references(&tables)? {
        evidence_bindings.insert(key, evidence_fingerprint(tx, &kind, &id)?);
    }
    let mut profile_bindings = BTreeMap::new();
    for id in profile_references(&tables)? {
        profile_bindings.insert(id.clone(), profile_source_binding(tx, &id)?);
    }
    Ok(R4Snapshot { version: 1, tables, note_bindings, evidence_bindings, profile_bindings })
}

/// Archive database records and optional R4 data, all read from the same
/// SQLite snapshot. Files and settings remain separate.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseBackupSnapshot {
    pub materials: Vec<crate::db::RawMaterialDto>,
    pub cards: Vec<crate::db::KnowledgeCardDto>,
    pub notes: Vec<crate::notes::NoteDto>,
    pub note_revisions: Vec<crate::notes::NoteRevision>,
    pub subscriptions: Option<crate::backup_subscriptions::SubscriptionSnapshot>,
    pub subscriptions_error: Option<String>,
    pub mail: Option<crate::backup_mail::MailSnapshot>,
    pub mail_error: Option<String>,
    pub review_history: Option<crate::review_history::ReviewHistorySnapshot>,
    pub review_history_error: Option<String>,
    pub knowledge_bases: Vec<crate::notes::KnowledgeBaseDto>,
    pub membership: std::collections::HashMap<String, i64>,
    pub artifacts: Vec<crate::db::ArtifactDto>,
    pub artifacts_error: Option<String>,
    pub deleted_records: Option<crate::backup_deleted::DeletedRecordsSnapshot>,
    pub deleted_records_error: Option<String>,
    pub r4: Option<R4Snapshot>,
    pub r4_error: Option<String>,
}

pub fn capture_database(conn: &mut Connection) -> Result<DatabaseBackupSnapshot, String> {
    let mail_schema_error = crate::mail::ensure_backup_schema(conn).err();
    let tx = conn.transaction().map_err(|e| crate::error_text::explain("读取备份快照失败", &e))?;
    let snapshot = capture_database_from_connection(&tx, || {}, mail_schema_error)?;
    tx.commit().map_err(|e| crate::error_text::explain("读取备份快照失败", &e))?;
    Ok(snapshot)
}

fn backup_data_error(action: &str, error: &rusqlite::Error) -> String {
    if matches!(error, rusqlite::Error::FromSqlConversionFailure(..)) {
        return format!("{action}：记录字段格式损坏，无法安全处理");
    }
    crate::error_text::explain(action, error)
}

fn capture_database_from_connection(conn: &Connection, after_first_read: impl FnOnce(), mail_schema_error: Option<String>) -> Result<DatabaseBackupSnapshot, String> {
    let materials = crate::db::list_materials(conn, false, -1, 0).map_err(|e| crate::error_text::explain("读取备份素材失败", &e))?;
    after_first_read();
    let cards = crate::db::cards_for_backup(conn).map_err(|e| backup_data_error("读取备份卡片失败", &e))?;
    let notes = crate::notes::note_list_scoped(conn, "all", -1, 0).map_err(|e| crate::error_text::explain("读取备份笔记失败", &e))?;
    if notes.iter().any(|note| serde_json::from_str::<Vec<String>>(&note.tags_json).is_err()) {
        return Err("笔记标签数据损坏，无法安全生成备份".into());
    }
    let note_revisions = crate::notes::revisions_for_backup(conn).map_err(|e| backup_data_error("读取笔记历史失败", &e))?;
    let notes_by_id: BTreeMap<_, _> = notes.iter().map(|note| (note.id.as_str(), note)).collect();
    for item in &note_revisions {
        let note = notes_by_id.get(item.note_id.as_str()).ok_or("笔记历史缺少原笔记，无法安全备份")?;
        if item.revision < 1 || item.revision > note.current_revision ||
            (item.revision == note.current_revision && (item.title != note.title || item.body_md != note.body_md)) {
            return Err("笔记历史修订与当前笔记不一致，无法安全备份".into());
        }
    }
    let knowledge_bases = crate::notes::kb_list(conn).map_err(|e| crate::error_text::explain("读取备份知识库失败", &e))?;
    let membership = crate::notes::kb_membership_map(conn).map_err(|e| crate::error_text::explain("读取备份成员关系失败", &e))?;
    let (artifacts, artifacts_error) = match crate::db::artifacts_for_backup(conn) {
        Ok(items) => (items, None),
        Err(error) => (Vec::new(), Some(backup_data_error("读取备份产物失败", &error))),
    };
    let (deleted_records, deleted_records_error) = match crate::backup_deleted::capture(conn) {
        Ok(snapshot) => (Some(snapshot), None),
        Err(error) => (None, Some(error)),
    };
    let (subscriptions, subscriptions_error) = match crate::backup_subscriptions::capture(conn) {
        Ok(snapshot) => (Some(snapshot), None),
        Err(error) => (None, Some(error)),
    };
    let (mail, mail_error) = if let Some(error) = mail_schema_error {
        (None, Some(error))
    } else {
        match crate::backup_mail::capture(conn, &materials) {
            Ok(snapshot) => (Some(snapshot), None),
            Err(error) => (None, Some(error)),
        }
    };
    let (review_history, review_history_error) = match crate::review_history::capture(conn) {
        Ok(snapshot) => (Some(snapshot), None),
        Err(error) => (None, Some(error)),
    };
    let (r4, r4_error) = match export_from_connection(conn).and_then(|snapshot| {
        let mut material_ids: BTreeSet<String> = materials.iter().map(|m| m.id.clone()).collect();
        let mut card_ids: BTreeSet<String> = cards.iter().map(|c| c.id.clone()).collect();
        if let Some(deleted) = &deleted_records {
            material_ids.extend(deleted.materials.iter().map(|record| record.material.id.clone()));
            card_ids.extend(deleted.cards.iter().map(|record| record.card.id.clone()));
        }
        for (key, fingerprint) in &snapshot.evidence_bindings {
            if let Some(id) = key.strip_prefix("material\n") {
                if fingerprint.is_some() && !material_ids.contains(id) {
                    return Err("目标证据引用了未纳入备份的已删除素材".into());
                }
            }
        }
        for (id, binding) in &snapshot.profile_bindings {
            if (binding.material.is_some() && !material_ids.contains(id)) ||
                (binding.card.is_some() && !card_ids.contains(id)) {
                return Err("画像证据引用了未纳入备份的已删除素材或卡片".into());
            }
        }
        let referenced_notes: BTreeSet<_> = snapshot.note_bindings.keys().map(String::as_str)
            .chain(snapshot.evidence_bindings.keys().filter_map(|key| key.strip_prefix("note\n")))
            .chain(snapshot.profile_bindings.keys().map(String::as_str)).collect();
        if notes.iter().any(|note| referenced_notes.contains(note.id.as_str()) &&
            note.source_material_id.as_ref().is_some_and(|id| !material_ids.contains(id))) {
            return Err("项目、目标或画像引用的笔记依赖未纳入备份的素材".into());
        }
        Ok(snapshot)
    }) {
        Ok(snapshot) => (Some(snapshot), None),
        Err(error) => (None, Some(error)),
    };
    Ok(DatabaseBackupSnapshot { materials, cards, notes, note_revisions, subscriptions, subscriptions_error, mail, mail_error, review_history, review_history_error, knowledge_bases, membership, artifacts, artifacts_error, deleted_records, deleted_records_error, r4, r4_error })
}

fn checked_values(row: &Row, cols: &[Column], table: &str) -> Result<Vec<SqlValue>, String> {
    let expected: BTreeSet<_> = cols.iter().map(|c| c.name.as_str()).collect();
    let actual: BTreeSet<_> = row.keys().map(String::as_str).collect();
    if actual != expected { return Err(format!("备份表 {table} 字段不匹配")); }
    cols.iter().map(|col| {
        let v = &row[&col.name];
        match (col.kind.as_str(), v) {
            (_, Value::Null) if !col.not_null && col.pk == 0 => Ok(SqlValue::Null),
            ("TEXT", Value::String(s)) => Ok(SqlValue::Text(s.clone())),
            ("INTEGER", Value::Number(n)) => n.as_i64().map(SqlValue::Integer).ok_or_else(|| format!("备份表 {table} 字段类型无效")),
            _ => Err(format!("备份表 {table} 字段类型无效")),
        }
    }).collect()
}

/// Validate the wire structure before any other archive content is written.
pub fn validate_snapshot(conn: &Connection, snapshot: &R4Snapshot) -> Result<(), String> {
    if snapshot.version != 1 { return Err("不支持的项目与画像快照版本".into()); }
    let expected: BTreeSet<_> = TABLES.iter().copied().collect();
    if snapshot.tables.keys().map(String::as_str).collect::<BTreeSet<_>>() != expected { return Err("备份表清单不完整或包含未知表".into()); }
    for &table in TABLES {
        let cols = columns(conn, table)?;
        let mut keys = BTreeSet::new();
        for row in &snapshot.tables[table] {
            checked_values(row, &cols, table)?;
            let key = cols.iter().filter(|c| c.pk > 0).map(|c| row[&c.name].to_string()).collect::<Vec<_>>();
            if !keys.insert(key) { return Err(format!("备份表 {table} 包含重复标识")); }
        }
    }
    let referenced: BTreeSet<&str> = snapshot.tables["project_members"].iter().map(|row| row.get("note_id").and_then(Value::as_str).ok_or("项目成员笔记标识无效")).collect::<Result<_, _>>()?;
    if referenced != snapshot.note_bindings.keys().map(String::as_str).collect() { return Err("项目成员笔记校验清单不匹配".into()); }
    let evidence_refs = evidence_references(&snapshot.tables)?;
    if evidence_refs.keys().ne(snapshot.evidence_bindings.keys()) { return Err("目标证据校验清单不匹配".into()); }
    let profile_refs = profile_references(&snapshot.tables)?;
    if profile_refs.iter().ne(snapshot.profile_bindings.keys()) { return Err("画像证据校验清单不匹配".into()); }
    let valid_hash = |hash: &str| hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
    if snapshot.note_bindings.values().any(|h| !valid_hash(h)) ||
        snapshot.evidence_bindings.values().flatten().any(|h| !valid_hash(h)) ||
        snapshot.profile_bindings.values().any(|b| [&b.note, &b.material, &b.card].into_iter().flatten().any(|h| !valid_hash(h))) {
        return Err("原件指纹格式无效".into());
    }
    for id in snapshot.profile_bindings.keys() {
        expected_source(snapshot, "material", id)?;
        expected_source(snapshot, "note", id)?;
    }
    for id in snapshot.note_bindings.keys() { expected_source(snapshot, "note", id)?; }
    Ok(())
}

/// Check existing rows before restoring any archive files. Missing source records
/// are allowed here: the earlier restore stages are responsible for supplying them.
pub fn validate_destination(conn: &Connection, snapshot: &R4Snapshot) -> Result<(), String> {
    validate_snapshot(conn, snapshot)?;
    let compatible = |expected: Option<&str>, actual: Option<&str>| {
        actual.is_none() || actual == expected
    };
    for (id, expected) in &snapshot.note_bindings {
        if !compatible(Some(expected), note_fingerprint(conn, id)?.as_deref()) {
            return Err("本地项目成员笔记与备份不一致，尚未恢复任何备份内容".into());
        }
    }
    for (key, (kind, id)) in evidence_references(&snapshot.tables)? {
        if !compatible(snapshot.evidence_bindings[&key].as_deref(), evidence_fingerprint(conn, &kind, &id)?.as_deref()) {
            return Err("本地目标证据与备份不一致，尚未恢复任何备份内容".into());
        }
    }
    for (id, expected) in &snapshot.profile_bindings {
        let actual = profile_source_binding(conn, id)?;
        if !compatible(expected.note.as_deref(), actual.note.as_deref()) ||
            !compatible(expected.material.as_deref(), actual.material.as_deref()) ||
            !compatible(expected.card.as_deref(), actual.card.as_deref()) {
            return Err("本地画像证据与备份不一致，尚未恢复任何备份内容".into());
        }
    }
    for &table in TABLES {
        let cols = columns(conn, table)?;
        let keys: Vec<usize> = cols.iter().enumerate().filter_map(|(i, c)| (c.pk > 0).then_some(i)).collect();
        let predicates = keys.iter().map(|i| format!("{} = ?", cols[*i].name)).collect::<Vec<_>>().join(" AND ");
        let lookup = format!("SELECT * FROM {table} WHERE {predicates}");
        for row in &snapshot.tables[table] {
            let values = checked_values(row, &cols, table)?;
            let existing: Option<Row> = conn.query_row(&lookup, params_from_iter(keys.iter().map(|i| &values[*i])), |r| row_value(r, &cols)).optional().map_err(|e| e.to_string())?;
            if existing.as_ref().is_some_and(|value| value != row) {
                return Err(format!("本地备份表 {table} 存在同一标识但内容不同的记录，尚未恢复任何备份内容"));
            }
        }
    }
    Ok(())
}

fn expected_source<'a>(snapshot: &'a R4Snapshot, kind: &str, id: &str) -> Result<Option<Option<&'a str>>, String> {
    let evidence_key = format!("{kind}\n{id}");
    let evidence = snapshot.evidence_bindings.get(&evidence_key).map(Option::as_deref);
    let profile = snapshot.profile_bindings.get(id).and_then(|binding| match kind {
        "material" => Some(binding.material.as_deref()),
        "card" => Some(binding.card.as_deref()),
        "note" => Some(binding.note.as_deref()),
        _ => None,
    });
    if evidence.is_some() && profile.is_some() && evidence != profile {
        return Err("备份中的原件指纹互相矛盾".into());
    }
    let member = if kind == "note" { snapshot.note_bindings.get(id).map(|h| Some(h.as_str())) } else { None };
    let combined = evidence.or(profile);
    if combined.is_some() && member.is_some() && combined != member {
        return Err("备份中的原件指纹互相矛盾".into());
    }
    Ok(combined.or(member))
}

/// Add records without overwriting a different local version, including tombstones.
/// Linked originals additionally have to match the R4 fingerprint.
pub fn restore_material(conn: &mut Connection, protected: bool, expected: Option<&str>, material: &crate::db::RawMaterialDto) -> Result<bool, String> {
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    let local = crate::db::material_for_restore(&tx, &material.id).map_err(|e| crate::error_text::explain("读取本地素材失败", &e))?;
    if protected {
        let current = evidence_fingerprint(&tx, "material", &material.id)?;
        if current.is_some() {
            if current.as_deref() != expected { return Err("本地素材与备份的关联原件不一致，未覆盖".into()); }
        }
        if current.is_none() && expected.is_none() { return Err("备份素材与关联原件缺失状态矛盾，未写入".into()); }
    }
    if let Some((mut current, deleted, _deleted_at)) = local {
        if deleted { return Err("本地同标识素材已删除，未覆盖或复活".into()); }
        // content_hash is a derived index, recomputed by save_material.
        let mut incoming = material.clone();
        current.content_hash.clear();
        incoming.content_hash.clear();
        if current != incoming { return Err("本地同标识素材内容不同，未覆盖".into()); }
        return Ok(false);
    }
    crate::db::save_material(&tx, material).map_err(|e| crate::error_text::explain("恢复素材失败", &e))?;
    if protected {
        if evidence_fingerprint(&tx, "material", &material.id)?.as_deref() != expected {
            return Err("备份素材与关联原件指纹不一致，未写入".into());
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn restore_card(conn: &mut Connection, protected: bool, expected: Option<&str>, card: &crate::db::KnowledgeCardDto) -> Result<bool, String> {
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    let local = crate::db::card_for_restore(&tx, &card.id).map_err(|e| backup_data_error("读取本地卡片失败，未覆盖", &e))?;
    if protected {
        let current = profile_source_binding(&tx, &card.id)?.card;
        if current.is_some() {
            if current.as_deref() != expected { return Err("本地卡片与备份的关联原件不一致，未覆盖".into()); }
        }
        if current.is_none() && expected.is_none() { return Err("备份卡片与关联原件缺失状态矛盾，未写入".into()); }
    }
    if let Some((current, deleted, _deleted_at)) = local {
        if deleted { return Err("本地同标识卡片已删除，未覆盖或复活".into()); }
        if current != *card { return Err("本地同标识卡片内容或学习进度不同，未覆盖".into()); }
        return Ok(false);
    }
    crate::db::upsert_card(&tx, card).map_err(|e| crate::error_text::explain("恢复卡片失败", &e))?;
    if protected {
        if profile_source_binding(&tx, &card.id)?.card.as_deref() != expected {
            return Err("备份卡片与关联原件指纹不一致，未写入".into());
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn restore_artifact(conn: &mut Connection, artifact: &crate::db::ArtifactDto) -> Result<bool, String> {
    if artifact.is_deleted { return Err("备份中的删除态产物无法按当前格式恢复".into()); }
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    let current = crate::db::artifact_for_restore(&tx, &artifact.id).map_err(|e| backup_data_error("读取本地产物失败，未覆盖", &e))?;
    if let Some(current) = current {
        if current.is_deleted { return Err("本地同标识产物已删除，未覆盖或复活".into()); }
        if current != *artifact { return Err("本地同标识产物内容不同，未覆盖".into()); }
        return Ok(false);
    }
    crate::db::save_artifact(&tx, artifact).map_err(|e| crate::error_text::explain("恢复产物失败", &e))?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}

/// Atomic additive restore: exact existing rows are idempotent; any conflicting row,
/// missing FK, invalid field or unsupported version aborts and rolls back the whole snapshot.
pub fn restore_snapshot(conn: &mut Connection, snapshot: &R4Snapshot) -> Result<usize, String> {
    validate_snapshot(conn, snapshot)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    // A restore must not depend on the caller's connection settings for FK safety.
    let foreign_keys: i64 = tx.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if foreign_keys != 1 { return Err("恢复前必须启用数据库关联检查".into()); }
    let referenced: BTreeSet<&str> = snapshot.tables["project_members"].iter().map(|row| row.get("note_id").and_then(Value::as_str).ok_or("项目成员笔记标识无效")).collect::<Result<_, _>>()?;
    if referenced != snapshot.note_bindings.keys().map(String::as_str).collect() { return Err("项目成员笔记校验清单不匹配".into()); }
    for id in referenced {
        if note_fingerprint(&tx, id)?.as_deref() != Some(snapshot.note_bindings[id].as_str()) {
            return Err("项目成员笔记不存在或与备份不一致，未恢复项目关联".into());
        }
    }
    let evidence_refs = evidence_references(&snapshot.tables)?;
    if evidence_refs.keys().ne(snapshot.evidence_bindings.keys()) { return Err("目标证据校验清单不匹配".into()); }
    for (key, (kind, id)) in evidence_refs {
        if evidence_fingerprint(&tx, &kind, &id)? != snapshot.evidence_bindings[&key] {
            return Err("目标证据原件不存在或与备份不一致，未恢复目标关联".into());
        }
    }
    let profile_refs = profile_references(&snapshot.tables)?;
    if profile_refs.iter().ne(snapshot.profile_bindings.keys()) { return Err("画像证据校验清单不匹配".into()); }
    for id in profile_refs {
        if profile_source_binding(&tx, &id)? != snapshot.profile_bindings[&id] {
            return Err("画像证据原件不存在或与备份不一致，未恢复画像关联".into());
        }
    }
    let mut inserted = 0;
    for &table in TABLES {
        let cols = columns(&tx, table)?;
        if cols.is_empty() || !cols.iter().any(|c| c.pk > 0) { return Err(format!("备份表 {table} 结构无效")); }
        let keys: Vec<usize> = cols.iter().enumerate().filter_map(|(i,c)| (c.pk > 0).then_some(i)).collect();
        let predicates = keys.iter().map(|i| format!("{} = ?", cols[*i].name)).collect::<Vec<_>>().join(" AND ");
        let lookup = format!("SELECT * FROM {table} WHERE {predicates}");
        let names = cols.iter().map(|c| c.name.as_str()).collect::<Vec<_>>().join(", ");
        let placeholders = vec!["?"; cols.len()].join(", ");
        let insert = format!("INSERT INTO {table} ({names}) VALUES ({placeholders})");
        for row in &snapshot.tables[table] {
            let values = checked_values(row, &cols, table)?;
            let existing: Option<Row> = tx.query_row(&lookup, params_from_iter(keys.iter().map(|i| &values[*i])), |r| row_value(r, &cols)).optional().map_err(|e| e.to_string())?;
            if let Some(existing) = existing {
                if &existing != row { return Err(format!("备份表 {table} 存在同一标识但内容不同的记录，未恢复")); }
                continue;
            }
            tx.execute(&insert, params_from_iter(values.iter())).map_err(|e| crate::error_text::explain(&format!("恢复备份表 {table} 失败"), &e))?;
            inserted += 1;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(inserted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "writes a SQLite fixture for Go backup verification"]
    fn export_go_system_backup_database_fixture() {
        let dir = std::env::var_os("KF_SYSTEM_BACKUP_DB_FIXTURE_DIR").expect("fixture directory");
        let path = std::path::PathBuf::from(dir).join("knowflick.db");
        assert!(!path.exists(), "fixture destination must be new");
        let mut conn = crate::db::open_db(&path).unwrap();
        conn.execute_batch(r#"
            INSERT INTO materials (id, source_type, title, raw_text, content_hash, media_path, created_at, updated_at, is_deleted)
            VALUES ('material-active', 'image', '素材附件', '正文', 'fixture', 'media/image/material.png', 1700000000000, 1700000000001, 0),
                   ('material-deleted', 'manual', '旧素材', '', 'deleted', NULL, 1700000000002, 1700000000003, 1);
            INSERT INTO cards (id, material_id, headline, summary, details, tags_json, created_at, updated_at, is_deleted)
            VALUES ('card-active', 'material-active', '活动卡片', '概要', '详情', '["标签"]', 1700000000000, 1700000000001, 0),
                   ('card-deleted', 'material-deleted', '旧卡片', '', '', '[]', 1700000000002, 1700000000003, 1);
            INSERT INTO notes (id, title, body_md, tags_json, current_revision, created_at, updated_at, is_deleted, deleted_at, source_material_id, exclude_from_profile)
            VALUES ('note-active', '当前笔记', '![素材](media/image/material.png)', '["备份"]', 2, 1700000000000, 1700000000001, 0, NULL, 'material-active', 1),
                   ('note-deleted', '回收站笔记', '![笔迹](media/ink/note.json)', '[]', 1, 1700000000002, 1700000000003, 1, 1700000000004, NULL, 0);
            INSERT INTO projects (id,name,description,created_at,updated_at,archived_at) VALUES ('project-1','测试项目','说明',1700000000000,1700000000001,NULL);
            INSERT INTO project_members VALUES ('project-1','note-active',1700000000000);
            INSERT INTO goals (id,title,done_criteria,scope,created_at,achieved_at,abandoned_at,review_note) VALUES ('goal-1','测试目标','完成标准','',1700000000000,NULL,NULL,'');
            INSERT INTO goal_evidence VALUES ('goal-1','material-active','material',1700000000000);
            INSERT INTO profile_claims (id,kind,content,evidence_json,scope,created_at,confirmed_at,expires_at,denied_at,superseded_by,status) VALUES ('claim-1','偏好','偏好中文','["note-active"]','',1700000000000,NULL,NULL,NULL,NULL,'active');
            INSERT INTO note_revisions (note_id, revision, title, body_md, saved_at) VALUES
            ('note-active', 1, '初稿', '只读旧正文', 1699999999000),
            ('note-active', 2, '当前笔记', '![素材](media/image/material.png)', 1700000000001),
            ('note-deleted', 1, '回收站笔记', '![笔迹](media/ink/note.json)', 1700000000003);
            INSERT INTO knowledge_bases (id, name, description, created_at, updated_at)
            VALUES ('kb-1', '测试库', '说明', 1700000000000, 1700000000001);
            INSERT INTO kb_membership VALUES ('kb-1', 'note-active', 1700000000000), ('kb-1', 'note-deleted', 1700000000004);
            INSERT INTO artifacts (id, artifact_type, title, content_markdown, source_card_ids, source_note_ids, created_at, updated_at, is_deleted)
            VALUES ('artifact-active', 'briefing', '活动产物', '正文', '["card-active"]', '["note-active"]', 1700000000000, 1700000000001, 0),
                   ('artifact-deleted', 'briefing', '旧产物', '', '[]', '[]', 1700000000002, 1700000000003, 1);
        "#).unwrap();
        let snapshot = capture_database(&mut conn).unwrap();
        assert_eq!(snapshot.materials.len(), 1);
        assert_eq!(snapshot.cards.len(), 1);
        assert_eq!(snapshot.notes.len(), 2);
        assert_eq!(snapshot.artifacts.len(), 1);
        assert_eq!(snapshot.membership.len(), 2);
        assert_eq!(snapshot.note_revisions.len(), 3);
        std::fs::write(path.with_extension("json"), serde_json::to_vec(&snapshot).unwrap()).unwrap();
    }

    fn database() -> Connection {
        let dir = std::env::temp_dir().join(format!("kf-r4-backup-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        crate::db::open_db(&dir.join("knowflick.db")).unwrap()
    }
    fn seed(conn: &Connection) {
        conn.execute_batch("INSERT INTO notes(id,title,body_md,created_at,updated_at) VALUES ('n1','笔记','正文',1,1);
          INSERT INTO projects(id,name,description,created_at,updated_at,archived_at) VALUES ('p1','项目','背景',1,2,3);
          INSERT INTO project_members(project_id,note_id,added_at) VALUES ('p1','n1',2);
          INSERT INTO goals(id,title,done_criteria,scope,created_at,achieved_at,review_note) VALUES ('g1','目标','完成','p1',1,4,'回顾');
          INSERT INTO goal_evidence(goal_id,evidence_id,kind,linked_at) VALUES ('g1','n1','note',2);
          INSERT INTO profile_claims(id,kind,content,evidence_json,scope,created_at,denied_at,status) VALUES ('c1','inference','旧推测','[\"n1\"]','p1',1,3,'paused');
          INSERT INTO profile_denials(evidence_fingerprint,denied_at) VALUES ('fingerprint',3);").unwrap();
    }
    #[test]
    fn captured_archive_records_restore_before_r4_and_support_repeat() {
        let mut source = database();
        seed(&source);
        source.execute_batch("INSERT INTO materials(id,source_type,title,raw_text,content_hash,created_at,updated_at) VALUES ('m1','manual','素材','正文','hash',10,20);
            INSERT INTO goal_evidence(goal_id,evidence_id,kind,linked_at) VALUES ('g1','m1','material',2);").unwrap();
        let captured = capture_database(&mut source).unwrap();
        let snapshot = captured.r4.unwrap();
        let mut target = database();
        validate_snapshot(&target, &snapshot).unwrap();
        for material in &captured.materials { crate::db::save_material(&target, material).unwrap(); }
        for card in &captured.cards { crate::db::upsert_card(&target, card).unwrap(); }
        for note in &captured.notes { crate::notes::note_restore_upsert(&target, note).unwrap(); }
        assert_eq!(restore_snapshot(&mut target, &snapshot).unwrap(), 7);
        assert_eq!(restore_snapshot(&mut target, &snapshot).unwrap(), 0);
    }
    #[test]
    fn captured_deleted_evidence_restores_before_its_r4_references() {
        let mut source = database();
        seed(&source);
        source.execute_batch("INSERT INTO materials(id,source_type,title,raw_text,content_hash,created_at,updated_at,is_deleted) VALUES ('m1','manual','素材','正文','hash',10,20,1);
            INSERT INTO goal_evidence(goal_id,evidence_id,kind,linked_at) VALUES ('g1','m1','material',2);").unwrap();
        let captured = capture_database(&mut source).unwrap();
        let snapshot = captured.r4.unwrap();
        let deleted = captured.deleted_records.unwrap();
        assert_eq!(deleted.materials.len(), 1);
        let mut target = database();
        crate::backup_deleted::restore(&mut target, &deleted).unwrap();
        for note in &captured.notes { crate::notes::note_restore_upsert(&target, note).unwrap(); }
        assert_eq!(restore_snapshot(&mut target, &snapshot).unwrap(), 7);
        assert_eq!(target.query_row("SELECT is_deleted FROM materials WHERE id='m1'", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    }
    #[test]
    fn preflight_and_atomic_original_restore_protect_local_changes() {
        let mut source = database();
        seed(&source);
        source.execute_batch("INSERT INTO materials(id,source_type,title,raw_text,content_hash,created_at,updated_at) VALUES ('m1','manual','素材','正文','hash',10,20);
            INSERT INTO goal_evidence(goal_id,evidence_id,kind,linked_at) VALUES ('g1','m1','material',2);
            INSERT INTO cards(id,headline,summary,details,created_at,updated_at) VALUES ('card1','标题','摘要','正文',10,10);
            UPDATE profile_claims SET evidence_json='[\"n1\",\"card1\"]' WHERE id='c1';").unwrap();
        let captured = capture_database(&mut source).unwrap();
        let snapshot = captured.r4.unwrap();
        let material = &captured.materials[0];
        let card = &captured.cards[0];
        let material_hash = snapshot.evidence_bindings["material\nm1"].as_deref();
        let card_hash = snapshot.profile_bindings["card1"].card.as_deref();
        let mut target = database();
        validate_destination(&target, &snapshot).unwrap();
        let mut damaged = material.clone();
        damaged.raw_text = "被改变的包内正文".into();
        assert!(restore_material(&mut target, true, material_hash, &damaged).is_err());
        assert_eq!(target.query_row("SELECT COUNT(*) FROM materials", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        assert!(restore_material(&mut target, true, material_hash, material).unwrap());
        assert!(!restore_material(&mut target, true, material_hash, material).unwrap());
        assert!(restore_card(&mut target, true, card_hash, card).unwrap());
        assert!(!restore_card(&mut target, true, card_hash, card).unwrap());
        // Source fingerprints intentionally ignore review counters; the full
        // record comparison must still prevent an old backup resetting them.
        target.execute("UPDATE cards SET review_count=7 WHERE id='card1'", []).unwrap();
        assert!(restore_card(&mut target, true, card_hash, card).is_err());
        assert_eq!(target.query_row("SELECT review_count FROM cards WHERE id='card1'", [], |r| r.get::<_, i64>(0)).unwrap(), 7);
        target.execute("UPDATE materials SET raw_text='本地新内容' WHERE id='m1'", []).unwrap();
        target.execute("UPDATE cards SET details='本地卡片新内容' WHERE id='card1'", []).unwrap();
        assert!(validate_destination(&target, &snapshot).is_err());
        assert!(restore_material(&mut target, true, material_hash, material).is_err());
        assert!(restore_card(&mut target, true, card_hash, card).is_err());
        assert_eq!(target.query_row("SELECT raw_text FROM materials WHERE id='m1'", [], |r| r.get::<_, String>(0)).unwrap(), "本地新内容");
        assert_eq!(target.query_row("SELECT details FROM cards WHERE id='card1'", [], |r| r.get::<_, String>(0)).unwrap(), "本地卡片新内容");
    }
    #[test]
    fn preflight_rejects_existing_r4_and_missing_state_conflicts() {
        let mut source = database();
        seed(&source);
        source.execute("UPDATE profile_claims SET evidence_json='[\"missing\"]' WHERE id='c1'", []).unwrap();
        let snapshot = export_snapshot(&mut source).unwrap();
        let target = database();
        target.execute("INSERT INTO notes(id,title,body_md,created_at,updated_at) VALUES ('missing','本地','正文',1,1)", []).unwrap();
        assert!(validate_destination(&target, &snapshot).is_err());
        target.execute("DELETE FROM notes WHERE id='missing'", []).unwrap();
        target.execute("INSERT INTO projects(id,name,description,created_at,updated_at) VALUES ('p1','本地项目','',1,1)", []).unwrap();
        assert!(validate_destination(&target, &snapshot).is_err());
    }
    #[test]
    fn protected_note_checks_under_write_lock_and_preserves_tags() {
        let mut source = database();
        seed(&source);
        source.execute("UPDATE notes SET tags_json='[\"学习\"]', exclude_from_profile=1 WHERE id='n1'", []).unwrap();
        let captured = capture_database(&mut source).unwrap();
        let snapshot = captured.r4.unwrap();
        let note = &captured.notes[0];
        let hash = snapshot.note_bindings["n1"].as_str();
        let target = database();
        validate_destination(&target, &snapshot).unwrap();
        let mut altered = note.clone();
        altered.body_md = "包内错误正文".into();
        assert!(crate::notes::note_restore_upsert_checked(&target, &altered, Some(Some(hash))).is_err());
        assert!(crate::notes::note_get(&target, "n1").unwrap().is_none());
        crate::notes::note_restore_upsert_checked(&target, note, Some(Some(hash))).unwrap();
        let restored = crate::notes::note_get(&target, "n1").unwrap().unwrap();
        assert_eq!(restored.tags_json, "[\"学习\"]");
        assert!(restored.exclude_from_profile);
        target.execute("UPDATE notes SET exclude_from_profile=0 WHERE id='n1'", []).unwrap();
        assert!(matches!(
            crate::notes::note_restore_upsert_checked(&target, note, Some(Some(hash))).unwrap(),
            crate::notes::NoteRestoreOutcome::SkippedDivergent,
        ), "same-revision restore must preserve a local privacy-setting conflict");
        assert!(!crate::notes::note_get(&target, "n1").unwrap().unwrap().exclude_from_profile);
        target.execute("UPDATE notes SET exclude_from_profile=1, body_md='本地新内容' WHERE id='n1'", []).unwrap();
        assert!(crate::notes::note_restore_upsert_checked(&target, note, Some(Some(hash))).is_err());
        assert_eq!(crate::notes::note_get(&target, "n1").unwrap().unwrap().body_md, "本地新内容");
    }
    #[test]
    fn captured_note_media_and_project_restore_to_new_library() {
        let source_dir = std::env::temp_dir().join(format!("kf-backup-media-source-{}", uuid::Uuid::new_v4()));
        let target_dir = std::env::temp_dir().join(format!("kf-backup-media-target-{}", uuid::Uuid::new_v4()));
        let mut source = crate::db::open_db(&source_dir.join("knowflick.db")).unwrap();
        seed(&source);
        let path = crate::media::save_media(&source_dir, "image", "image/png", b"image-bytes").unwrap();
        source.execute("UPDATE notes SET body_md=?1, tags_json='[\"学习\"]' WHERE id='n1'", [format!("![图]({path})")]).unwrap();
        let captured = capture_database(&mut source).unwrap();
        let snapshot = captured.r4.unwrap();
        let mut target = crate::db::open_db(&target_dir.join("knowflick.db")).unwrap();
        validate_destination(&target, &snapshot).unwrap();
        let bytes = crate::media::read_media(&source_dir, &path).unwrap();
        assert_eq!(crate::media::restore_media(&target_dir, &path, &bytes).unwrap(), path);
        let note = &captured.notes[0];
        crate::notes::note_restore_upsert_checked(&target, note, Some(Some(&snapshot.note_bindings["n1"]))).unwrap();
        assert_eq!(restore_snapshot(&mut target, &snapshot).unwrap(), 6);
        let restored = crate::notes::note_get(&target, "n1").unwrap().unwrap();
        assert_eq!(restored.body_md, format!("![图]({path})"));
        assert_eq!(restored.tags_json, "[\"学习\"]");
        assert_eq!(crate::media::read_media(&target_dir, &path).unwrap(), bytes);
        assert_eq!(crate::media::restore_media(&target_dir, &path, &bytes).unwrap(), path);
        assert_eq!(restore_snapshot(&mut target, &snapshot).unwrap(), 0);
    }
    #[test]
    fn note_history_roundtrip_is_atomic_and_preserves_original_saved_at() {
        let mut source = database();
        seed(&source);
        source.execute_batch("UPDATE notes SET current_revision=2, updated_at=99 WHERE id='n1';
            INSERT INTO note_revisions(note_id,revision,title,body_md,saved_at) VALUES ('n1',1,'初稿','旧正文',2), ('n1',2,'笔记','正文',3);").unwrap();
        let captured = capture_database(&mut source).unwrap();
        let note = &captured.notes[0];
        let history = &captured.note_revisions;
        let target = database();
        crate::notes::note_restore_upsert_with_history(&target, note, None, Some(history)).unwrap();
        assert_eq!(crate::notes::revisions_for_backup(&target).unwrap(), *history);
        crate::notes::note_restore_upsert_with_history(&target, note, None, Some(history)).unwrap();
        assert_eq!(crate::notes::revisions_for_backup(&target).unwrap(), *history);
        target.execute("UPDATE note_revisions SET body_md='本地修订' WHERE note_id='n1' AND revision=1", []).unwrap();
        assert!(crate::notes::note_restore_upsert_with_history(&target, note, None, Some(history)).is_err());
        assert_eq!(target.query_row("SELECT body_md FROM note_revisions WHERE note_id='n1' AND revision=1", [], |r| r.get::<_, String>(0)).unwrap(), "本地修订");
        let empty = database();
        let mut invalid = history.clone();
        invalid[1].body_md = "与当前笔记不一致".into();
        assert!(crate::notes::note_restore_upsert_with_history(&empty, note, None, Some(&invalid)).is_err());
        assert!(crate::notes::note_get(&empty, "n1").unwrap().is_none());
        assert!(crate::notes::revisions_for_backup(&empty).unwrap().is_empty());
        let no_history = database();
        crate::notes::note_restore_upsert_with_history(&no_history, note, None, Some(&[])).unwrap();
        assert!(crate::notes::revisions_for_backup(&no_history).unwrap().is_empty(), "do not invent missing history");
        let older = database();
        let mut ancestor = note.clone();
        ancestor.current_revision = 1;
        ancestor.title = history[0].title.clone();
        ancestor.body_md = history[0].body_md.clone();
        crate::notes::note_restore_upsert_with_history(&older, &ancestor, None, Some(&history[..1])).unwrap();
        older.execute("UPDATE notes SET is_favorite=1 WHERE id='n1'", []).unwrap();
        assert!(crate::notes::note_restore_upsert_with_history(&older, note, None, Some(history)).is_err());
        assert_eq!(crate::notes::note_get(&older, "n1").unwrap().unwrap().current_revision, 1);
        older.execute("UPDATE notes SET is_favorite=0 WHERE id='n1'", []).unwrap();
        crate::notes::note_restore_upsert_with_history(&older, note, None, Some(history)).unwrap();
        assert_eq!(crate::notes::revisions_for_backup(&older).unwrap(), *history);
    }
    #[test]
    fn ordinary_records_are_idempotent_and_never_overwrite_changes_or_tombstones() {
        let mut source = database();
        source.execute_batch("INSERT INTO materials(id,source_type,title,raw_text,content_hash,created_at,updated_at) VALUES ('m','manual','素材','正文','old-derived-hash',10,20);
            INSERT INTO cards(id,headline,summary,details,created_at,updated_at) VALUES ('c','卡片','摘要','正文',10,10);
            INSERT INTO artifacts(id,artifact_type,title,content_markdown,created_at,updated_at) VALUES ('a','note','','正文',10,10);").unwrap();
        let captured = capture_database(&mut source).unwrap();
        let material = &captured.materials[0];
        let card = &captured.cards[0];
        let artifact = &captured.artifacts[0];
        let mut target = database();
        assert!(restore_material(&mut target, false, None, material).unwrap());
        assert!(restore_card(&mut target, false, None, card).unwrap());
        assert!(restore_artifact(&mut target, artifact).unwrap());
        assert!(!restore_material(&mut target, false, None, material).unwrap());
        assert!(!restore_card(&mut target, false, None, card).unwrap());
        assert!(!restore_artifact(&mut target, artifact).unwrap());
        target.execute_batch("UPDATE materials SET raw_text='本地素材' WHERE id='m';
            UPDATE cards SET review_count=12 WHERE id='c';
            UPDATE artifacts SET content_markdown='本地产物' WHERE id='a';").unwrap();
        assert!(restore_material(&mut target, false, None, material).is_err());
        assert!(restore_card(&mut target, false, None, card).is_err());
        assert!(restore_artifact(&mut target, artifact).is_err());
        assert_eq!(target.query_row("SELECT raw_text FROM materials WHERE id='m'", [], |r| r.get::<_, String>(0)).unwrap(), "本地素材");
        assert_eq!(target.query_row("SELECT review_count FROM cards WHERE id='c'", [], |r| r.get::<_, i64>(0)).unwrap(), 12);
        assert_eq!(target.query_row("SELECT content_markdown FROM artifacts WHERE id='a'", [], |r| r.get::<_, String>(0)).unwrap(), "本地产物");
        target.execute_batch("UPDATE materials SET is_deleted=1 WHERE id='m'; UPDATE cards SET is_deleted=1 WHERE id='c'; UPDATE artifacts SET is_deleted=1 WHERE id='a';").unwrap();
        assert!(restore_material(&mut target, false, None, material).is_err());
        assert!(restore_card(&mut target, false, None, card).is_err());
        assert!(restore_artifact(&mut target, artifact).is_err());
        for table in ["materials", "cards", "artifacts"] {
            assert_eq!(target.query_row(&format!("SELECT is_deleted FROM {table}"), [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        }
    }
    #[test]
    fn malformed_local_json_is_not_silently_exported_or_treated_as_equal() {
        let mut source = database();
        seed(&source);
        source.execute_batch("INSERT INTO cards(id,headline,summary,details,created_at,updated_at) VALUES ('c','卡片','摘要','正文',10,10);
            INSERT INTO artifacts(id,artifact_type,title,content_markdown,created_at,updated_at) VALUES ('a','note','产物','正文',10,10);").unwrap();
        let valid = capture_database(&mut source).unwrap();
        let card = &valid.cards[0];
        let artifact = &valid.artifacts[0];
        source.execute("UPDATE cards SET tags_json='坏数据' WHERE id='c'", []).unwrap();
        assert!(capture_database(&mut source).err().unwrap().contains("记录字段格式损坏"));
        source.execute("UPDATE cards SET tags_json='[]' WHERE id='c'", []).unwrap();
        source.execute("UPDATE notes SET tags_json='坏数据' WHERE id='n1'", []).unwrap();
        assert!(capture_database(&mut source).err().unwrap().contains("笔记标签数据损坏"));
        source.execute("UPDATE notes SET tags_json='[]' WHERE id='n1'", []).unwrap();
        source.execute("UPDATE artifacts SET source_card_ids='坏数据' WHERE id='a'", []).unwrap();
        let partial = capture_database(&mut source).unwrap();
        assert!(partial.artifacts.is_empty());
        assert!(partial.artifacts_error.unwrap().contains("记录字段格式损坏"));
        let mut target = database();
        restore_card(&mut target, false, None, card).unwrap();
        restore_artifact(&mut target, artifact).unwrap();
        target.execute("UPDATE cards SET tags_json='坏数据' WHERE id='c'", []).unwrap();
        target.execute("UPDATE artifacts SET source_card_ids='坏数据' WHERE id='a'", []).unwrap();
        assert!(restore_card(&mut target, false, None, card).unwrap_err().contains("格式损坏"));
        assert!(restore_artifact(&mut target, artifact).unwrap_err().contains("格式损坏"));
        assert_eq!(target.query_row("SELECT tags_json FROM cards WHERE id='c'", [], |r| r.get::<_, String>(0)).unwrap(), "坏数据");
        assert_eq!(target.query_row("SELECT source_card_ids FROM artifacts WHERE id='a'", [], |r| r.get::<_, String>(0)).unwrap(), "坏数据");
    }
    #[test]
    fn roundtrip_keeps_relations_denials_and_archived_status_and_is_idempotent() {
        let mut src = database(); seed(&src);
        let snapshot = export_snapshot(&mut src).unwrap();
        let json = serde_json::to_string(&snapshot).unwrap();
        assert!(!json.contains("mcp_grants"));
        let decoded: R4Snapshot = serde_json::from_str(&json).unwrap();
        let mut dst = database();
        dst.execute("INSERT INTO notes(id,title,body_md,created_at,updated_at) VALUES ('n1','笔记','正文',1,1)", []).unwrap();
        assert_eq!(restore_snapshot(&mut dst, &decoded).unwrap(), 6);
        assert_eq!(restore_snapshot(&mut dst, &decoded).unwrap(), 0);
        assert_eq!(export_snapshot(&mut dst).unwrap(), snapshot);
    }
    #[test]
    fn conflict_missing_parent_and_bad_fields_roll_back_all_changes() {
        let mut src = database(); seed(&src); let snapshot = export_snapshot(&mut src).unwrap();
        let mut dst = database();
        assert!(restore_snapshot(&mut dst, &snapshot).is_err(), "missing note must abort all");
        assert_eq!(dst.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        dst.execute("INSERT INTO notes(id,title,body_md,created_at,updated_at) VALUES ('n1','同标识不同内容','正文',1,1)", []).unwrap();
        assert!(restore_snapshot(&mut dst, &snapshot).is_err(), "same note ID with different content must not be linked");
        assert_eq!(dst.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        dst.execute("UPDATE notes SET title='笔记' WHERE id='n1'", []).unwrap();
        dst.execute("INSERT INTO projects(id,name,description,created_at,updated_at) VALUES ('p1','本地内容','',1,1)", []).unwrap();
        assert!(restore_snapshot(&mut dst, &snapshot).is_err());
        assert_eq!(dst.query_row("SELECT COUNT(*) FROM goals", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        let mut malformed = snapshot.clone();
        malformed.tables.get_mut("projects").unwrap()[0].insert("created_at".into(), Value::String("invalid".into()));
        assert!(restore_snapshot(&mut database(), &malformed).is_err());
        let mut unknown = snapshot.clone(); unknown.tables.insert("mcp_grants".into(), vec![]);
        assert!(restore_snapshot(&mut database(), &unknown).is_err());
        let mut missing = snapshot.clone(); missing.tables.remove("profile_denials");
        assert!(restore_snapshot(&mut database(), &missing).is_err());
        let mut invalid_binding = snapshot.clone(); invalid_binding.note_bindings.clear();
        assert!(restore_snapshot(&mut dst, &invalid_binding).is_err());
        let mut duplicate = snapshot.clone();
        let mut conflicting = duplicate.tables["goals"][0].clone();
        conflicting.insert("title".into(), Value::String("冲突".into()));
        duplicate.tables.get_mut("goals").unwrap().push(conflicting);
        let mut duplicate_target = database();
        duplicate_target.execute("INSERT INTO notes(id,title,body_md,created_at,updated_at) VALUES ('n1','笔记','正文',1,1)", []).unwrap();
        assert!(restore_snapshot(&mut duplicate_target, &duplicate).is_err());
        assert_eq!(duplicate_target.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        let mut future = snapshot; future.version = 2;
        assert!(restore_snapshot(&mut database(), &future).is_err());
    }
    #[test]
    fn schema_drift_never_exports_new_columns_or_partially_restores() {
        let mut source = database(); seed(&source);
        let snapshot = export_snapshot(&mut source).unwrap();
        source.execute("ALTER TABLE projects ADD COLUMN private_field TEXT DEFAULT 'secret'", []).unwrap();
        assert!(export_snapshot(&mut source).is_err());
        let mut target = database();
        target.execute("INSERT INTO notes(id,title,body_md,created_at,updated_at) VALUES ('n1','笔记','正文',1,1)", []).unwrap();
        target.execute("ALTER TABLE goals ADD COLUMN private_field TEXT", []).unwrap();
        assert!(restore_snapshot(&mut target, &snapshot).is_err());
        assert_eq!(target.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    }
    #[test]
    fn goal_sources_must_match_including_missing_and_deleted_state() {
        let mut source = database();
        source.execute_batch("INSERT INTO goals(id,title,done_criteria,created_at) VALUES ('g','目标','完成',1);
          INSERT INTO materials(id,source_type,title,raw_text,content_hash,created_at,updated_at,is_deleted) VALUES ('m','manual','素材','原文','h',1,2,1);
          INSERT INTO goal_evidence(goal_id,evidence_id,kind,linked_at) VALUES ('g','m','material',2),('g','missing','note',2);").unwrap();
        let snapshot = export_snapshot(&mut source).unwrap();
        assert_eq!(snapshot.evidence_bindings["note\nmissing"], None);
        let mut target = database();
        target.execute("INSERT INTO materials(id,source_type,title,raw_text,content_hash,created_at,updated_at,is_deleted) VALUES ('m','manual','素材','不同原文','h',1,2,1)", []).unwrap();
        assert!(restore_snapshot(&mut target, &snapshot).is_err());
        assert_eq!(target.query_row("SELECT COUNT(*) FROM goals", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        target.execute("UPDATE materials SET raw_text='原文' WHERE id='m'", []).unwrap();
        target.execute("INSERT INTO notes(id,title,body_md,created_at,updated_at) VALUES ('missing','后来出现','内容',1,1)", []).unwrap();
        assert!(restore_snapshot(&mut target, &snapshot).is_err());
        target.execute("DELETE FROM notes WHERE id='missing'", []).unwrap();
        assert_eq!(restore_snapshot(&mut target, &snapshot).unwrap(), 3);
        assert_eq!(restore_snapshot(&mut target, &snapshot).unwrap(), 0);
    }
    #[test]
    fn untyped_profile_evidence_preserves_all_namespaces_and_missing_sources() {
        let mut source = database();
        source.execute_batch("INSERT INTO notes(id,title,body_md,created_at,updated_at) VALUES ('same','笔记','正文',1,1);
          INSERT INTO materials(id,source_type,title,raw_text,content_hash,created_at,updated_at) VALUES ('same','manual','素材','正文','h',1,2);
          INSERT INTO cards(id,headline,summary,details,created_at,updated_at) VALUES ('same','知识卡','摘要','内容',1,2);
          INSERT INTO profile_claims(id,kind,content,evidence_json,scope,created_at) VALUES ('claim','fact','画像','[\"same\",\"missing\"]','global',1);").unwrap();
        let snapshot = export_snapshot(&mut source).unwrap();
        let binding = &snapshot.profile_bindings["same"];
        assert!(binding.note.is_some() && binding.material.is_some() && binding.card.is_some());
        assert_eq!(snapshot.profile_bindings["missing"], ProfileSourceBinding { note: None, material: None, card: None });
        let mut target = database();
        target.execute_batch("INSERT INTO notes(id,title,body_md,created_at,updated_at) VALUES ('same','笔记','正文',1,1);
          INSERT INTO materials(id,source_type,title,raw_text,content_hash,created_at,updated_at) VALUES ('same','manual','素材','正文','h',1,2);
          INSERT INTO cards(id,headline,summary,details,created_at,updated_at) VALUES ('same','知识卡','摘要','错误内容',1,2);").unwrap();
        assert!(restore_snapshot(&mut target, &snapshot).is_err());
        assert_eq!(target.query_row("SELECT COUNT(*) FROM profile_claims", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        target.execute("UPDATE cards SET details='内容',review_count=9 WHERE id='same'", []).unwrap();
        target.execute("INSERT INTO notes(id,title,body_md,created_at,updated_at) VALUES ('missing','意外出现','内容',1,1)", []).unwrap();
        assert!(restore_snapshot(&mut target, &snapshot).is_err());
        target.execute("DELETE FROM notes WHERE id='missing'", []).unwrap();
        assert_eq!(restore_snapshot(&mut target, &snapshot).unwrap(), 1);
        assert_eq!(restore_snapshot(&mut target, &snapshot).unwrap(), 0);
        let mut malformed = snapshot.clone();
        malformed.tables.get_mut("profile_claims").unwrap()[0].insert("evidence_json".into(), Value::String("{}".into()));
        assert!(restore_snapshot(&mut target, &malformed).is_err());
        let mut omitted = snapshot; omitted.profile_bindings.remove("missing");
        assert!(restore_snapshot(&mut target, &omitted).is_err());
        source.execute("UPDATE profile_claims SET evidence_json='{}' WHERE id='claim'", []).unwrap();
        assert!(export_snapshot(&mut source).is_err(), "invalid evidence must not be silently treated as empty");
    }
    #[test]
    fn database_capture_reads_all_tables_from_same_wal_snapshot() {
        let mut source = database(); seed(&source);
        source.execute("INSERT INTO subscriptions(id,type,title,target_url,interval_minutes,is_active,created_at) VALUES('s','rss','原订阅','https://example.org/feed',30,1,1)", []).unwrap();
        crate::mail::ensure_backup_schema(&source).unwrap();
        let mail_id = "00000000-0000-4000-8000-000000000001";
        let mail_config = serde_json::json!({"id":mail_id,"name":"邮箱","email":"reader@example.org","host":"imap.example.org","port":993,"username":"reader","folder":"INBOX","syncLimit":50,"syncIntervalMinutes":0}).to_string();
        source.execute("INSERT INTO mail_accounts(id,config_json,created_at,uid_validity,last_uid) VALUES(?1,?2,1,7,1)", rusqlite::params![mail_id,mail_config]).unwrap();
        source.execute("INSERT INTO mail_sync_state(account_id) VALUES(?1)", [mail_id]).unwrap();
        source.execute("INSERT INTO review_events(event_id,card_id,reviewed_at,rating,algorithm,project_ids_json,project_attribution_complete) VALUES('00000000-0000-4000-8000-000000000011','card-before',100,'good','fsrs','[]',0)", []).unwrap();
        let writer = Connection::open(source.path().unwrap()).unwrap();
        let before = export_snapshot(&mut source).unwrap();
        let tx = source.transaction().unwrap();
        let capture = capture_database_from_connection(&tx, || {
            writer.execute("UPDATE notes SET title='并发改动' WHERE id='n1'", []).unwrap();
            writer.execute("INSERT INTO note_revisions(note_id,revision,title,body_md,saved_at) VALUES ('n1',1,'并发改动','正文',9)", []).unwrap();
            writer.execute("UPDATE goals SET title='并发目标' WHERE id='g1'", []).unwrap();
            writer.execute("UPDATE subscriptions SET title='并发订阅' WHERE id='s'", []).unwrap();
            writer.execute("UPDATE mail_accounts SET last_uid=99 WHERE id=?1", [mail_id]).unwrap();
            writer.execute("UPDATE mail_sync_state SET last_attempt_at=123 WHERE account_id=?1", [mail_id]).unwrap();
            writer.execute("INSERT INTO review_events(event_id,card_id,reviewed_at,rating,algorithm,project_ids_json,project_attribution_complete) VALUES('00000000-0000-4000-8000-000000000012','card-after',200,'easy','fsrs','[]',0)", []).unwrap();
        }, None).unwrap();
        tx.commit().unwrap();
        assert_eq!(capture.notes[0].title, "笔记");
        assert!(capture.note_revisions.is_empty());
        assert_eq!(capture.subscriptions.unwrap().items[0].title, "原订阅");
        let mail = capture.mail.unwrap();
        assert_eq!(mail.accounts[0].last_uid, 1);
        assert_eq!(mail.sync_states[0].last_attempt_at, None);
        let history = capture.review_history.unwrap();
        assert_eq!(history.events.len(), 1, "backup snapshot must exclude events committed after its first database read");
        assert_eq!(history.events[0].card_id, "card-before");
        assert_eq!(source.query_row("SELECT COUNT(*) FROM review_events", [], |r| r.get::<_, i64>(0)).unwrap(), 2);
        assert_eq!(capture.r4.unwrap(), before);
        assert_eq!(source.query_row("SELECT title FROM notes WHERE id='n1'", [], |r| r.get::<_, String>(0)).unwrap(), "并发改动");
    }
    #[test]
    fn invalid_r4_does_not_block_existing_partial_database_backup() {
        let mut source = database(); seed(&source);
        source.execute("UPDATE profile_claims SET evidence_json='{}'", []).unwrap();
        let snapshot = capture_database(&mut source).unwrap();
        assert_eq!(snapshot.notes.len(), 1);
        assert!(snapshot.r4.is_none());
        assert!(snapshot.r4_error.unwrap().contains("画像证据格式无效"));
    }
}
