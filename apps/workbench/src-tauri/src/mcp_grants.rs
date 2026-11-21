//! 外部连接授权（按连接签发令牌、范围与读写权限）的数据层。
//!
//! 服务端在 `tools/mcp-server.mjs` 的 `withMcpGrant` 里逐请求校验令牌与权限，界面入口见
//! `apps/workbench/src/ui/workspace/McpGrantPanel.tsx`；令牌只显示一次、库里只存摘要。
use rand::{rngs::OsRng, RngCore};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const POLICY_VERSION: i64 = 1;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantRequest {
    pub client_label: String,
    pub scope: String,
    pub project_id: Option<String>,
    pub library_read: bool,
    pub card_write: bool,
    pub material_write: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Grant {
    pub id: String,
    pub client_label: String,
    pub scope: String,
    pub project_id: Option<String>,
    pub library_read: bool,
    pub card_write: bool,
    pub material_write: bool,
    pub created_at: i64,
    pub revoked_at: Option<i64>,
    pub policy_version: i64,
}

/// 明文令牌仅创建时返回，不出现在授权列表或数据库中。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedGrant {
    pub grant: Grant,
    pub token: String,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn token_hash(token: &str) -> String {
    hex(&Sha256::digest(token.as_bytes()))
}

pub fn create(conn: &Connection, request: &GrantRequest, now: i64) -> Result<CreatedGrant, String> {
    let label = request.client_label.trim();
    if label.is_empty() || label.chars().count() > 100 {
        return Err("连接名称须为 1 到 100 个字符".into());
    }
    match request.scope.as_str() {
        "project" if request.project_id.as_deref().is_some_and(|id| !id.trim().is_empty())
            && !request.library_read && !request.card_write && !request.material_write => {}
        "library" if request.project_id.is_none()
            && (request.library_read || request.card_write || request.material_write) => {}
        _ => return Err("授权范围或权限无效：项目只读与全库权限须分别授权".into()),
    }
    let mut secret = [0u8; 32];
    OsRng.try_fill_bytes(&mut secret).map_err(|_| "无法生成安全的授权令牌".to_string())?;
    let token = hex(&secret);
    let id = uuid::Uuid::new_v4().to_string();
    let hash = token_hash(&token);
    let tx = conn.unchecked_transaction().map_err(|e| crate::error_text::explain_text("创建授权失败", &e.to_string()))?;
    if let Some(project_id) = request.project_id.as_deref() {
        let active: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1 AND archived_at IS NULL)",
            params![project_id], |row| row.get(0),
        ).map_err(|e| crate::error_text::explain_text("检查项目失败", &e.to_string()))?;
        if !active { return Err("项目不存在或已封存，不能创建授权".into()); }
    }
    tx.execute(
        "INSERT INTO mcp_grants (id, client_label, scope, project_id, token_hash, library_read, card_write, material_write, created_at, policy_version)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![id, label, request.scope, request.project_id, hash, request.library_read, request.card_write, request.material_write, now, POLICY_VERSION],
    ).map_err(|e| crate::error_text::explain_text("创建授权失败", &e.to_string()))?;
    tx.commit().map_err(|e| crate::error_text::explain_text("保存授权失败", &e.to_string()))?;
    Ok(CreatedGrant {
        grant: Grant {
            id, client_label: label.to_owned(), scope: request.scope.clone(), project_id: request.project_id.clone(),
            library_read: request.library_read, card_write: request.card_write, material_write: request.material_write,
            created_at: now, revoked_at: None, policy_version: POLICY_VERSION,
        }, token,
    })
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Grant>> {
    let mut stmt = conn.prepare(
        "SELECT id, client_label, scope, project_id, library_read, card_write, material_write, created_at, revoked_at, policy_version
         FROM mcp_grants ORDER BY created_at DESC, id ASC",
    )?;
    let rows = stmt.query_map([], |row| Ok(Grant {
        id: row.get(0)?, client_label: row.get(1)?, scope: row.get(2)?, project_id: row.get(3)?,
        library_read: row.get(4)?, card_write: row.get(5)?, material_write: row.get(6)?,
        created_at: row.get(7)?, revoked_at: row.get(8)?, policy_version: row.get(9)?,
    }))?;
    rows.collect()
}

/// 重复撤销不会重写时间；返回 true 表示记录存在（含已撤销）。
pub fn revoke(conn: &Connection, id: &str, now: i64) -> rusqlite::Result<bool> {
    let changed = conn.execute("UPDATE mcp_grants SET revoked_at = COALESCE(revoked_at, ?2) WHERE id = ?1", params![id, now])?;
    Ok(changed > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_tables;

    fn database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_tables(&conn).unwrap();
        conn.execute("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1', '项目', 1, 1)", []).unwrap();
        conn
    }

    fn project_request() -> GrantRequest {
        GrantRequest { client_label: "客户端".into(), scope: "project".into(), project_id: Some("p1".into()),
            library_read: false, card_write: false, material_write: false }
    }

    #[test]
    fn creates_distinct_tokens_but_only_stores_hashes() {
        let conn = database();
        let a = create(&conn, &project_request(), 100).unwrap();
        let b = create(&conn, &project_request(), 101).unwrap();
        assert_eq!(a.token.len(), 64);
        assert_ne!(a.token, b.token);
        let stored: String = conn.query_row("SELECT token_hash FROM mcp_grants WHERE id = ?1", [&a.grant.id], |r| r.get(0)).unwrap();
        assert_eq!(stored, token_hash(&a.token));
        assert_ne!(stored, a.token);
        let json = serde_json::to_string(&list(&conn).unwrap()).unwrap();
        assert!(!json.contains(&a.token));
        assert!(!json.contains(&stored));
    }

    #[test]
    fn project_and_library_permissions_are_explicit_and_separate() {
        let conn = database();
        let mut invalid = project_request();
        invalid.card_write = true;
        assert!(create(&conn, &invalid, 1).is_err());
        invalid.scope = "library".into();
        assert!(create(&conn, &invalid, 1).is_err());
        invalid.project_id = None;
        let created = create(&conn, &invalid, 1).unwrap();
        assert!(created.grant.card_write);
        assert!(!created.grant.library_read);
        invalid.card_write = false;
        assert!(create(&conn, &invalid, 1).is_err());
        conn.execute("UPDATE projects SET archived_at = 2 WHERE id = 'p1'", []).unwrap();
        assert!(create(&conn, &project_request(), 2).is_err());
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn revoke_is_idempotent_and_other_grants_are_unchanged() {
        let conn = database();
        let a = create(&conn, &project_request(), 1).unwrap();
        let b = create(&conn, &project_request(), 2).unwrap();
        assert!(revoke(&conn, &a.grant.id, 10).unwrap());
        assert!(revoke(&conn, &a.grant.id, 20).unwrap());
        assert!(!revoke(&conn, "missing", 20).unwrap());
        let grants = list(&conn).unwrap();
        assert_eq!(grants.iter().find(|g| g.id == a.grant.id).unwrap().revoked_at, Some(10));
        assert_eq!(grants.iter().find(|g| g.id == b.grant.id).unwrap().revoked_at, None);
    }

    #[test]
    fn initializing_an_existing_library_keeps_its_projects_and_grants() {
        let conn = database();
        // 模拟尚未加入授权表的旧库，再重复初始化验证迁移幂等。
        conn.execute("DROP TABLE mcp_grants", []).unwrap();
        init_tables(&conn).unwrap();
        let grant = create(&conn, &project_request(), 1).unwrap();
        init_tables(&conn).unwrap();
        assert_eq!(conn.query_row("SELECT name FROM projects WHERE id='p1'", [], |r| r.get::<_, String>(0)).unwrap(), "项目");
        assert_eq!(list(&conn).unwrap()[0].id, grant.grant.id);
    }

    #[test]
    fn database_rejects_project_grant_with_library_permissions() {
        let conn = database();
        let result = conn.execute(
            "INSERT INTO mcp_grants (id,client_label,scope,project_id,token_hash,card_write,created_at,policy_version) VALUES ('bad','客户端','project','p1','hash',1,1,1)",
            [],
        );
        assert!(result.is_err());
        assert!(list(&conn).unwrap().is_empty());
    }
}
