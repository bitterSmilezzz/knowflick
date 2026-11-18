//! Versioned subscription backup. URLs with private parameters are excluded;
//! restored rows are additive and never replace a differing local subscription.
use std::collections::BTreeSet;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupSubscription {
    pub id: String,
    pub r#type: String,
    pub title: String,
    pub target_url: String,
    pub interval_minutes: i64,
    pub last_polled_at: Option<i64>,
    pub is_active: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubscriptionSnapshot {
    pub version: u32,
    pub items: Vec<BackupSubscription>,
    pub excluded_count: usize,
}

fn valid_target(kind: &str, target: &str) -> bool {
    if target.chars().any(char::is_control) || target.len() > 8192 { return false; }
    match kind {
        "rss" | "tech_board" => reqwest::Url::parse(target).is_ok_and(|url|
            matches!(url.scheme(), "http" | "https") && url.username().is_empty() && url.password().is_none() &&
            url.query().is_none() && url.fragment().is_none()),
        "github_release" => {
            let parts: Vec<_> = target.split('/').collect();
            parts.len() == 2 && parts.iter().all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.')))
        }
        "github_trending" => target.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'#' | b'.' | b'-')),
        _ => false,
    }
}

fn validate_row(row: &BackupSubscription) -> Result<(), String> {
    const MAX_SAFE: i64 = 9_007_199_254_740_991;
    if row.id.is_empty() || row.interval_minutes <= 0 || row.interval_minutes > MAX_SAFE ||
        row.created_at.abs_diff(0) > MAX_SAFE as u64 || row.last_polled_at.is_some_and(|v| v.abs_diff(0) > MAX_SAFE as u64) ||
        !valid_target(&row.r#type, &row.target_url) {
        return Err("订阅备份包含无效记录或可能含凭据的地址".into());
    }
    Ok(())
}

pub fn capture(conn: &Connection) -> Result<SubscriptionSnapshot, String> {
    let mut stmt = conn.prepare("SELECT id,type,title,target_url,interval_minutes,last_polled_at,is_active,created_at FROM subscriptions ORDER BY created_at,id")
        .map_err(|e| crate::error_text::explain("读取订阅失败", &e))?;
    let rows = stmt.query_map([], |r| {
        let active: i64 = r.get(6)?;
        if !matches!(active, 0 | 1) { return Err(rusqlite::Error::IntegralValueOutOfRange(6, active)); }
        Ok(BackupSubscription { id: r.get(0)?, r#type: r.get(1)?, title: r.get(2)?, target_url: r.get(3)?,
            interval_minutes: r.get(4)?, last_polled_at: r.get(5)?, is_active: active != 0, created_at: r.get(7)? })
    }).map_err(|e| crate::error_text::explain("读取订阅失败", &e))?;
    let mut snapshot = SubscriptionSnapshot { version: 1, items: Vec::new(), excluded_count: 0 };
    for row in rows {
        let item = row.map_err(|e| crate::error_text::explain("读取订阅失败", &e))?;
        if valid_target(&item.r#type, &item.target_url) {
            validate_row(&item)?;
            snapshot.items.push(item);
        } else {
            snapshot.excluded_count += 1;
        }
    }
    Ok(snapshot)
}

pub fn validate(snapshot: &SubscriptionSnapshot) -> Result<(), String> {
    if snapshot.version != 1 { return Err("不支持的订阅快照版本".into()); }
    let mut ids = BTreeSet::new();
    for row in &snapshot.items {
        validate_row(row)?;
        if !ids.insert(&row.id) { return Err("订阅备份包含重复标识".into()); }
    }
    Ok(())
}

fn existing(conn: &Connection, id: &str) -> rusqlite::Result<Option<BackupSubscription>> {
    conn.query_row("SELECT id,type,title,target_url,interval_minutes,last_polled_at,is_active,created_at FROM subscriptions WHERE id=?1", [id], |r| {
        let active: i64 = r.get(6)?;
        if !matches!(active, 0 | 1) { return Err(rusqlite::Error::IntegralValueOutOfRange(6, active)); }
        Ok(BackupSubscription { id: r.get(0)?, r#type: r.get(1)?, title: r.get(2)?, target_url: r.get(3)?,
            interval_minutes: r.get(4)?, last_polled_at: r.get(5)?, is_active: active != 0, created_at: r.get(7)? })
    }).optional()
}

pub fn validate_destination(conn: &Connection, snapshot: &SubscriptionSnapshot) -> Result<(), String> {
    validate(snapshot)?;
    for row in &snapshot.items {
        if existing(conn, &row.id).map_err(|e| crate::error_text::explain("读取本地订阅失败", &e))?
            .is_some_and(|local| local != *row) {
            return Err("本地存在同标识但内容不同的订阅，未恢复备份".into());
        }
    }
    Ok(())
}

pub fn restore(conn: &mut Connection, snapshot: &SubscriptionSnapshot) -> Result<usize, String> {
    validate(snapshot)?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| crate::error_text::explain("恢复订阅失败", &e))?;
    validate_destination(&tx, snapshot)?;
    let mut inserted = 0;
    for row in &snapshot.items {
        if existing(&tx, &row.id).map_err(|e| crate::error_text::explain("读取本地订阅失败", &e))?.is_some() { continue; }
        tx.execute("INSERT INTO subscriptions(id,type,title,target_url,interval_minutes,last_polled_at,is_active,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            rusqlite::params![row.id,row.r#type,row.title,row.target_url,row.interval_minutes,row.last_polled_at,row.is_active as i64,row.created_at])
            .map_err(|e| crate::error_text::explain("恢复订阅失败", &e))?;
        inserted += 1;
    }
    tx.commit().map_err(|e| crate::error_text::explain("恢复订阅失败", &e))?;
    Ok(inserted)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn database() -> Connection {
        let dir = std::env::temp_dir().join(format!("kf-sub-backup-{}", uuid::Uuid::new_v4()));
        crate::db::open_db(&dir.join("knowflick.db")).unwrap()
    }
    #[test]
    fn roundtrip_keeps_schedule_is_idempotent_and_excludes_private_urls() {
        let source = database();
        source.execute_batch("INSERT INTO subscriptions(id,type,title,target_url,interval_minutes,last_polled_at,is_active,created_at) VALUES
            ('a','rss','公开源','https://example.org/feed.xml',30,123,1,10),
            ('b','github_release','发行','owner/repo',90,NULL,0,11),
            ('secret','rss','带参数','https://example.org/feed?token=PRIVATE-SECRET',30,NULL,1,12);").unwrap();
        let snapshot = capture(&source).unwrap();
        assert_eq!(snapshot.items.len(), 2);
        assert_eq!(snapshot.excluded_count, 1);
        assert!(!serde_json::to_string(&snapshot).unwrap().contains("PRIVATE-SECRET"));
        let mut target = database();
        assert_eq!(restore(&mut target, &snapshot).unwrap(), 2);
        assert_eq!(restore(&mut target, &snapshot).unwrap(), 0);
        assert_eq!(capture(&target).unwrap().items, snapshot.items);
        assert_eq!(target.query_row("SELECT last_polled_at FROM subscriptions WHERE id='a'", [], |r| r.get::<_, i64>(0)).unwrap(), 123);
    }
    #[test]
    fn conflicts_roll_back_all_and_invalid_inputs_fail_closed() {
        let source = database();
        source.execute_batch("INSERT INTO subscriptions(id,type,title,target_url,interval_minutes,is_active,created_at) VALUES
            ('a','rss','甲','https://example.org/a',30,1,10),('b','rss','乙','https://example.org/b',30,1,11);").unwrap();
        let snapshot = capture(&source).unwrap();
        let mut target = database();
        target.execute("INSERT INTO subscriptions(id,type,title,target_url,interval_minutes,is_active,created_at) VALUES('b','rss','不同','https://example.org/b',30,1,11)", []).unwrap();
        assert!(validate_destination(&target, &snapshot).is_err());
        assert!(restore(&mut target, &snapshot).is_err());
        assert_eq!(target.query_row("SELECT COUNT(*) FROM subscriptions", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        let mut bad = snapshot.clone();
        bad.items.push(bad.items[0].clone());
        assert!(validate(&bad).is_err());
        bad.items.pop();
        bad.items[0].target_url = "https://name:password@example.org/".into();
        assert!(validate(&bad).is_err());
        source.execute("UPDATE subscriptions SET is_active=2 WHERE id='a'", []).unwrap();
        assert!(capture(&source).is_err());
    }
}
