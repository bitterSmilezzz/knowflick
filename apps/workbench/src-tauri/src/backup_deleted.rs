//! Versioned transfer of soft-deleted originals for desktop backups.
//! Tombstones stay in the trash when restored; an archive never revives them.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeletedMaterialRecord {
    pub material: crate::db::RawMaterialDto,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeletedCardRecord {
    pub card: crate::db::KnowledgeCardDto,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeletedRecordsSnapshot {
    pub version: u32,
    pub materials: Vec<DeletedMaterialRecord>,
    pub cards: Vec<DeletedCardRecord>,
    pub artifacts: Vec<crate::db::ArtifactDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeletedRestoreCounts {
    pub materials: usize,
    pub cards: usize,
    pub artifacts: usize,
    pub already_present: usize,
}

impl DeletedRestoreCounts {
    fn new() -> Self {
        Self { materials: 0, cards: 0, artifacts: 0, already_present: 0 }
    }
}

pub fn capture(conn: &Connection) -> Result<DeletedRecordsSnapshot, String> {
    let materials = crate::db::deleted_materials_for_backup(conn)
        .map_err(|e| crate::error_text::explain("读取备份回收站素材失败", &e))?
        .into_iter()
        .map(|(material, deleted_at)| DeletedMaterialRecord { material, deleted_at })
        .collect();
    let cards = crate::db::deleted_cards_for_backup(conn)
        .map_err(|e| crate::error_text::explain("读取备份回收站卡片失败", &e))?
        .into_iter()
        .map(|(card, deleted_at)| DeletedCardRecord { card, deleted_at })
        .collect();
    let artifacts = crate::db::deleted_artifacts_for_backup(conn)
        .map_err(|e| crate::error_text::explain("读取备份回收站产物失败", &e))?;
    let snapshot = DeletedRecordsSnapshot { version: 1, materials, cards, artifacts };
    validate_snapshot(&snapshot)?;
    for record in &snapshot.cards {
        if let Some(material_id) = record.card.material_id.as_deref() {
            let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM materials WHERE id=?1)", [material_id], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            if !exists {
                return Err("回收站卡片引用的来源素材不存在，无法安全备份回收站".into());
            }
        }
    }
    Ok(snapshot)
}

pub fn validate_snapshot(snapshot: &DeletedRecordsSnapshot) -> Result<(), String> {
    if snapshot.version != 1 {
        return Err("不支持的回收站备份版本".into());
    }
    let mut material_ids = std::collections::BTreeSet::new();
    for record in &snapshot.materials {
        let id = record.material.id.trim();
        if id.is_empty() || !material_ids.insert(id.to_owned()) {
            return Err("回收站素材标识为空或重复".into());
        }
        if record.deleted_at.is_some_and(|at| at < 0) {
            return Err("回收站素材删除时间无效".into());
        }
        if record.material.media_path.as_deref().is_some_and(|path| !valid_media_path(path)) {
            return Err("回收站素材附件路径无效".into());
        }
    }
    let mut card_ids = std::collections::BTreeSet::new();
    for record in &snapshot.cards {
        let id = record.card.id.trim();
        if id.is_empty() || !card_ids.insert(id.to_owned()) {
            return Err("回收站卡片标识为空或重复".into());
        }
        if record.deleted_at.is_some_and(|at| at < 0) {
            return Err("回收站卡片删除时间无效".into());
        }
    }
    let mut artifact_ids = std::collections::BTreeSet::new();
    for artifact in &snapshot.artifacts {
        let id = artifact.id.trim();
        if id.is_empty() || !artifact_ids.insert(id.to_owned()) || !artifact.is_deleted {
            return Err("回收站产物标识重复或删除状态无效".into());
        }
    }
    Ok(())
}

fn valid_media_path(path: &str) -> bool {
    let mut parts = path.split('/');
    matches!(parts.next(), Some("media"))
        && matches!(parts.next(), Some("audio" | "image" | "ink"))
        && parts.next().is_some_and(|name| {
            !name.is_empty() && name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
        })
        && parts.next().is_none()
}

fn same_material(mut current: crate::db::RawMaterialDto, mut incoming: crate::db::RawMaterialDto) -> bool {
    // content_hash is derived again from raw_text when the material is saved.
    current.content_hash.clear();
    incoming.content_hash.clear();
    current == incoming
}

pub fn restore(conn: &mut Connection, snapshot: &DeletedRecordsSnapshot) -> Result<DeletedRestoreCounts, String> {
    validate_snapshot(snapshot)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| crate::error_text::explain("打开回收站恢复事务失败", &e))?;

    // Preflight every ID and dependency before inserting any tombstone.
    for record in &snapshot.materials {
        if let Some((current, deleted, deleted_at)) = crate::db::material_for_restore(&tx, &record.material.id)
            .map_err(|e| crate::error_text::explain("读取本地回收站素材失败", &e))? {
            if !deleted || deleted_at != record.deleted_at || !same_material(current, record.material.clone()) {
                return Err("本地同标识素材与备份删除态冲突，未恢复回收站内容".into());
            }
        }
    }
    for record in &snapshot.cards {
        if let Some((current, deleted, deleted_at)) = crate::db::card_for_restore(&tx, &record.card.id)
            .map_err(|e| crate::error_text::explain("读取本地回收站卡片失败", &e))? {
            if !deleted || deleted_at != record.deleted_at || current != record.card {
                return Err("本地同标识卡片与备份删除态冲突，未恢复回收站内容".into());
            }
        }
        if let Some(material_id) = record.card.material_id.as_deref() {
            let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM materials WHERE id=?1)", [material_id], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            if !exists && !snapshot.materials.iter().any(|material| material.material.id == material_id) {
                return Err("回收站卡片引用的来源素材未纳入备份或本机资料库".into());
            }
        }
    }
    for artifact in &snapshot.artifacts {
        if let Some(current) = crate::db::artifact_for_restore(&tx, &artifact.id)
            .map_err(|e| crate::error_text::explain("读取本地回收站产物失败", &e))? {
            if !current.is_deleted || current != *artifact {
                return Err("本地同标识产物与备份删除态冲突，未恢复回收站内容".into());
            }
        }
    }

    let mut counts = DeletedRestoreCounts::new();
    for record in &snapshot.materials {
        let exists = crate::db::material_for_restore(&tx, &record.material.id)
            .map_err(|e| e.to_string())?.is_some();
        if exists {
            counts.already_present += 1;
            continue;
        }
        crate::db::save_material(&tx, &record.material).map_err(|e| crate::error_text::explain("恢复回收站素材失败", &e))?;
        tx.execute("UPDATE materials SET is_deleted=1, deleted_at=?1 WHERE id=?2", rusqlite::params![record.deleted_at, record.material.id])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM fts_materials WHERE material_id=?1", [&record.material.id]).map_err(|e| e.to_string())?;
        counts.materials += 1;
    }
    for record in &snapshot.cards {
        let exists = crate::db::card_for_restore(&tx, &record.card.id)
            .map_err(|e| e.to_string())?.is_some();
        if exists {
            counts.already_present += 1;
            continue;
        }
        crate::db::upsert_card(&tx, &record.card).map_err(|e| crate::error_text::explain("恢复回收站卡片失败", &e))?;
        tx.execute("UPDATE cards SET is_deleted=1, deleted_at=?1 WHERE id=?2", rusqlite::params![record.deleted_at, record.card.id])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM fts_cards WHERE card_id=?1", [&record.card.id]).map_err(|e| e.to_string())?;
        counts.cards += 1;
    }
    for artifact in &snapshot.artifacts {
        let exists = crate::db::artifact_for_restore(&tx, &artifact.id)
            .map_err(|e| e.to_string())?.is_some();
        if exists {
            counts.already_present += 1;
            continue;
        }
        crate::db::save_artifact(&tx, artifact).map_err(|e| crate::error_text::explain("恢复回收站产物失败", &e))?;
        tx.execute("UPDATE artifacts SET is_deleted=1 WHERE id=?1", [&artifact.id]).map_err(|e| e.to_string())?;
        counts.artifacts += 1;
    }
    tx.commit().map_err(|e| crate::error_text::explain("提交回收站恢复失败", &e))?;
    Ok(counts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{ArtifactDto, KnowledgeCardDto, RawMaterialDto};
    use rusqlite::Connection;

    fn database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_tables(&conn).unwrap();
        conn
    }

    fn material(id: &str) -> RawMaterialDto {
        RawMaterialDto {
            id: id.into(), source_type: "manual".into(), title: "已删除素材".into(), source_url: None,
            raw_text: "正文".into(), cleaned_markdown: None, content_hash: crate::db::calculate_hash("正文"),
            media_path: None, media_size_bytes: 0, metadata_json: "{}".into(), inbox_status: "processed".into(),
            created_at: 1, updated_at: 2,
        }
    }

    fn card(id: &str, material_id: Option<&str>) -> KnowledgeCardDto {
        serde_json::from_value(serde_json::json!({
            "id": id, "materialId": material_id, "headline": "删除卡片", "summary": "摘要", "details": "细节",
            "createdAt": 1, "editedAt": null, "reviewCount": 2,
        })).unwrap()
    }

    fn artifact(id: &str) -> ArtifactDto {
        ArtifactDto {
            id: id.into(), artifact_type: "brief".into(), title: "已删除产物".into(), content_markdown: "正文".into(),
            source_card_ids: vec![], source_note_ids: vec![], date_scope_start: None, date_scope_end: None,
            created_at: 1, updated_at: 2, is_deleted: true,
        }
    }

    #[test]
    fn captures_and_restores_deleted_records_without_reviving_them() {
        let source = database();
        crate::db::save_material(&source, &material("m-deleted")).unwrap();
        source.execute("UPDATE materials SET is_deleted=1, deleted_at=9 WHERE id='m-deleted'", []).unwrap();
        crate::db::upsert_card(&source, &card("c-deleted", Some("m-deleted"))).unwrap();
        source.execute("UPDATE cards SET is_deleted=1, deleted_at=10 WHERE id='c-deleted'", []).unwrap();
        crate::db::save_artifact(&source, &artifact("a-deleted")).unwrap();
        source.execute("UPDATE artifacts SET is_deleted=1 WHERE id='a-deleted'", []).unwrap();

        let snapshot = capture(&source).unwrap();
        assert_eq!(snapshot.materials.len(), 1);
        assert_eq!(snapshot.materials[0].deleted_at, Some(9));
        assert_eq!(snapshot.cards.len(), 1);
        assert_eq!(snapshot.cards[0].deleted_at, Some(10));
        assert_eq!(snapshot.artifacts.len(), 1);

        let mut target = database();
        let counts = restore(&mut target, &snapshot).unwrap();
        assert_eq!(counts.materials, 1);
        assert_eq!(counts.cards, 1);
        assert_eq!(counts.artifacts, 1);
        assert_eq!(target.query_row("SELECT is_deleted FROM materials WHERE id='m-deleted'", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        assert_eq!(target.query_row("SELECT deleted_at FROM materials WHERE id='m-deleted'", [], |r| r.get::<_, i64>(0)).unwrap(), 9);
        assert_eq!(target.query_row("SELECT is_deleted FROM cards WHERE id='c-deleted'", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        assert_eq!(target.query_row("SELECT deleted_at FROM cards WHERE id='c-deleted'", [], |r| r.get::<_, i64>(0)).unwrap(), 10);
        assert_eq!(target.query_row("SELECT is_deleted FROM artifacts WHERE id='a-deleted'", [], |r| r.get::<_, i64>(0)).unwrap(), 1);

        let repeated = restore(&mut target, &snapshot).unwrap();
        assert_eq!(repeated.already_present, 3);
        assert_eq!(repeated.materials + repeated.cards + repeated.artifacts, 0);
    }

    #[test]
    fn conflicting_active_record_aborts_the_deleted_batch() {
        let source = database();
        crate::db::save_material(&source, &material("m-deleted")).unwrap();
        source.execute("UPDATE materials SET is_deleted=1, deleted_at=9 WHERE id='m-deleted'", []).unwrap();
        crate::db::save_artifact(&source, &artifact("a-deleted")).unwrap();
        source.execute("UPDATE artifacts SET is_deleted=1 WHERE id='a-deleted'", []).unwrap();
        let snapshot = capture(&source).unwrap();

        let mut target = database();
        crate::db::save_material(&target, &material("m-deleted")).unwrap();
        assert!(restore(&mut target, &snapshot).is_err());
        assert_eq!(target.query_row("SELECT is_deleted FROM materials WHERE id='m-deleted'", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        assert_eq!(target.query_row("SELECT COUNT(*) FROM artifacts WHERE id='a-deleted'", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    }

    #[test]
    fn different_deletion_timestamp_aborts_the_deleted_batch() {
        let source = database();
        crate::db::save_material(&source, &material("m-deleted")).unwrap();
        source.execute("UPDATE materials SET is_deleted=1, deleted_at=9 WHERE id='m-deleted'", []).unwrap();
        crate::db::save_artifact(&source, &artifact("a-deleted")).unwrap();
        source.execute("UPDATE artifacts SET is_deleted=1 WHERE id='a-deleted'", []).unwrap();
        let snapshot = capture(&source).unwrap();

        let mut target = database();
        crate::db::save_material(&target, &material("m-deleted")).unwrap();
        target.execute("UPDATE materials SET is_deleted=1, deleted_at=8 WHERE id='m-deleted'", []).unwrap();
        assert!(restore(&mut target, &snapshot).is_err());
        assert_eq!(target.query_row("SELECT deleted_at FROM materials WHERE id='m-deleted'", [], |r| r.get::<_, i64>(0)).unwrap(), 8);
        assert_eq!(target.query_row("SELECT COUNT(*) FROM artifacts WHERE id='a-deleted'", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    }
}
