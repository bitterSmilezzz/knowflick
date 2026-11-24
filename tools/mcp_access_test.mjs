import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { withMcpGrant, searchProjectNotes, readProjectNote } from "./mcp-access.mjs";

const tokenA = "a".repeat(64), tokenB = "b".repeat(64), tokenLibrary = "c".repeat(64);
const hash = token => createHash("sha256").update(token).digest("hex");
// 使用应用自己的迁移 SQL，确保测试与实际表结构没有各写一份后发生漂移。
// Rust 的 db.rs 已随 ADR-0042 删除；迁移 SQL 逐字移植到 Go 的 schema.go，仍读应用自己那份，避免测试自写表结构漂移。
const dbSource = readFileSync(new URL("../apps/workbench-go/internal/library/schema.go", import.meta.url), "utf8");
function table(name) {
  const match = dbSource.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\([\\s\\S]*?\\n\\s*\\);`));
  assert.ok(match, `缺少迁移表 ${name}`);
  return match[0];
}
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(["projects", "materials", "notes", "project_members", "mcp_grants", "mcp_audit"].map(table).join("\n"));
  db.exec(`INSERT INTO projects(id,name,created_at,updated_at) VALUES ('a','项目 A',1,1), ('b','项目 B',1,1);
    INSERT INTO notes(id,title,body_md,current_revision,is_deleted,created_at,updated_at) VALUES ('a1','A 标题','共同关键词 A 的正文',1,0,1,1), ('b1','B 标题','共同关键词 B 的秘密',1,0,1,100), ('shared','共享','共同关键词',1,0,1,2), ('deleted','删除','共同关键词',1,1,1,3);
    INSERT INTO project_members(project_id,note_id,added_at) VALUES ('a','a1',1),('a','shared',1),('a','deleted',1),('b','b1',1),('b','shared',1);`);
  const add = db.prepare("INSERT INTO mcp_grants (id,client_label,scope,project_id,token_hash,library_read,card_write,material_write,created_at,revoked_at,policy_version) VALUES (?, '测试', ?, ?, ?, ?, ?, ?, 1, NULL, 1)");
  add.run("ga", "project", "a", hash(tokenA), 0, 0, 0);
  add.run("gb", "project", "b", hash(tokenB), 0, 0, 0);
  add.run("gl", "library", null, hash(tokenLibrary), 0, 1, 0);
  return db;
}
const call = (db, token, op, fn = () => "ok") => withMcpGrant(db, token, op, fn, 1000);

test("项目范围在匹配和截断前过滤，单条读取不能越权或看到回收站", () => {
  const db = fixture();
  try {
    const result = call(db, tokenA, "search_project_notes", g => searchProjectNotes(db, g.project_id, "共同关键词", 1));
    assert.deepEqual(result.map(r => r.id), ["shared"]); // B 的更新时间更晚，也不能挤掉 A。
    const all = call(db, tokenA, "search_project_notes", g => searchProjectNotes(db, g.project_id, "", 50));
    assert.deepEqual(all.map(r => r.id), ["shared", "a1"]);
    assert.equal(call(db, tokenA, "note_read", g => readProjectNote(db, g.project_id, "b1")), null);
    assert.equal(call(db, tokenA, "note_read", g => readProjectNote(db, g.project_id, "deleted")), null);
    assert.equal(call(db, tokenB, "note_read", g => readProjectNote(db, g.project_id, "shared")).body, "共同关键词");
    db.prepare("UPDATE notes SET body_md='更新后的原文', current_revision=2 WHERE id='a1'").run();
    assert.equal(call(db, tokenA, "note_read", g => readProjectNote(db, g.project_id, "a1")).body, "更新后的原文");
  } finally { db.close(); }
});

test("撤销、封存、移出和软删除对后续请求立即生效", () => {
  const db = fixture();
  try {
    assert.ok(call(db, tokenA, "note_read", g => readProjectNote(db, g.project_id, "a1")));
    db.prepare("DELETE FROM project_members WHERE project_id='a' AND note_id='a1'").run();
    assert.equal(call(db, tokenA, "note_read", g => readProjectNote(db, g.project_id, "a1")), null);
    db.prepare("UPDATE notes SET is_deleted=1 WHERE id='shared'").run();
    assert.equal(call(db, tokenB, "note_read", g => readProjectNote(db, g.project_id, "shared")), null);
    db.prepare("UPDATE projects SET archived_at=3 WHERE id='a'").run();
    assert.throws(() => call(db, tokenA, "tools_list"), /授权无效/);
    db.prepare("UPDATE mcp_grants SET revoked_at=4 WHERE id='gb'").run();
    assert.throws(() => call(db, tokenB, "tools_list"), /授权无效/);
    assert.equal(call(db, tokenLibrary, "create_flash_card"), "ok");
  } finally { db.close(); }
});

test("权限独立，旧全库读写不能从项目令牌或仅写授权绕过", () => {
  const db = fixture();
  try {
    for (const op of ["search_knowledge", "resource_read", "create_flash_card", "add_material"]) {
      assert.throws(() => call(db, tokenA, op), /无权/);
    }
    assert.throws(() => call(db, tokenLibrary, "search_knowledge"), /无权/);
    assert.throws(() => call(db, tokenLibrary, "add_material"), /无权/);
    assert.equal(call(db, tokenLibrary, "create_flash_card"), "ok");
    for (const t of ["", "A".repeat(64), "f".repeat(64)]) assert.throws(() => call(db, t, "tools_list"), /授权无效/);
    db.prepare("UPDATE mcp_grants SET policy_version=2 WHERE id='gl'").run();
    assert.throws(() => call(db, tokenLibrary, "tools_list"), /授权无效/);
  } finally { db.close(); }
});

test("审计不保存令牌或内容，审计失败时数据修改回滚", () => {
  const db = fixture();
  try {
    call(db, tokenA, "search_project_notes", g => searchProjectNotes(db, g.project_id, "共同关键词"));
    assert.throws(() => call(db, tokenA, "create_flash_card"), /无权/);
    const audit = JSON.stringify(db.prepare("SELECT * FROM mcp_audit").all());
    assert.ok(audit.includes("allowed") && audit.includes("denied"));
    assert.ok(!audit.includes(tokenA) && !audit.includes("共同关键词"));
    const previousAudit = db.prepare("SELECT COUNT(*) AS n FROM mcp_audit").get().n;
    assert.throws(() => call(db, tokenLibrary, "create_flash_card", () => {
      db.prepare("UPDATE notes SET title='不应保存' WHERE id='a1'").run();
      throw new Error("模拟写入失败");
    }), /模拟写入失败/);
    assert.equal(db.prepare("SELECT title FROM notes WHERE id='a1'").get().title, "A 标题");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mcp_audit").get().n, previousAudit);
    db.exec("DROP TABLE mcp_audit");
    assert.throws(() => call(db, tokenLibrary, "create_flash_card", () => db.prepare("UPDATE notes SET title='不应保存' WHERE id='a1'").run()));
    assert.equal(db.prepare("SELECT title FROM notes WHERE id='a1'").get().title, "A 标题");
  } finally { db.close(); }
});

test("超长正文明确截断，查询与返回条数有界", () => {
  const db = fixture();
  try {
    db.prepare("UPDATE notes SET body_md=? WHERE id='a1'").run("长".repeat(100_001));
    const note = call(db, tokenA, "note_read", g => readProjectNote(db, g.project_id, "a1"));
    assert.equal(note.body.length, 100_000);
    assert.equal(note.truncated, true);
    assert.throws(() => call(db, tokenA, "search_project_notes", g => searchProjectNotes(db, g.project_id, "长".repeat(501))), /500/);
    const hits = call(db, tokenA, "search_project_notes", g => searchProjectNotes(db, g.project_id, "", 999));
    assert.ok(hits.length <= 50);
    assert.equal(hits.find(r => r.id === "a1").excerptTruncated, true);
  } finally { db.close(); }
});

test("审计数量超过上限时只保留最新一万条", () => {
  const db = fixture();
  try {
    db.exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<10001)
      INSERT INTO mcp_audit(grant_id,occurred_at,operation,outcome)
      SELECT 'ga',x,'tools_list','allowed' FROM n`);
    call(db, tokenA, "tools_list");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mcp_audit").get().n, 10_000);
    assert.equal(db.prepare("SELECT MIN(id) AS id FROM mcp_audit").get().id, 3);
  } finally { db.close(); }
});
