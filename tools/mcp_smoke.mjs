#!/usr/bin/env node
/** 无库、无凭据时仍可握手，但不可读写；完整读写由临时库的 mcp_server_smoke 验证。 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";

const dir = mkdtempSync(join(tmpdir(), "kf-mcp-empty-"));
writeFileSync(join(dir, "settings.json"), "{}");
const child = spawn(process.execPath, ["tools/mcp-server.mjs", "--dir", dir], {
  env: { ...process.env, KNOWFLICK_MCP_TOKEN: "", KNOWFLICK_MCP_WRITE: "1" }, stdio: ["pipe", "pipe", "pipe"],
});
child.stderr.resume();
const pending = new Map(); let id = 0;
createInterface({ input: child.stdout }).on("line", line => {
  const message = JSON.parse(line); const p = pending.get(message.id);
  if (p) { clearTimeout(p.timer); pending.delete(message.id); p.resolve(message); }
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id; const timer = setTimeout(() => reject(new Error("MCP 请求超时")), 5000);
  pending.set(n, { resolve, timer }); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
});
try {
  assert.ok((await call("initialize")).result); console.log("PASS MCP 服务器能初始化");
  const read = await call("tools/list");
  assert.ok(read.error, "缺库不能返回工具或泄露数据"); console.log("PASS 缺库时访问失败并提示检查知识库");
  const write = await call("tools/call", { name: "create_flash_card", arguments: { headline: "x", details: "y" } });
  assert.ok(write.error, "旧环境变量不能绕过授权"); console.log("PASS 无凭据的旧写入环境变量不能绕过授权");
  console.log("MCP smoke: 3 checks passed.");
} finally {
  await new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once("exit", resolve); child.stdin.end(); });
  rmSync(dir, { recursive: true, force: true });
}
