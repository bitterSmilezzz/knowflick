//! Immutable per-rating history for R4/D09.
//! Card scheduling state remains the source of the current queue; this ledger
//! preserves individual actions without inventing pre-migration history.

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ReviewRating {
    Again,
    Hard,
    Good,
    Easy,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ReviewAlgorithm {
    Sm2,
    Fsrs,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewEvent {
    pub id: String,
    pub card_id: String,
    pub reviewed_at: i64,
    pub rating: ReviewRating,
    pub algorithm: ReviewAlgorithm,
    pub project_ids: Vec<String>,
    pub project_attribution_complete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewHistorySnapshot {
    pub version: u32,
    pub coverage_started_at: i64,
    pub events: Vec<ReviewEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRestoreCounts {
    pub inserted: usize,
    pub skipped: usize,
}

fn validate_event(event: &ReviewEvent) -> Result<(), String> {
    let parsed = Uuid::parse_str(&event.id).map_err(|_| "复习事件标识无效".to_string())?;
    if parsed.get_version_num() != 4 || parsed.hyphenated().to_string() != event.id {
        return Err("复习事件标识必须是标准 UUID v4".into());
    }
    if event.card_id.is_empty()
        || event.card_id.len() > 256
        || event.card_id.chars().any(char::is_control)
    {
        return Err("复习事件卡片标识无效".into());
    }
    if event.reviewed_at < 0 {
        return Err("复习事件时间无效".into());
    }
    let mut project_ids = BTreeSet::new();
    for id in &event.project_ids {
        let parsed = Uuid::parse_str(id).map_err(|_| "复习事件项目标识无效".to_string())?;
        if parsed.hyphenated().to_string() != *id || !project_ids.insert(id) {
            return Err("复习事件项目标识重复或格式无效".into());
        }
    }
    if event.project_ids.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err("复习事件项目标识顺序无效".into());
    }
    Ok(())
}

pub fn validate(snapshot: &ReviewHistorySnapshot) -> Result<(), String> {
    if snapshot.version != 1 || snapshot.coverage_started_at < 0 {
        return Err("复习历史快照版本或覆盖起点无效".into());
    }
    let mut ids = BTreeSet::new();
    for event in &snapshot.events {
        validate_event(event)?;
        if !ids.insert(event.id.as_str()) {
            return Err("复习历史包含重复事件标识".into());
        }
    }
    Ok(())
}

fn validate_schema(conn: &Connection) -> Result<(), String> {
    let expected = [
        ("event_id", "TEXT", false, 1_i64),
        ("card_id", "TEXT", true, 0),
        ("reviewed_at", "INTEGER", true, 0),
        ("rating", "TEXT", true, 0),
        ("algorithm", "TEXT", true, 0),
        ("project_ids_json", "TEXT", true, 0),
        ("project_attribution_complete", "INTEGER", true, 0),
    ];
    let mut stmt = conn
        .prepare("PRAGMA table_info(review_events)")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)? != 0,
                row.get::<_, i64>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let columns = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    if columns.len() != expected.len()
        || columns.iter().zip(expected).any(|(actual, expected)| {
            actual.0 != expected.0
                || actual.1 != expected.1
                || actual.2 != expected.2
                || actual.3 != expected.3
        })
    {
        return Err("复习事件表结构与备份契约不一致".into());
    }
    Ok(())
}

fn coverage_started_at(conn: &Connection) -> Result<i64, String> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM meta WHERE key='review_history_started_at'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let parsed = value
        .ok_or("复习历史覆盖起点缺失")?
        .parse::<i64>()
        .map_err(|_| "复习历史覆盖起点无效")?;
    if parsed < 0 {
        return Err("复习历史覆盖起点无效".into());
    }
    Ok(parsed)
}

fn read_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReviewEvent> {
    let project_ids_json: String = row.get(5)?;
    let complete: i64 = row.get(6)?;
    Ok(ReviewEvent {
        id: row.get(0)?,
        card_id: row.get(1)?,
        reviewed_at: row.get(2)?,
        rating: serde_json::from_value(serde_json::Value::String(row.get(3)?)).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(e))
        })?,
        algorithm: serde_json::from_value(serde_json::Value::String(row.get(4)?)).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(e))
        })?,
        project_ids: serde_json::from_str(&project_ids_json).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(5, rusqlite::types::Type::Text, Box::new(e))
        })?,
        project_attribution_complete: match complete {
            0 => false,
            1 => true,
            _ => return Err(rusqlite::Error::IntegralValueOutOfRange(6, complete)),
        },
    })
}

fn read_events(
    conn: &Connection,
    from: Option<i64>,
    to: Option<i64>,
) -> Result<Vec<ReviewEvent>, String> {
    let mut stmt = conn.prepare(
        "SELECT event_id,card_id,reviewed_at,rating,algorithm,project_ids_json,project_attribution_complete FROM review_events WHERE (?1 IS NULL OR reviewed_at>=?1) AND (?2 IS NULL OR reviewed_at<=?2) ORDER BY reviewed_at,event_id",
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![from, to], read_event)
        .map_err(|e| e.to_string())?;
    let events = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    for event in &events {
        validate_event(event)?;
    }
    Ok(events)
}

pub fn capture(conn: &Connection) -> Result<ReviewHistorySnapshot, String> {
    validate_schema(conn)?;
    let snapshot = ReviewHistorySnapshot {
        version: 1,
        coverage_started_at: coverage_started_at(conn)?,
        events: read_events(conn, None, None)?,
    };
    validate(&snapshot)?;
    Ok(snapshot)
}

pub fn period(conn: &Connection, from: i64, to: i64) -> Result<ReviewHistorySnapshot, String> {
    if from < 0 || to < from {
        return Err("复习历史查询周期无效".into());
    }
    validate_schema(conn)?;
    let snapshot = ReviewHistorySnapshot {
        version: 1,
        coverage_started_at: coverage_started_at(conn)?,
        events: read_events(conn, Some(from), Some(to))?,
    };
    validate(&snapshot)?;
    Ok(snapshot)
}

fn existing_event(conn: &Connection, id: &str) -> Result<Option<ReviewEvent>, String> {
    conn.query_row(
        "SELECT event_id,card_id,reviewed_at,rating,algorithm,project_ids_json,project_attribution_complete FROM review_events WHERE event_id=?1",
        [id], read_event,
    ).optional().map_err(|e| e.to_string())
}

pub fn validate_destination(
    conn: &Connection,
    snapshot: &ReviewHistorySnapshot,
) -> Result<usize, String> {
    validate(snapshot)?;
    validate_schema(conn)?;
    let mut skipped = 0;
    for event in &snapshot.events {
        match existing_event(conn, &event.id)? {
            Some(local) if local == *event => skipped += 1,
            Some(_) => return Err("本地存在同标识但内容不同的复习事件，未恢复复习历史".into()),
            None => {}
        }
    }
    Ok(skipped)
}

pub fn restore(
    conn: &mut Connection,
    snapshot: &ReviewHistorySnapshot,
) -> Result<ReviewRestoreCounts, String> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let skipped = validate_destination(&tx, snapshot)?;
    let mut inserted = 0;
    for event in &snapshot.events {
        if existing_event(&tx, &event.id)?.is_some() {
            continue;
        }
        let rating = serde_json::to_value(&event.rating)
            .map_err(|_| "复习评分序列化失败".to_string())?
            .as_str()
            .ok_or("复习评分序列化失败")?
            .to_owned();
        let algorithm = serde_json::to_value(&event.algorithm)
            .map_err(|_| "复习算法序列化失败".to_string())?
            .as_str()
            .ok_or("复习算法序列化失败")?
            .to_owned();
        let projects = serde_json::to_string(&event.project_ids)
            .map_err(|_| "复习项目序列化失败".to_string())?;
        tx.execute("INSERT INTO review_events(event_id,card_id,reviewed_at,rating,algorithm,project_ids_json,project_attribution_complete) VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![event.id,event.card_id,event.reviewed_at,rating,algorithm,projects,event.project_attribution_complete as i64])
            .map_err(|e| e.to_string())?;
        inserted += 1;
    }
    let local_start = coverage_started_at(&tx)?;
    let merged_start = local_start.max(snapshot.coverage_started_at);
    tx.execute(
        "UPDATE meta SET value=?1 WHERE key='review_history_started_at'",
        [merged_start.to_string()],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(ReviewRestoreCounts { inserted, skipped })
}

pub fn record_review(
    conn: &mut Connection,
    card: &crate::db::KnowledgeCardDto,
    event: &ReviewEvent,
) -> Result<bool, String> {
    validate_event(event)?;
    if card.id != event.card_id
        || card.review_count < 1
        || card.last_reviewed_at != Some(event.reviewed_at)
    {
        return Err("复习事件与卡片学习状态不一致".into());
    }
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    validate_schema(&tx)?;
    if let Some(local) = existing_event(&tx, &event.id)? {
        if local == *event {
            tx.commit().map_err(|e| e.to_string())?;
            return Ok(false);
        }
        return Err("复习事件标识已被不同内容占用".into());
    }
    let current: Option<(i64, i64)> = tx
        .query_row(
            "SELECT review_count,is_deleted FROM cards WHERE id=?1",
            [&card.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    match current {
        Some((count, 0)) if count == card.review_count - 1 => {}
        Some((_, 0)) => return Err("卡片学习状态已变化，请重新载入后再评分".into()),
        _ => return Err("复习卡片已删除或不存在".into()),
    }
    crate::db::upsert_card_inner(&tx, card).map_err(|e| e.to_string())?;
    let rating = serde_json::to_value(&event.rating)
        .map_err(|_| "复习评分序列化失败".to_string())?
        .as_str()
        .ok_or("复习评分序列化失败")?
        .to_owned();
    let algorithm = serde_json::to_value(&event.algorithm)
        .map_err(|_| "复习算法序列化失败".to_string())?
        .as_str()
        .ok_or("复习算法序列化失败")?
        .to_owned();
    let projects =
        serde_json::to_string(&event.project_ids).map_err(|_| "复习项目序列化失败".to_string())?;
    tx.execute("INSERT INTO review_events(event_id,card_id,reviewed_at,rating,algorithm,project_ids_json,project_attribution_complete) VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![event.id,event.card_id,event.reviewed_at,rating,algorithm,projects,event.project_attribution_complete as i64])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    /// Go 写的复习历史库，Rust 必须读出同一份快照；Go 的快照 JSON 也必须能被 Rust 恢复。
    /// 顺序、项目标识与覆盖起点都要对上——顺序错了就意味着两侧备份不可逐字节比对。
    #[test]
    #[ignore = "requires the fixture exported by Go"]
    fn go_review_history_parity() {
        let db_path = std::env::var("KF_GO_REVIEW_DB").expect("set KF_GO_REVIEW_DB");
        let snapshot_path = format!("{db_path}.snapshot.json");
        let mut conn = rusqlite::Connection::open(&db_path).unwrap();
        let captured = capture(&conn).expect("Rust should read the Go-written history");
        let raw = std::fs::read_to_string(&snapshot_path).unwrap();
        let from_go: ReviewHistorySnapshot = serde_json::from_str(&raw).unwrap();
        assert_eq!(from_go.version, captured.version, "快照版本与 Go 不一致");
        assert_eq!(from_go.coverage_started_at, captured.coverage_started_at, "覆盖起点与 Go 不一致");
        assert_eq!(from_go.events.len(), captured.events.len(), "事件条数与 Go 不一致");
        for (index, (mine, theirs)) in captured.events.iter().zip(from_go.events.iter()).enumerate() {
            assert_eq!(mine, theirs, "第 {index} 条事件与 Go 不一致");
        }
        assert_eq!(from_go.events[0].card_id, "card-b", "顺序错了：最早的一条应排在前面");
        assert_eq!(from_go.events[1].card_id, "card-a", "顺序错了：第二条应排在后面");
        assert_eq!(from_go.events[1].project_ids.len(), 2, "项目标识条数与 Go 不一致");
        assert!(from_go.events[1].project_attribution_complete, "归属完整性与 Go 不一致");

        // 恢复进一个空库：Rust 必须插入全部事件并把覆盖起点对齐。
        let mut dest = rusqlite::Connection::open_in_memory().unwrap();
        dest.execute_batch(
            "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
            INSERT INTO meta VALUES ('review_history_started_at', '10');
            CREATE TABLE review_events (event_id TEXT PRIMARY KEY, card_id TEXT NOT NULL, reviewed_at INTEGER NOT NULL, rating TEXT NOT NULL, algorithm TEXT NOT NULL, project_ids_json TEXT NOT NULL, project_attribution_complete INTEGER NOT NULL);",
        )
        .unwrap();
        let counts = restore(&mut dest, &from_go).expect("Rust should restore the Go snapshot");
        assert_eq!(counts.inserted, 2, "恢复插入条数不对");
        assert_eq!(counts.skipped, 0, "空库不该有跳过");
        let merged: String = dest
            .query_row("SELECT value FROM meta WHERE key='review_history_started_at'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(merged, "1000", "覆盖起点应取两侧最大值，不能被更早的本地值拉回去");

        // 再恢复一次必须幂等：全部跳过、不重复插入。
        let again = restore(&mut dest, &from_go).unwrap();
        assert_eq!(again.inserted, 0, "第二次恢复不该再插入");
        assert_eq!(again.skipped, 2, "第二次恢复应全部跳过");
        let _ = &mut conn;
    }

    use super::*;

    fn event(id: &str) -> ReviewEvent {
        ReviewEvent {
            id: id.into(),
            card_id: "card-1".into(),
            reviewed_at: 200,
            rating: ReviewRating::Good,
            algorithm: ReviewAlgorithm::Fsrs,
            project_ids: vec!["00000000-0000-4000-8000-000000000001".into()],
            project_attribution_complete: true,
        }
    }

    fn database() -> Connection {
        let dir = std::env::temp_dir().join(format!("kf-review-history-{}", Uuid::new_v4()));
        crate::db::open_db(&dir.join("knowflick.db")).unwrap()
    }

    fn card(review_count: i64, last_reviewed_at: Option<i64>) -> crate::db::KnowledgeCardDto {
        serde_json::from_value(serde_json::json!({
            "id": "card-1", "headline": "测试卡", "createdAt": 1_700_000_000_000_i64,
            "reviewCount": review_count, "lastReviewedAt": last_reviewed_at
        }))
        .unwrap()
    }

    #[test]
    fn restore_is_idempotent_and_conflicting_event_rolls_back_batch() {
        let mut target = database();
        let event_id = Uuid::new_v4().to_string();
        let snapshot = ReviewHistorySnapshot {
            version: 1,
            coverage_started_at: 100,
            events: vec![event(&event_id)],
        };
        assert_eq!(
            restore(&mut target, &snapshot).unwrap(),
            ReviewRestoreCounts {
                inserted: 1,
                skipped: 0
            }
        );
        assert_eq!(
            restore(&mut target, &snapshot).unwrap(),
            ReviewRestoreCounts {
                inserted: 0,
                skipped: 1
            }
        );
        let mut conflict = event(&event_id);
        conflict.rating = ReviewRating::Easy;
        let batch = ReviewHistorySnapshot {
            version: 1,
            coverage_started_at: 100,
            events: vec![event(&Uuid::new_v4().to_string()), conflict],
        };
        assert!(restore(&mut target, &batch).unwrap_err().contains("同标识"));
        assert_eq!(
            target
                .query_row("SELECT COUNT(*) FROM review_events", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn restore_keeps_the_later_coverage_boundary() {
        let mut target = database();
        let initial = coverage_started_at(&target).unwrap();
        let snapshot = ReviewHistorySnapshot {
            version: 1,
            coverage_started_at: initial.saturating_sub(1),
            events: vec![],
        };
        restore(&mut target, &snapshot).unwrap();
        assert_eq!(coverage_started_at(&target).unwrap(), initial);
    }

    #[test]
    fn snapshot_rejects_non_v4_ids_and_unsorted_projects() {
        let mut invalid = event("not-a-uuid");
        assert!(validate_event(&invalid).is_err());
        invalid.id = Uuid::new_v4().to_string();
        invalid.project_ids.reverse();
        invalid
            .project_ids
            .push("00000000-0000-4000-8000-000000000000".into());
        assert!(validate_event(&invalid).is_err());
    }

    #[test]
    fn record_review_commits_card_and_event_together_and_retries_by_same_id() {
        let mut conn = database();
        let before = card(0, None);
        crate::db::upsert_card(&conn, &before).unwrap();
        let reviewed_at = 1_700_000_000_200;
        let reviewed = card(1, Some(reviewed_at));
        let event = ReviewEvent {
            reviewed_at,
            ..event(&Uuid::new_v4().to_string())
        };

        assert!(record_review(&mut conn, &reviewed, &event).unwrap());
        assert!(!record_review(&mut conn, &reviewed, &event).unwrap());
        assert_eq!(
            conn.query_row(
                "SELECT review_count FROM cards WHERE id='card-1'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM review_events", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );

        conn.execute_batch("CREATE TRIGGER reject_review BEFORE INSERT ON review_events BEGIN SELECT RAISE(ABORT,'injected failure'); END;").unwrap();
        let next_reviewed_at = reviewed_at + 100;
        let next = card(2, Some(next_reviewed_at));
        let next_event = ReviewEvent {
            id: Uuid::new_v4().to_string(),
            reviewed_at: next_reviewed_at,
            ..event
        };
        assert!(record_review(&mut conn, &next, &next_event).is_err());
        assert_eq!(
            conn.query_row(
                "SELECT review_count FROM cards WHERE id='card-1'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            1,
            "failed event insert must roll back the card schedule update"
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM review_events", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
}
