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
    CREATE VIRTUAL TABLE fts_materials USING fts5(
      material_id UNINDEXED, title, raw_text, source_url, tokenize = 'unicode61 remove_diacritics 2'
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

  // ── 素材样本：三种索引状态 ──────────────────────────────────────────
  // 1. 已进索引（正常状态）
  // 2. 没进索引（旧库升级后 backfill 只补缺失 id，外部写入也可能没补上）
  // 3. 索引是**旧的**（正文已改写，但 fts 行还是老内容）
  // 4. 已软删除（is_deleted = 1）——不该被检索到
  const insertMaterial = db.prepare(
    `INSERT INTO materials (id, source_type, title, source_url, raw_text, cleaned_markdown, content_hash,
      media_path, media_size_bytes, metadata_json, inbox_status, created_at, updated_at, is_deleted)
     VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, 0, ?, 'inbox', ?, ?, ?)`
  );
  insertMaterial.run(
    "mat-indexed", "email", "发布计划 release status", null,
    "本季度发布计划：release status 需要在九月底前确认。",
    "hash-1", JSON.stringify({ from: "pm@example.com" }), now, now, 0
  );
  db.prepare(
    "INSERT INTO fts_materials (material_id, title, raw_text, source_url) VALUES (?, ?, ?, ?)"
  ).run("mat-indexed", "发布计划 release status", "本季度发布计划：release status 需要在九月底前确认。", "");

  insertMaterial.run(
    "mat-unindexed", "web", "旧索引里的 release status 文档", null,
    "这份文档同样在讲 release status，但从来没有进过全文索引。",
    "hash-2", "{}", now - 1000, now - 1000, 0
  );

  // 4. 两个词都在，但**中间隔着别的字**——「release status」作为整句不出现。
  //    索引缺失时的 LIKE 兜底搜的是整句，于是它会被漏掉；
  //    按「每个词都要出现」判定才找得到。
  insertMaterial.run(
    "mat-split", "note", "发布节奏说明", null,
    "release 的推进节奏取决于 status 看板多久更新一次。",
    "hash-5", "{}", now - 1500, now - 1500, 0
  );

  insertMaterial.run(
    "mat-stale", "note", "已经改写过的笔记", null,
    "现在的正文只讲排期，不再提 release。",
    "hash-3", "{}", now - 2000, now - 2000, 0
  );
  db.prepare(
    "INSERT INTO fts_materials (material_id, title, raw_text, source_url) VALUES (?, ?, ?, ?)"
  ).run("mat-stale", "已经改写过的笔记", "旧版本正文里出现过 release 这个词。", "");

  insertMaterial.run(
    "mat-deleted", "note", "已删除的 release status", null,
    "这条已被用户删除，内容是 release status。",
    "hash-4", "{}", now - 3000, now - 3000, 1
  );
  db.close();
}

function startServer() {
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, KNOWFLICK_LIBRARY_DIR: libraryDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stderr.resume();
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
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
      const timer = setTimeout(() => {
        pending.delete(String(id));
        reject(new Error(`MCP 请求超时: ${method}`));
      }, 10000);
      pending.set(String(id), (response) => { clearTimeout(timer); resolve(response); });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  return { child, call };
}

let server;
try {
  seed();
  server = startServer();
  const { call } = server;

  const init = await call("initialize", {});
  assert.equal(init.result.protocolVersion, "2024-11-05");
  assert.equal(init.result.serverInfo.name, "knowflick-second-brain");
  pass("initialize 握手返回协议版本与服务标识");

  const tools = await call("tools/list", {});
  assert.deepEqual(tools.result.tools.map((tool) => tool.name).sort(), [
    "add_material", "create_flash_card", "get_knowledge_stats", "get_weekly_briefing",
    "search_knowledge", "search_materials",
  ]);
  pass("tools/list 暴露卡片与素材检索工具");

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

  // 外部 Agent 写入的素材，**必须能被搜到**——否则「写入」是条死路：
  // Agent 写完就找不回来，等于没写。
  const materialSearch = await call("tools/call", {
    name: "search_materials",
    arguments: { query: "外部文章", limit: 5 },
  });
  const materialPayload = JSON.parse(materialSearch.result.content[0].text);
  assert.equal(materialPayload.totalFound, 1, `刚写入的素材应能被搜到：${materialSearch.result.content[0].text.slice(0, 200)}`);
  assert.equal(materialPayload.materials[0].title, "外部文章");
  pass("外部 Agent 写入的素材能被 search_materials 搜到");

  // 写入还要同步全文索引——应用里检索走的是 fts_materials，
  // 不补这一条，Agent 写进来的东西在**应用里**就成了搜不到的死条目。
  const ftsMaterial = new DatabaseSync(dbPath, { readOnly: true })
    .prepare("SELECT material_id FROM fts_materials WHERE material_id = ?")
    .get((material.result.content[0].text.match(/ID:\s*([0-9a-f-]+)/) || [])[1]);
  assert.ok(ftsMaterial, "add_material 没有同步 fts_materials 索引");
  pass("add_material 同步素材全文索引（应用里也搜得到）");

  // 索引不全的老库：没进索引的素材**也要能被搜到**。
  // （旧版实现只在 FTS 命中 0 条时才回退，于是「有别的命中」就把它漏了。）
  const partial = await call("tools/call", {
    name: "search_materials",
    arguments: { query: "release status", limit: 10 },
  });
  const partialPayload = JSON.parse(partial.result.content[0].text);
  const ids = partialPayload.materials.map((m) => m.id);
  assert.ok(ids.includes("mat-indexed"), `已索引的素材应命中：${ids.join(",")}`);
  assert.ok(ids.includes("mat-unindexed"), `没进索引的素材也应命中：${ids.join(",")}`);
  // 词不连续也要命中——整句 LIKE 的兜底会漏掉它。
  assert.ok(ids.includes("mat-split"), `词不连续的素材也应命中：${ids.join(",")}`);
  pass("索引不全的老库里，没进索引的素材也能被搜到");

  // 索引是**旧的**时不能报旧内容：正文已改写，命中判定要看当前正文。
  assert.ok(!ids.includes("mat-stale"), `正文已改写的素材不该按旧索引命中：${ids.join(",")}`);
  pass("索引过期时不按旧内容命中");

  // 已删除的素材不该被检索到。
  assert.ok(!ids.includes("mat-deleted"), `已删除的素材不该出现：${ids.join(",")}`);
  pass("已删除的素材不会被检索到");

  // 命中之后要能读到原文——不然搜索结果只是「看起来相关」。
  const hit = partialPayload.materials.find((m) => m.id === "mat-indexed");
  assert.ok(hit.resourceUri, "命中结果应带 resourceUri");
  const readBack = await call("resources/read", { uri: hit.resourceUri });
  const readPayload = JSON.parse(readBack.result.contents[0].text);
  assert.equal(readPayload.id, "mat-indexed");
  assert.ok(readPayload.text.includes("九月底"), `读回的应是全文：${readPayload.text.slice(0, 120)}`);
  assert.equal(readPayload.provenance.from, "pm@example.com", "读回应带出处信息");
  pass("命中结果能按 resourceUri 读到全文与出处");

  // 读一条不存在的素材要给出明确错误，而不是空壳。
  const missingRead = await call("resources/read", { uri: "knowflick://materials/does-not-exist" });
  assert.equal(missingRead.error.code, -32602, "读不存在的素材应报标准错误码");
  pass("读不存在的素材返回标准错误码");

  // 真实落库校验：重新打开 SQLite 确认写入与 FTS 同步
  const verify = new DatabaseSync(dbPath, { readOnly: true });
  const cardCount = verify.prepare("SELECT COUNT(*) AS n FROM cards WHERE is_deleted = 0").get().n;
  const materialCount = verify.prepare("SELECT COUNT(*) AS n FROM materials WHERE is_deleted = 0").get().n;
  const ftsCount = verify.prepare("SELECT COUNT(*) AS n FROM fts_cards").get().n;
  const newCard = verify.prepare("SELECT headline, category FROM cards WHERE category = 'AI'").get();
  const newMaterial = verify.prepare("SELECT inbox_status FROM materials WHERE title = '外部文章'").get();
  verify.close();
  assert.equal(cardCount, 2);
  // 种子里有 5 条未删除素材（mat-indexed / mat-unindexed / mat-split / mat-stale / 外部文章），
  // mat-deleted 是软删除，不计入。
  assert.equal(materialCount, 5);
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
  assert.equal(resources.result.resources.length, 4);
  const uris = resources.result.resources.map((r) => r.uri);
  assert.ok(uris.includes("knowflick://materials/{id}"), "资源清单要暴露单条素材地址");
  pass("resources/list 暴露卡片、素材、简报与单条素材");

  const readCards = await call("resources/read", { uri: "knowflick://cards" });
  assert.equal(JSON.parse(readCards.result.contents[0].text).length, 2);
  pass("resources/read 可读取卡片集合");

  const unknown = await call("tools/call", { name: "no_such_tool", arguments: {} });
  assert.equal(unknown.error.code, -32601);
  pass("未知工具返回标准 JSON-RPC 错误码");

  console.log(`\nMCP server smoke: ${assertions} assertions passed.`);
} finally {
  if (server) {
    const { once } = await import("node:events");
    const exited = once(server.child, "exit");
    server.child.kill("SIGTERM");
    await exited;
  }
  // libraryDir comes from mkdtempSync with this fixed prefix; verify before removal.
  assert.equal(dirname(libraryDir), tmpdir());
  assert.match(libraryDir.split(/[\\/]/).at(-1), /^knowflick-mcp-/);
  rmSync(libraryDir, { recursive: true, force: true });
}
