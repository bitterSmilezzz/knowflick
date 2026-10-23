#!/usr/bin/env node
/**
 * MCP 服务器回归：外部 agent 靠它读写这个知识库。
 *
 * 覆盖两种现实情况：
 * 1. 库里还没有 knowflick.db（应用从没启动过）——必须给出**可执行**的提示，
 *    而不是静默失败或抛栈。
 * 2. 库已存在——写卡 → 统计 → 搜索要能连起来。
 *
 * 第二种需要真实 schema 的库，只在能拿到本机库时跑；CI 上跑第一种。
 */
import { spawn } from "node:child_process";
import { mkdtempSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

let count = 0;
const pass = (label, detail) => {
  count++;
  console.log(`PASS ${label}${detail ? `（${detail}）` : ""}`);
};

/** 起一个 MCP 进程，返回 call() 与 kill()。 */
function startServer(libraryDir) {
  const proc = spawn("node", ["tools/mcp-server.mjs"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, KNOWFLICK_LIBRARY_DIR: libraryDir },
  });
  let buf = "";
  const pending = new Map();
  proc.stdout.on("data", (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      } catch { /* 非 JSON 行忽略 */ }
    }
  });
  proc.stderr.on("data", () => {});
  const call = (id, method, params) => new Promise((resolve) => {
    pending.set(id, resolve);
    proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    setTimeout(() => resolve({ timeout: true }), 10_000);
  });
  return { proc, call, kill: () => proc.kill() };
}

const init = async (call) => {
  const res = await call(1, "initialize", {
    protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "1" },
  });
  assert.ok(res.result, `initialize 失败：${JSON.stringify(res).slice(0, 120)}`);
};

// 1. 没有数据库时：工具照样列得出来，但调用要给可执行提示
{
  const dir = mkdtempSync(join(tmpdir(), "kf-mcp-empty-"));
  const { call, kill } = startServer(dir);
  try {
    await init(call);
    pass("MCP 服务器能初始化");

    const tools = await call(2, "tools/list", {});
    const names = (tools.result?.tools ?? []).map((t) => t.name).sort();
    assert.deepEqual(
      names,
      ["add_material", "create_flash_card", "get_knowledge_stats", "get_weekly_briefing", "search_knowledge"],
      `工具清单不符：${names}`,
    );
    pass("五个工具都在", names.join(", "));

    const created = await call(3, "tools/call", { name: "create_flash_card", arguments: { headline: "x", details: "y" } });
    const text = created.result?.content?.[0]?.text ?? JSON.stringify(created);
    assert.ok(
      /knowflick\.db/.test(text) || /启动 KnowFlick/.test(text),
      `缺库时应给出可执行提示，实际：${text.slice(0, 160)}`,
    );
    pass("缺库时提示可执行（不是静默失败或抛栈）");
  } finally { kill(); }
}

// 2. 有库时：写 → 统计 → 搜索 连起来（需要本机真实库作模板）
const realDb = join(process.env.HOME ?? "", "Library/Application Support/KnowFlick/store/knowflick.db");
if (existsSync(realDb)) {
  const dir = mkdtempSync(join(tmpdir(), "kf-mcp-live-"));
  copyFileSync(realDb, join(dir, "knowflick.db"));
  const { call, kill } = startServer(dir);
  try {
    await init(call);
    const created = await call(2, "tools/call", {
      name: "create_flash_card",
      arguments: { headline: "MCP 回归探针", details: "验证写路径能落到 knowflick.db", category: "测试" },
    });
    const createdText = created.result?.content?.[0]?.text ?? "";
    assert.ok(/创建成功/.test(createdText), `写卡失败：${createdText.slice(0, 160)}`);
    pass("写路径能落库");

    const stats = await call(3, "tools/call", { name: "get_knowledge_stats", arguments: {} });
    const statsText = stats.result?.content?.[0]?.text ?? "";
    assert.ok(/totalCards/.test(statsText) && !/"totalCards": 0/.test(statsText), `统计没跟上：${statsText.slice(0, 160)}`);
    pass("统计能反映刚写入的卡");

    const briefing = await call(5, "tools/call", { name: "get_weekly_briefing", arguments: {} });
    const briefingText = briefing.result?.content?.[0]?.text ?? "";
    assert.ok(/认知简报|简报/.test(briefingText), `简报生成失败：${briefingText.slice(0, 160)}`);
    assert.ok(briefingText.length > 40, "简报内容过短，像是空壳");
    pass("周度简报能生成");

    const search = await call(6, "tools/call", { name: "search_knowledge", arguments: { query: "MCP 回归探针" } });
    const searchText = search.result?.content?.[0]?.text ?? "";
    assert.ok(/MCP 回归探针/.test(searchText), `搜索不到刚写的卡：${searchText.slice(0, 160)}`);
    pass("搜索能找到刚写入的卡");

    // add_material 之前只被查了「工具清单里有没有它」，**从没真调过**。
    // 它答应的是「已加入收件箱」——那就得验它真的进了 materials 表、
    // 状态是 inbox、且应用可见（is_deleted = 0）。
    const mat = await call(7, "tools/call", {
      name: "add_material",
      arguments: { title: "MCP 素材回归探针", text: "验证素材写路径" },
    });
    const matText = mat.result?.content?.[0]?.text ?? JSON.stringify(mat);
    assert.ok(/收件箱/.test(matText), `add_material 没报告入箱：${matText.slice(0, 160)}`);
    const matId = (matText.match(/ID:\s*([0-9a-f-]+)/) || [])[1];
    assert.ok(matId, `add_material 没给出素材 ID：${matText.slice(0, 160)}`);
    const { DatabaseSync } = await import("node:sqlite");
    const check = new DatabaseSync(join(dir, "knowflick.db"), { readOnly: true });
    const row = check
      .prepare("SELECT inbox_status, is_deleted, source_type FROM materials WHERE id = ?")
      .get(matId);
    check.close();
    assert.ok(row, "素材没落进 materials 表");
    assert.equal(row.inbox_status, "inbox", `素材状态不对：${row.inbox_status}`);
    assert.equal(row.is_deleted, 0, "素材被标记删除，应用看不见");
    pass("add_material 真的进了收件箱（应用可见）");
  } finally { kill(); }
} else {
  console.log("SKIP 有库场景（本机没有真实 knowflick.db）");
}

console.log(`MCP smoke: ${count} checks passed.`);
