import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, "apps/workbench/src-tauri/src/db.rs"), "utf8");
function table(name) { const m = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\([\\s\\S]*?\\n\\s*\\);`)); assert.ok(m, name); return m[0]; }
const tokenA = "a".repeat(64), tokenB = "b".repeat(64), tokenAll = "c".repeat(64);
const hash = s => createHash("sha256").update(s).digest("hex");
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "kf-mcp-scoped-"));
  writeFileSync(join(dir, "settings.json"), "{}");
  const db = new DatabaseSync(join(dir, "knowflick.db"));
  db.exec(["projects", "materials", "notes", "project_members", "mcp_grants", "mcp_audit", "cards", "artifacts"].map(table).join("\n"));
  db.exec(`CREATE VIRTUAL TABLE fts_cards USING fts5(card_id, headline, summary, details, category, tags);
    CREATE VIRTUAL TABLE fts_materials USING fts5(material_id, title, raw_text, source_url);
    INSERT INTO projects(id,name,created_at,updated_at) VALUES ('a','A',1,1),('b','B',1,1);
    INSERT INTO notes(id,title,body_md,created_at,updated_at) VALUES ('a1','A 原文','共同词 项目 A 内容',1,1),('b1','B 秘密','共同词 项目 B 内容',1,100);
    INSERT INTO project_members VALUES ('a','a1',1),('b','b1',1);`);
  const add = db.prepare("INSERT INTO mcp_grants (id, client_label, scope, project_id, token_hash, library_read, card_write, material_write, created_at, policy_version) VALUES (?, 'test', ?, ?, ?, ?, ?, ?, 1, 1)");
  add.run("ga", "project", "a", hash(tokenA), 0, 0, 0);
  add.run("gb", "project", "b", hash(tokenB), 0, 0, 0);
  add.run("gl", "library", null, hash(tokenAll), 1, 1, 1);
  return { dir, db };
}
function client(dir, token, extraEnv = {}) {
  const proc = spawn(process.execPath, [join(root, "tools/mcp-server.mjs"), "--dir", dir], { env: { ...process.env, ...extraEnv, KNOWFLICK_MCP_TOKEN: token }, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map(); let sequence = 0;
  createInterface({ input: proc.stdout }).on("line", line => { const item = JSON.parse(line); const p = pending.get(item.id); if (p) { clearTimeout(p.timer); pending.delete(item.id); p.resolve(item); } });
  proc.on("exit", () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error("服务提前退出")); } pending.clear(); });
  return {
    rpc(method, params = {}) { const id = ++sequence; return new Promise((resolve,reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error("请求超时")); }, 5000); pending.set(id,{resolve,reject,timer}); proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); }); },
    close() { return new Promise(resolve => { if (proc.exitCode !== null) return resolve(); proc.once("exit", resolve); proc.stdin.end(); }); },
  };
}

test("实际 stdio 长连接隔离项目，并在撤销或封存后拒绝后续请求", async () => {
  const { dir, db } = setup(); const a = client(dir, tokenA, { KNOWFLICK_MCP_WRITE: "1" }); const b = client(dir, tokenB);
  try {
    assert.equal((await a.rpc("initialize")).result.serverInfo.name, "knowflick-second-brain");
    assert.deepEqual((await a.rpc("tools/list")).result.tools.map(x => x.name), ["search_project_notes"]);
    const result = await a.rpc("tools/call", { name: "search_project_notes", arguments: { query: "共同词", limit: 1 } });
    const notes = JSON.parse(result.result.content[0].text).notes;
    assert.deepEqual(notes.map(x => x.id), ["a1"]);
    assert.ok((await a.rpc("resources/read", { uri: "knowflick://notes/b1" })).error);
    assert.ok((await a.rpc("tools/call", { name: "create_flash_card", arguments: { headline: "不应写入", details: "x" } })).error);
    assert.ok((await a.rpc("resources/read", { uri: "knowflick://cards" })).error);
    assert.ok((await b.rpc("resources/read", { uri: "knowflick://notes/b1" })).result);
    db.prepare("UPDATE mcp_grants SET revoked_at=2 WHERE id='ga'").run();
    assert.ok((await a.rpc("tools/list")).error);
    assert.ok((await b.rpc("tools/list")).result);
    db.prepare("UPDATE projects SET archived_at=2 WHERE id='b'").run();
    assert.ok((await b.rpc("tools/list")).error);
    const audit = JSON.stringify(db.prepare("SELECT * FROM mcp_audit").all());
    assert.ok(!audit.includes(tokenA) && !audit.includes("共同词"));
  } finally { await a.close(); await b.close(); db.close(); rmSync(dir,{recursive:true,force:true}); }
});

test("全库权限独立迁移旧工具，拒绝无令牌及损坏设置", async () => {
  const { dir, db } = setup(); const all = client(dir, tokenAll); const missing = client(dir, "", { KNOWFLICK_MCP_WRITE: "1" });
  try {
    assert.ok((await missing.rpc("tools/list")).error);
    assert.ok((await all.rpc("tools/call", { name: "create_flash_card", arguments: { headline: "新卡", details: "正文" } })).result);
    assert.ok((await all.rpc("tools/call", { name: "add_material", arguments: { title: "新素材", text: "内容" } })).result);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM cards WHERE headline='新卡'").get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM materials WHERE title='新素材'").get().n, 1);
    assert.ok((await all.rpc("resources/read", { uri: "knowflick://cards" })).result);
    writeFileSync(join(dir,"settings.json"), "坏设置");
    assert.ok((await all.rpc("tools/list")).error);
    writeFileSync(join(dir,"settings.json"), JSON.stringify({ plugins: { "official-mcp-server": { enabled: "false" } } }));
    assert.ok((await all.rpc("tools/list")).error, "无效模块状态必须拒绝");
    for (const invalid of [{ plugins: null }, { plugins: { "official-mcp-server": null } }, { plugins: { "official-mcp-server": { enabled: null } } }]) {
      writeFileSync(join(dir,"settings.json"), JSON.stringify(invalid));
      assert.ok((await all.rpc("tools/list")).error, "空值设置不能被误当作启用");
    }
    writeFileSync(join(dir,"settings.json"), JSON.stringify({ plugins: { "official-mcp-server": { enabled: false } } }));
    assert.ok((await all.rpc("tools/list")).error);
  } finally { await all.close(); await missing.close(); db.close(); rmSync(dir,{recursive:true,force:true}); }
});
