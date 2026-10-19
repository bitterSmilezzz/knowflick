#!/usr/bin/env node
/**
 * End-to-end check for tools/mcp-server.mjs against a real temporary SQLite library.
 * Creates a throwaway library dir, seeds a card, then drives the MCP server over
 * stdio with real JSON-RPC lines and asserts the responses.
 *
 *   node tools/mcp_server_smoke.mjs
 *
 * Never touches the desktop library under Application Support.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "mcp-server.mjs");
const libraryDir = mkdtempSync(join(tmpdir(), "knowflick-mcp-"));
const dbPath = join(libraryDir, "knowflick.db");

let assertions = 0;
function pass(label) {
  assertions++;
  console.log(`PASS ${label}`);
}

function seed() {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE cards (
      id TEXT PRIMARY KEY, material_id TEXT, category TEXT NOT NULL, headline TEXT NOT NULL,
      summary TEXT NOT NULL, details TEXT NOT NULL, links_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL DEFAULT 'imported',
      seen_at INTEGER, swiped TEXT, is_favorite INTEGER NOT NULL DEFAULT 0, favorited_at INTEGER,
      review_count INTEGER NOT NULL DEFAULT 0, mastery_level INTEGER NOT NULL DEFAULT 0,
      last_reviewed_at INTEGER, repetition INTEGER NOT NULL DEFAULT 0, interval_days REAL NOT NULL DEFAULT 0,
      ease_factor REAL NOT NULL DEFAULT 2.5, stability REAL NOT NULL DEFAULT 0, difficulty REAL NOT NULL DEFAULT 0,
      subject TEXT, branch TEXT, level TEXT, track TEXT, order_key TEXT, prereq_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL, edited_at INTEGER, updated_at INTEGER NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE materials (
      id TEXT PRIMARY KEY, source_type TEXT NOT NULL, title TEXT NOT NULL, source_url TEXT,
      raw_text TEXT NOT NULL, cleaned_markdown TEXT, content_hash TEXT NOT NULL, media_path TEXT,
      media_size_bytes INTEGER DEFAULT 0, metadata_json TEXT NOT NULL DEFAULT '{}',
      inbox_status TEXT NOT NULL DEFAULT 'inbox', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      is_deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE artifacts (
      id TEXT PRIMARY KEY, artifact_type TEXT NOT NULL, title TEXT NOT NULL, content_markdown TEXT NOT NULL,
      source_card_ids TEXT NOT NULL DEFAULT '[]', date_scope_start INTEGER, date_scope_end INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE VIRTUAL TABLE fts_cards USING fts5(
      card_id UNINDEXED, headline, summary, details, category, tags, tokenize = 'unicode61 remove_diacritics 2'
    );
  `);
  const now = Date.now();
  db.prepare(
    `INSERT INTO cards (id, category, headline, summary, details, tags_json, source, is_favorite, review_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'imported', 1, 4, ?, ?)`
  ).run(
    "seed-card-1",
    "计算机",
    "SQLite FTS5 中文检索",
    "分词前置与前缀查询实现毫秒级中文检索",
    "SQLite 内建 FTS5 模块提供全文索引与 BM25 排序。",
    JSON.stringify(["SQLite", "检索"]),
    now,
    now
  );
  db.prepare(
    "INSERT INTO fts_cards (card_id, headline, summary, details, category, tags) VALUES (?, ?, ?, ?, ?, ?)"
  ).run("seed-card-1", "SQLite FTS5 中文检索", "分词前置与前缀查询实现毫秒级中文检索", "SQLite 内建 FTS5 模块提供全文索引与 BM25 排序。", "计算机", "SQLite 检索");
  db.close();
}

function startServer() {
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, KNOWFLICK_LIBRARY_DIR: libraryDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const resolver = pending.get(String(parsed.id));
      if (resolver) {
        pending.delete(String(parsed.id));
        resolver(parsed);
      }
    }
  });
  let nextId = 1;
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(String(id), resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      setTimeout(() => {
        if (pending.has(String(id))) {
          pending.delete(String(id));
          reject(new Error(`MCP 请求超时: ${method}`));
        }
      }, 10000);
    });
  return { child, call };
}

try {
  seed();
  const { child, call } = startServer();

  const init = await call("initialize", {});
  assert.equal(init.result.protocolVersion, "2024-11-05");
  assert.equal(init.result.serverInfo.name, "knowflick-second-brain");
  pass("initialize 握手返回协议版本与服务标识");

  const tools = await call("tools/list", {});
  assert.equal(tools.result.tools.length, 5);
  pass("tools/list 暴露 5 个标准工具");

  const stats = await call("tools/call", { name: "get_knowledge_stats", arguments: {} });
  const statsPayload = JSON.parse(stats.result.content[0].text);
  assert.equal(statsPayload.totalCards, 1);
  assert.equal(statsPayload.favoriteCards, 1);
  assert.equal(statsPayload.categoriesDistribution["计算机"], 1);
  pass("get_knowledge_stats 读取真实 SQLite 统计");

  const search = await call("tools/call", { name: "search_knowledge", arguments: { query: "SQLite", limit: 3 } });
  const searchPayload = JSON.parse(search.result.content[0].text);
  assert.equal(searchPayload.totalFound, 1);
  assert.equal(searchPayload.cards[0].id, "seed-card-1");
  assert.equal(searchPayload.cards[0].isFavorite, true);
  pass("search_knowledge 命中 FTS5 索引中的既有卡片");

  const chinese = await call("tools/call", { name: "search_knowledge", arguments: { query: "检索", limit: 3 } });
  assert.equal(JSON.parse(chinese.result.content[0].text).totalFound, 1);
  pass("search_knowledge 支持中文前缀匹配");

  const created = await call("tools/call", {
    name: "create_flash_card",
    arguments: {
      headline: "外部 Agent 写入的卡片",
      summary: "来自 MCP 客户端",
      details: "通过 stdio JSON-RPC 写入同一 SQLite。",
      category: "AI",
      tags: ["MCP"],
    },
  });
  assert.match(created.result.content[0].text, /知识卡片创建成功/);
  pass("create_flash_card 返回创建成功回执");

  const material = await call("tools/call", {
    name: "add_material",
    arguments: { title: "外部文章", text: "正文内容", source_url: "https://example.com/a" },
  });
  assert.match(material.result.content[0].text, /素材已加入收件箱/);
  pass("add_material 返回入箱回执");

  // 真实落库校验：重新打开 SQLite 确认写入与 FTS 同步
  const verify = new DatabaseSync(dbPath, { readOnly: true });
  const cardCount = verify.prepare("SELECT COUNT(*) AS n FROM cards WHERE is_deleted = 0").get().n;
  const materialCount = verify.prepare("SELECT COUNT(*) AS n FROM materials WHERE is_deleted = 0").get().n;
  const ftsCount = verify.prepare("SELECT COUNT(*) AS n FROM fts_cards").get().n;
  const newCard = verify.prepare("SELECT headline, category FROM cards WHERE category = 'AI'").get();
  const newMaterial = verify.prepare("SELECT inbox_status FROM materials WHERE title = '外部文章'").get();
  verify.close();
  assert.equal(cardCount, 2);
  assert.equal(materialCount, 1);
  assert.equal(ftsCount, 2);
  assert.equal(newCard.headline, "外部 Agent 写入的卡片");
  assert.equal(newMaterial.inbox_status, "inbox");
  pass("写入真实落库：卡片、素材与 FTS 索引同步一致");

  const briefing = await call("tools/call", { name: "get_weekly_briefing", arguments: {} });
  const briefingText = briefing.result.content[0].text;
  assert.match(briefingText, /本周收录聚类/);
  assert.match(briefingText, /关注趋势演变/);
  assert.match(briefingText, /待温故的旧内容/);
  pass("get_weekly_briefing 生成三板块 Markdown 简报");

  const resources = await call("resources/list", {});
  assert.equal(resources.result.resources.length, 3);
  pass("resources/list 暴露卡片、素材与简报资源");

  const readCards = await call("resources/read", { uri: "knowflick://cards" });
  assert.equal(JSON.parse(readCards.result.contents[0].text).length, 2);
  pass("resources/read 可读取卡片集合");

  const unknown = await call("tools/call", { name: "no_such_tool", arguments: {} });
  assert.equal(unknown.error.code, -32601);
  pass("未知工具返回标准 JSON-RPC 错误码");

  child.kill("SIGTERM");
  console.log(`\nMCP server smoke: ${assertions} assertions passed.`);
} finally {
  rmSync(libraryDir, { recursive: true, force: true });
}
