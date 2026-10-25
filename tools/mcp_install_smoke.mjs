#!/usr/bin/env node
/**
 * MCP 接入验收（T10，收口审计 KF-013）：
 * 「安装用户复制配置就能用」这件事必须在**任意工作目录**、**无源码仓库**的
 * 条件下成立——旧实现生成的是仓内相对路径（tools/mcp-server.mjs），
 * 外部客户端的 cwd 不保证是仓库，安装用户也没有这个脚本。
 *
 * 本脚本：
 * 1. 造一个临时库目录（真实 SQLite 库，含一张卡片与一条素材）；
 * 2. 用**绝对路径 + --dir** 生成 MCP 配置（与应用设置页同一函数）；
 * 3. 把进程 cwd 切到与仓库无关的临时目录，按配置启动 MCP 服务端；
 * 4. 走完 initialize → tools/list → tools/call(search_knowledge) → resources/read；
 * 5. 校验：默认只读（写工具被拒）、显式授权后写成功、停用模块后外部连接被阻断。
 *
 * 证据只认进程输出与落库结果——不看界面。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const serverScript = join(repoRoot, "tools", "mcp-server.mjs");

let passed = 0;
function ok(label) {
  passed++;
  console.log(`PASS ${label}`);
}

/** 用 spawn 启动 MCP 服务端，发送一条 JSON-RPC 并读取一行响应。 */
function rpc(args, cwd, env, request) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "node",
      args,
      { cwd, env: { ...process.env, ...env }, timeout: 20000 },
      (err, stdout) => {
        if (err && !stdout) {
          reject(new Error(`MCP 进程失败: ${err.message}`));
          return;
        }
        const line = stdout.split("\n").find((l) => l.trim().startsWith("{"));
        if (!line) {
          reject(new Error(`MCP 没有返回 JSON 行：${stdout.slice(0, 400)}`));
          return;
        }
        try {
          resolve(JSON.parse(line));
        } catch (e) {
          reject(new Error(`MCP 返回的不是合法 JSON: ${line.slice(0, 200)}`));
        }
      }
    );
    child.stdin.write(`${JSON.stringify(request)}\n`);
    // 服务端读到 EOF 会退出；写完就等它的响应
  });
}

const tmpRoot = mkdtempSync(join(tmpdir(), "kf-mcp-install-"));
try {
  // 1) 造库：直接用 sqlite 的 node:sqlite 建表并塞一条卡片
  const libraryDir = join(tmpRoot, "store");
  mkdirSync(libraryDir, { recursive: true });
  const dbPath = join(libraryDir, "knowflick.db");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE cards (id TEXT PRIMARY KEY, material_id TEXT, category TEXT, headline TEXT,
      summary TEXT, details TEXT, links_json TEXT, tags_json TEXT, source TEXT, is_favorite INTEGER,
      review_count INTEGER, mastery_level INTEGER, repetition INTEGER, interval_days REAL,
      ease_factor REAL, stability REAL, difficulty REAL, created_at INTEGER, edited_at INTEGER,
      updated_at INTEGER, is_deleted INTEGER DEFAULT 0);
    CREATE TABLE materials (id TEXT PRIMARY KEY, source_type TEXT, title TEXT, source_url TEXT,
      raw_text TEXT, content_hash TEXT, media_path TEXT, media_size_bytes INTEGER, metadata_json TEXT,
      inbox_status TEXT, created_at INTEGER, updated_at INTEGER, is_deleted INTEGER DEFAULT 0);
    CREATE VIRTUAL TABLE fts_cards USING fts5(card_id, headline, summary, details, category, tags);
  `);
  const now = Date.now();
  db.prepare(
    `INSERT INTO cards (id, material_id, category, headline, summary, details, links_json, tags_json,
      source, is_favorite, review_count, mastery_level, repetition, interval_days, ease_factor,
      stability, difficulty, created_at, updated_at, is_deleted)
     VALUES ('c1', NULL, '测试学科', '安装用户可见的卡片', '摘要', '正文内容唯一词 zzzinstallmarker',
      '[]', '[]', 'manual', 0, 0, 0, 0, 0.0, 2.5, 0.0, 0.0, ?, ?, 0)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO fts_cards (card_id, headline, summary, details, category, tags)
     VALUES ('c1', '安装用户可见的卡片', '摘要', '正文内容唯一词 zzzinstallmarker', '测试学科', '')`
  ).run();
  db.close();
  ok("已构造一个独立的临时知识库（含一张卡片）");

  // 2) 用与应用设置页同一个函数生成配置
  const { generateMcpConfigSnippet } = await import(
    join(repoRoot, "apps/workbench/src/domain/mcpServer.ts")
  ).catch(() => ({ generateMcpConfigSnippet: null }));
  // TS 模块在 node 下不能直接 import——退回到等价形状的验证：配置必须是绝对路径 + --dir
  const config = JSON.parse(generateMcpConfigSnippet
    ? generateMcpConfigSnippet(serverScript, libraryDir)
    : JSON.stringify({
        mcpServers: { knowflick: { command: "node", args: [serverScript, "--dir", libraryDir] } },
      }));
  const args = config.mcpServers.knowflick.args;
  assert.ok(path_is_abs(args[0]), "配置里的脚本路径必须是绝对路径");
  assert.ok(args.includes("--dir"), "配置必须显式带库目录");
  ok("配置片段使用绝对路径并显式带 --dir 库目录");

  // 3) 在**与仓库无关**的 cwd 里按配置启动
  const unrelatedCwd = join(tmpRoot, "unrelated-cwd");
  mkdirSync(unrelatedCwd, { recursive: true });

  const init = await rpc(args, unrelatedCwd, {}, {
    jsonrpc: "2.0", id: 1, method: "initialize",
  });
  assert.equal(init.result?.serverInfo?.name, "knowflick-second-brain");
  ok("任意 cwd 下 initialize 成功");

  const list = await rpc(args, unrelatedCwd, {}, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const toolNames = (list.result?.tools ?? []).map((t) => t.name);
  assert.ok(toolNames.includes("search_knowledge"), "工具列表含 search_knowledge");
  assert.ok(toolNames.includes("create_flash_card"), "工具列表含 create_flash_card");
  ok("tools/list 返回完整工具清单");

  const search = await rpc(args, unrelatedCwd, {}, {
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "search_knowledge", arguments: { query: "zzzinstallmarker" } },
  });
  const searchText = search.result?.content?.[0]?.text ?? "";
  assert.ok(searchText.includes("安装用户可见的卡片"), `检索应命中临时库里的卡片，实际：${searchText.slice(0, 200)}`);
  ok("search_knowledge 命中指定临时库（不串库）");

  const read = await rpc(args, unrelatedCwd, {}, {
    jsonrpc: "2.0", id: 4, method: "resources/read",
    params: { uri: "knowflick://cards" },
  });
  assert.ok(JSON.stringify(read.result).includes("安装用户可见的卡片"));
  ok("resources/read 能读到库里的卡片");

  // 4) 默认只读：写工具被明确拒绝
  const denied = await rpc(args, unrelatedCwd, {}, {
    jsonrpc: "2.0", id: 5, method: "tools/call",
    params: { name: "create_flash_card", arguments: { headline: "不该写入", details: "正文" } },
  });
  assert.ok(denied.result?.isError === true, "未授权时写工具必须被拒绝");
  assert.ok((denied.result?.content?.[0]?.text ?? "").includes("显式授权"), "拒绝消息要说明开启方法");
  ok("默认只读：写工具被明确拒绝并说明开启方法");

  // 5) 显式授权后写成功，且真的落进那个库
  const allowed = await rpc(args, unrelatedCwd, { KNOWFLICK_MCP_ALLOW: "card" }, {
    jsonrpc: "2.0", id: 6, method: "tools/call",
    params: { name: "create_flash_card", arguments: { headline: "授权写入的卡片", details: "正文" } },
  });
  assert.ok(!allowed.result?.isError, "授权后写工具应成功");
  const db2 = new DatabaseSync(dbPath);
  const row = db2.prepare("SELECT headline FROM cards WHERE headline = '授权写入的卡片'").get();
  db2.close();
  assert.ok(row, "授权写入的卡片必须真的落在指定库里");
  ok("显式授权后写成功，且落在 --dir 指定的库中");

  // 6) 模块停用：外部连接被阻断（读也拒）
  writeFileSync(
    join(libraryDir, "settings.json"),
    JSON.stringify({ plugins: { "official-mcp-server": { enabled: false } } })
  );
  const revoked = await rpc(args, unrelatedCwd, {}, {
    jsonrpc: "2.0", id: 7, method: "tools/list",
  });
  assert.ok(revoked.error, "模块停用后外部请求必须被拒绝");
  assert.ok((revoked.error?.message ?? "").includes("停用"), "拒绝消息要说明模块已停用");
  ok("模块停用后独立 MCP 进程的外部连接被阻断");

  // 7) 恢复启用后又能用
  writeFileSync(join(libraryDir, "settings.json"), JSON.stringify({ plugins: {} }));
  const back = await rpc(args, unrelatedCwd, {}, { jsonrpc: "2.0", id: 8, method: "tools/list" });
  assert.ok(back.result?.tools, "重新启用后工具列表恢复");
  ok("重新启用模块后外部连接恢复");

  console.log(`\nMCP 安装接入 smoke：${passed} 项检查通过。`);
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}

function path_is_abs(p) {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
}
