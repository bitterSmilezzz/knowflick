/** 逐请求授权与项目笔记访问。仅调用方完成接入后才约束 MCP 服务。 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const AUDIT_LIMIT = 10_000;
const READ = new Set(["search_knowledge", "search_materials", "get_weekly_briefing", "get_knowledge_stats", "resource_read", "legacy_card_read"]);
const PROJECT = new Set(["search_project_notes", "note_read"]);
const DISCOVERY = new Set(["tools_list", "resources_list"]);
const OPERATIONS = new Set([...READ, ...PROJECT, ...DISCOVERY, "create_flash_card", "add_material", "legacy_card_stage", "legacy_card_stage_attempt"]);

/** 缺失或损坏的设置不能被当成启用。两个 MCP 入口共用同一判定。 */
export function mcpEnabled(libraryDir) {
  try {
    const raw = JSON.parse(readFileSync(join(libraryDir, "settings.json"), "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const plugins = Object.hasOwn(raw, "plugins") ? raw.plugins : raw.raw?.plugins;
    if (plugins !== undefined && (!plugins || typeof plugins !== "object" || Array.isArray(plugins))) return false;
    const setting = plugins?.["official-mcp-server"];
    if (setting !== undefined && (!setting || typeof setting !== "object" || Array.isArray(setting))) return false;
    if (setting && Object.hasOwn(setting, "enabled") && typeof setting.enabled !== "boolean") return false;
    return setting?.enabled !== false;
  } catch { return false; }
}

function denial() {
  const error = new Error("授权无效或无权执行此操作；请在 KnowFlick 设置中检查连接授权。");
  error.code = -32001;
  return error;
}

export function canUse(grant, operation) {
  if (DISCOVERY.has(operation)) return true;
  if (grant.scope === "project") return PROJECT.has(operation);
  if (grant.scope !== "library") return false;
  if (READ.has(operation)) return grant.library_read === 1;
  if (operation === "create_flash_card" || operation === "legacy_card_stage" || operation === "legacy_card_stage_attempt") return grant.card_write === 1;
  if (operation === "add_material") return grant.material_write === 1;
  return false;
}

/** 在同一写事务中核验权限、执行操作及写审计；提交成功前绝不返回结果。 */
export function withMcpGrant(db, token, operation, run, now = Date.now()) {
  if (!OPERATIONS.has(operation)) throw denial();
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) throw denial();
  const hash = createHash("sha256").update(token, "utf8").digest("hex");
  db.exec("BEGIN IMMEDIATE");
  try {
    const grant = db.prepare(`SELECT g.id, g.scope, g.project_id, g.library_read, g.card_write, g.material_write
      FROM mcp_grants g LEFT JOIN projects p ON p.id = g.project_id
      WHERE g.token_hash = ? AND g.revoked_at IS NULL AND g.policy_version = 1
        AND ((g.scope = 'project' AND p.id IS NOT NULL AND p.archived_at IS NULL
              AND g.library_read = 0 AND g.card_write = 0 AND g.material_write = 0)
          OR (g.scope = 'library' AND g.project_id IS NULL))`).get(hash);
    if (!grant) throw denial();
    const allowed = canUse(grant, operation);
    // 不记录输入参数或正文；未知凭据不生成审计条目。
    db.prepare("INSERT INTO mcp_audit (grant_id, occurred_at, operation, outcome) VALUES (?, ?, ?, ?)")
      .run(grant.id, now, operation, allowed ? "allowed" : "denied");
    db.prepare("DELETE FROM mcp_audit WHERE id <= COALESCE((SELECT id FROM mcp_audit ORDER BY id DESC LIMIT 1 OFFSET ?), -1)")
      .run(AUDIT_LIMIT);
    if (!allowed) {
      db.exec("COMMIT");
      throw denial();
    }
    const result = run(grant, db);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    // denied 分支已经提交审计，其他异常须回滚数据和审计。
    try { db.exec("ROLLBACK"); } catch { /* 事务已经结束 */ }
    throw error;
  }
}

/** 成员限制在排序和截断之前进行；以笔记现有正文为准，不使用可能过期的索引。 */
export function searchProjectNotes(db, projectId, query = "", limit = 5) {
  if (typeof query !== "string" || query.length > 500) throw new Error("检索词须为不超过 500 字的文本。");
  const cap = Number.isInteger(limit) ? Math.max(1, Math.min(50, limit)) : 5;
  const tokens = query.trim().split(/\s+/u).filter(Boolean);
  const clauses = tokens.map(() => "instr(lower(n.title || char(10) || n.body_md), lower(?)) > 0");
  const rows = db.prepare(`SELECT n.id, n.title, n.body_md, n.current_revision
    FROM project_members pm JOIN notes n ON n.id = pm.note_id
    WHERE pm.project_id = ? AND n.is_deleted = 0 ${clauses.length ? "AND " + clauses.join(" AND ") : ""}
    ORDER BY n.updated_at DESC, n.id ASC LIMIT ?`).all(projectId, ...tokens, cap);
  return rows.map((row) => ({
    id: row.id, title: row.title, revision: row.current_revision,
    excerpt: row.body_md.slice(0, 500), excerptTruncated: row.body_md.length > 500,
    resourceUri: `knowflick://notes/${encodeURIComponent(row.id)}`,
  }));
}

export function readProjectNote(db, projectId, noteId) {
  const row = db.prepare(`SELECT n.id, n.title, n.body_md, n.current_revision
    FROM project_members pm JOIN notes n ON n.id = pm.note_id
    WHERE pm.project_id = ? AND n.id = ? AND n.is_deleted = 0`).get(projectId, noteId);
  if (!row) return null;
  const max = 100_000;
  return {
    id: row.id, title: row.title, body: row.body_md.slice(0, max), revision: row.current_revision,
    truncated: row.body_md.length > max, resourceUri: `knowflick://notes/${encodeURIComponent(row.id)}`,
  };
}
