#!/usr/bin/env node
/**
 * KnowFlick MCP Server (Model Context Protocol)
 *
 * 让 Cursor / Claude Code / DeepSeek Harness 等外部 Agent 把 KnowFlick 当作统一外部记忆库调用。
 * 遵循 PLUGIN_SPECIFICATION.md §6：基于 stdio 的标准 JSON-RPC 2.0 协议。
 *
 * 用法（在外部 Agent 的 mcp 配置里）：
 *   {
 *     "mcpServers": {
 *       "knowflick": { "command": "node", "args": ["<repo>/tools/mcp-server.mjs"] }
 *     }
 *   }
 *
 * 库目录解析顺序：$KNOWFLICK_LIBRARY_DIR → 平台默认 <data_root>/store（含 knowflick.db）。
 * 只读能力（search / stats / briefing）在 SQLite 只读连接上执行；
 * 写能力（create_flash_card / add_material）会真实写入同一 SQLite，Tauri 主窗口收到文件监听后自动刷新。
 */
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const SERVER_NAME = "knowflick-second-brain";
const SERVER_VERSION = "0.1.0";
const PROTOCOL_VERSION = "2024-11-05";

function dataRoot() {
  const env = process.env.KNOWFLICK_DATA_DIR;
  if (env && env.trim()) return env.trim();
  const home = homedir();
  if (process.platform === "darwin") return join(home, "Library/Application Support/KnowFlick");
  if (process.platform === "win32") {
    return join(process.env.APPDATA || join(home, "AppData/Roaming"), "KnowFlick");
  }
  return join(process.env.XDG_DATA_HOME || join(home, ".local/share"), "KnowFlick");
}

function resolveLibraryDir() {
  const explicit = process.env.KNOWFLICK_LIBRARY_DIR;
  if (explicit && explicit.trim()) return explicit.trim();
  return join(dataRoot(), "store");
}

const libraryDir = resolveLibraryDir();
const dbPath = join(libraryDir, "knowflick.db");

function openDb(readonly = true) {
  if (!existsSync(dbPath)) {
    throw new Error(`找不到知识库数据库：${dbPath}（请先启动 KnowFlick 桌面端生成库文件，或用 KNOWFLICK_LIBRARY_DIR 指定库目录）`);
  }
  return new DatabaseSync(dbPath, { readOnly: readonly });
}

function rowToCard(row) {
  let tags = [];
  try {
    tags = JSON.parse(row.tags_json ?? "[]");
  } catch {
    tags = [];
  }
  let links = [];
  try {
    links = JSON.parse(row.links_json ?? "[]");
  } catch {
    links = [];
  }
  return {
    id: row.id,
    headline: row.headline,
    summary: row.summary,
    details: row.details,
    category: row.category,
    tags,
    links,
    source: row.source,
    isFavorite: row.is_favorite === 1,
    reviewCount: row.review_count ?? 0,
    createdAt: row.created_at,
    materialId: row.material_id ?? null,
  };
}

const CARD_COLUMNS = `id, material_id, category, headline, summary, details, links_json, tags_json,
  source, is_favorite, review_count, mastery_level, created_at, edited_at`;

/** 检索：FTS5 前缀查询 + LIKE 兜底，与主程序检索语义保持一致。 */
function searchKnowledge(query, limit) {
  const db = openDb(true);
  try {
    const trimmed = (query || "").trim();
    const cap = Number.isFinite(limit) && limit > 0 ? Math.min(50, Math.floor(limit)) : 5;
    if (!trimmed) {
      const rows = db
        .prepare(`SELECT ${CARD_COLUMNS} FROM cards WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT ?`)
        .all(cap);
      return rows.map(rowToCard);
    }

    const matchQuery = trimmed
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `"${w.replace(/"/g, '""')}"*`)
      .join(" AND ");

    let rows = [];
    try {
      rows = db
        .prepare(
          `SELECT c.id, c.material_id, c.category, c.headline, c.summary, c.details, c.links_json,
                  c.tags_json, c.source, c.is_favorite, c.review_count, c.mastery_level, c.created_at, c.edited_at
           FROM fts_cards f JOIN cards c ON f.card_id = c.id
           WHERE c.is_deleted = 0 AND fts_cards MATCH ?
           ORDER BY bm25(fts_cards) ASC LIMIT ?`
        )
        .all(matchQuery, cap);
    } catch {
      rows = [];
    }

    if (rows.length === 0) {
      const like = `%${trimmed}%`;
      rows = db
        .prepare(
          `SELECT ${CARD_COLUMNS} FROM cards
           WHERE is_deleted = 0 AND (headline LIKE ? OR summary LIKE ? OR details LIKE ? OR category LIKE ?)
           ORDER BY created_at DESC LIMIT ?`
        )
        .all(like, like, like, like, cap);
    }

    return rows.map(rowToCard);
  } finally {
    db.close();
  }
}

function knowledgeStats() {
  const db = openDb(true);
  try {
    const one = (sql) => db.prepare(sql).get();
    const totalCards = one("SELECT COUNT(*) AS n FROM cards WHERE is_deleted = 0").n;
    const favoriteCards = one("SELECT COUNT(*) AS n FROM cards WHERE is_deleted = 0 AND is_favorite = 1").n;
    const totalMaterials = one("SELECT COUNT(*) AS n FROM materials WHERE is_deleted = 0").n;
    const inboxMaterials = one(
      "SELECT COUNT(*) AS n FROM materials WHERE is_deleted = 0 AND inbox_status = 'inbox'"
    ).n;
    const reviewedCards = one("SELECT COUNT(*) AS n FROM cards WHERE is_deleted = 0 AND review_count > 0").n;
    const distribution = db
      .prepare(
        "SELECT category, COUNT(*) AS n FROM cards WHERE is_deleted = 0 GROUP BY category ORDER BY n DESC"
      )
      .all();
    const artifactCount = db.prepare("SELECT COUNT(*) AS n FROM artifacts WHERE is_deleted = 0").get().n;

    return {
      totalCards,
      favoriteCards,
      reviewedCards,
      totalMaterials,
      inboxMaterials,
      artifactCount,
      categoriesDistribution: Object.fromEntries(distribution.map((r) => [r.category, r.n])),
    };
  } finally {
    db.close();
  }
}

/** 周度认知简报：三板块（新收录聚类 / 趋势演变 / 待温故），与主程序口径一致。 */
function weeklyBriefing() {
  const db = openDb(true);
  try {
    const weekMs = 7 * 24 * 3600 * 1000;
    const since = Date.now() - weekMs;
    const recent = db
      .prepare(`SELECT ${CARD_COLUMNS} FROM cards WHERE is_deleted = 0 AND created_at >= ? ORDER BY created_at DESC`)
      .all(since)
      .map(rowToCard);
    const all = db
      .prepare(`SELECT ${CARD_COLUMNS} FROM cards WHERE is_deleted = 0 ORDER BY created_at DESC`)
      .all()
      .map(rowToCard);

    const byCategory = new Map();
    for (const card of recent) {
      byCategory.set(card.category, (byCategory.get(card.category) ?? 0) + 1);
    }
    const clusters = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
    const stale = all
      .filter((c) => c.reviewCount === 0 || Date.now() - (c.createdAt ?? 0) > 30 * 24 * 3600 * 1000)
      .slice(0, 10);

    const lines = [`# KnowFlick 认知简报（截至 ${new Date().toISOString().slice(0, 10)}）`, ""];
    lines.push("## 一、本周收录聚类", "");
    if (clusters.length === 0) lines.push("- 本周暂无新收录内容。", "");
    else {
      for (const [cat, n] of clusters) lines.push(`- **${cat}**：${n} 张`);
      lines.push("");
    }
    lines.push("## 二、关注趋势演变", "");
    const overall = new Map();
    for (const card of all) overall.set(card.category, (overall.get(card.category) ?? 0) + 1);
    const top = [...overall.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (top.length === 0) lines.push("- 知识库为空，暂无趋势。", "");
    else {
      for (const [cat, n] of top) lines.push(`- **${cat}**：累计 ${n} 张（占比 ${((n / all.length) * 100).toFixed(1)}%）`);
      lines.push("");
    }
    lines.push("## 三、待温故的旧内容", "");
    if (stale.length === 0) lines.push("- 暂无待温故内容。", "");
    else {
      for (const card of stale) lines.push(`- ${card.headline}（${card.category}）`);
      lines.push("");
    }
    return lines.join("\n");
  } finally {
    db.close();
  }
}

function saveFlashCard(args) {
  const headline = String(args.headline ?? "").trim();
  const summary = String(args.summary ?? "").trim();
  const details = String(args.details ?? "").trim();
  if (!headline || !details) throw new Error("headline 与 details 为必填项");
  const category = String(args.category ?? "未分类").trim() || "未分类";
  const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
  const now = Date.now();
  const id = randomUUID();

  const db = openDb(false);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.prepare(
      `INSERT INTO cards (id, material_id, category, headline, summary, details, links_json, tags_json,
        source, is_favorite, review_count, mastery_level, repetition, interval_days, ease_factor,
        stability, difficulty, created_at, updated_at, is_deleted)
       VALUES (?, NULL, ?, ?, ?, ?, '[]', ?, 'ai', 0, 0, 0, 0, 0.0, 2.5, 0.0, 0.0, ?, ?, 0)`
    ).run(id, category, headline, summary || headline, details, JSON.stringify(tags), now, now);

    db.prepare(
      "INSERT INTO fts_cards (card_id, headline, summary, details, category, tags) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, headline, summary || headline, details, category, tags.join(" "));
  } finally {
    db.close();
  }
  return { id, headline, category };
}

function addMaterial(args) {
  const title = String(args.title ?? "").trim();
  const text = String(args.text ?? "").trim();
  if (!title || !text) throw new Error("title 与 text 为必填项");
  const sourceUrl = args.source_url ? String(args.source_url).trim() : null;
  const now = Date.now();
  const id = randomUUID();
  const hash = createHash(text);

  const db = openDb(false);
  try {
    db.prepare(
      `INSERT INTO materials (id, source_type, title, source_url, raw_text, cleaned_markdown, content_hash,
        media_path, media_size_bytes, metadata_json, inbox_status, created_at, updated_at, is_deleted)
       VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, 0, '{}', 'inbox', ?, ?, 0)`
    ).run(id, sourceUrl ? "web" : "note", title, sourceUrl, text, hash, now, now);
  } finally {
    db.close();
  }
  return { id, title, inboxStatus: "inbox" };
}

function createHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const TOOLS = [
  {
    name: "search_knowledge",
    description: "在 KnowFlick 第二大脑中检索知识卡片（SQLite FTS5 全文 + 中文前缀匹配）",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索关键词或概念" },
        limit: { type: "number", description: "返回条数上限，默认 5，最大 50" },
      },
      required: ["query"],
    },
  },
  {
    name: "create_flash_card",
    description: "在 KnowFlick 知识库中创建一张原子知识卡（写入 SQLite 并同步全文索引）",
    inputSchema: {
      type: "object",
      properties: {
        headline: { type: "string", description: "卡片标题与核心观点" },
        summary: { type: "string", description: "要点摘要" },
        details: { type: "string", description: "详细正文（Markdown）" },
        category: { type: "string", description: "学科分类" },
        tags: { type: "array", items: { type: "string" }, description: "标签列表" },
      },
      required: ["headline", "details"],
    },
  },
  {
    name: "add_material",
    description: "向 KnowFlick 收件箱追加一份原始素材（文章全文 / 备忘 / 文档文本）",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "素材标题" },
        text: { type: "string", description: "素材正文" },
        source_url: { type: "string", description: "原始链接（如有）" },
      },
      required: ["title", "text"],
    },
  },
  {
    name: "get_weekly_briefing",
    description: "生成 KnowFlick 周度认知简报（本周收录聚类 / 关注趋势 / 待温故内容）",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_knowledge_stats",
    description: "查询 KnowFlick 知识库资产总量、分类分布、收件箱与产物统计",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

function handleToolCall(name, args) {
  switch (name) {
    case "search_knowledge": {
      const cards = searchKnowledge(args.query, args.limit);
      return textResult(
        JSON.stringify({ query: args.query, totalFound: cards.length, cards }, null, 2)
      );
    }
    case "create_flash_card": {
      const created = saveFlashCard(args ?? {});
      return textResult(`知识卡片创建成功！\nID: ${created.id}\n标题: ${created.headline}\n分类: ${created.category}`);
    }
    case "add_material": {
      const created = addMaterial(args ?? {});
      return textResult(`素材已加入收件箱！\nID: ${created.id}\n标题: ${created.title}`);
    }
    case "get_weekly_briefing":
      return textResult(weeklyBriefing());
    case "get_knowledge_stats":
      return textResult(JSON.stringify(knowledgeStats(), null, 2));
    default: {
      const err = new Error(`未知工具: ${name}`);
      err.code = -32601;
      throw err;
    }
  }
}

function dispatch(request) {
  const { method, params = {}, id = null } = request;
  try {
    switch (method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
            capabilities: { tools: {}, resources: {} },
          },
        };
      case "notifications/initialized":
        return null; // 通知无需响应
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
      case "tools/call":
        return { jsonrpc: "2.0", id, result: handleToolCall(params.name, params.arguments ?? {}) };
      case "resources/list":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            resources: [
              { uri: "knowflick://cards", name: "知识卡片集合", mimeType: "application/json" },
              { uri: "knowflick://materials", name: "原始素材集合", mimeType: "application/json" },
              { uri: "knowflick://briefing", name: "周度认知简报", mimeType: "text/markdown" },
            ],
          },
        };
      case "resources/read": {
        const uri = String(params.uri ?? "");
        if (uri === "knowflick://cards") {
          return {
            jsonrpc: "2.0",
            id,
            result: {
              contents: [
                {
                  uri,
                  mimeType: "application/json",
                  text: JSON.stringify(searchKnowledge("", 100), null, 2),
                },
              ],
            },
          };
        }
        if (uri === "knowflick://briefing") {
          return {
            jsonrpc: "2.0",
            id,
            result: { contents: [{ uri, mimeType: "text/markdown", text: weeklyBriefing() }] },
          };
        }
        if (uri === "knowflick://materials") {
          const db = openDb(true);
          let rows = [];
          try {
            rows = db
              .prepare(
                `SELECT id, source_type, title, source_url, inbox_status, created_at
                 FROM materials WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT 100`
              )
              .all();
          } finally {
            db.close();
          }
          return {
            jsonrpc: "2.0",
            id,
            result: { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(rows, null, 2) }] },
          };
        }
        const notFound = new Error(`未知资源: ${uri}`);
        notFound.code = -32602;
        throw notFound;
      }
      default: {
        const err = new Error(`不支持的方法: ${method}`);
        err.code = -32601;
        throw err;
      }
    }
  } catch (error) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: typeof error?.code === "number" ? error.code : -32603,
        message: String(error?.message ?? error),
      },
    };
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request;
  try {
    request = JSON.parse(trimmed);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON 解析失败" } });
    return;
  }
  const response = dispatch(request);
  if (response) send(response);
});
rl.on("close", () => process.exit(0));

process.stderr.write(`[knowflick-mcp] 已启动，库目录: ${libraryDir}\n`);
