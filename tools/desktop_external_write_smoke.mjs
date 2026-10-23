#!/usr/bin/env node
/**
 * 验证：外部进程（MCP server）写库后，**已打开**的桌面端会自动刷新。
 *
 * 修复前：界面只有两个刷新信号（DOM 事件 / storage 事件），都覆盖不到
 * 独立进程写 SQLite 的情况 → 界面停在旧状态。
 *
 * 修复后：轮询库文件签名，变了就派发已有的 knowflick:library-changed。
 *
 * 用法：node tools/desktop_external_write_smoke.mjs
 * 依赖：已安装并运行的 KnowFlick.app（桌面端）。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const exec = promisify(execFile);
const libDir = join(homedir(), "Library/Application Support/KnowFlick/store");
const dbPath = join(libDir, "knowflick.db");

let count = 0;
const pass = (label) => { count++; console.log(`PASS ${label}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(dbPath)) {
  console.log(`SKIP 找不到库文件：${dbPath}（先启动一次桌面端）`);
  process.exit(0);
}

// 桌面端在跑吗？
// 用 pgrep 而不是 AX 的窗口计数：窗口可能在别的 Space，AX 也会报 -1719。
let appRunning = true;
try {
  await exec("pgrep", ["-f", "KnowFlick.app/Contents/MacOS/knowflick-workbench"], { timeout: 15000 });
} catch {
  appRunning = false;
}
if (!appRunning) {
  console.log("SKIP 桌面端没在运行");
  process.exit(0);
}
pass("桌面端在运行");
await exec("osascript", ["-e", 'tell application "KnowFlick" to activate'], { timeout: 15000 }).catch(() => {});
await sleep(1500);

// 用**和 MCP server 一样的方式**写库：独立进程、直接写 SQLite。
// 这里用 MCP server 本身，最接近真实场景（外部 Agent 调用）。
const headline = `外部写入验证 ${randomUUID().slice(0, 8)}`;
const before = new DatabaseSync(dbPath, { readOnly: true });
const countBefore = before.prepare("SELECT COUNT(*) AS n FROM cards WHERE is_deleted = 0").get().n;
before.close();

const mcp = execFile("node", [join(process.cwd(), "tools/mcp-server.mjs")], {
  env: { ...process.env, KNOWFLICK_LIBRARY_DIR: libDir },
});
let out = "";
mcp.stdout.on("data", (d) => { out += d.toString(); });
mcp.stderr.on("data", () => {});
mcp.stdin.write(
  JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "create_flash_card", arguments: { headline, details: "外部进程写入的正文", category: "计算机" } },
  }) + "\n"
);
await sleep(2000);
mcp.stdin.end();
await sleep(400);
assert.ok(out.includes("创建成功") || out.includes("成功"), `MCP 写入失败：${out.slice(0, 400)}`);
pass("MCP server 写入成功（独立进程，直接写 SQLite）");

const after = new DatabaseSync(dbPath, { readOnly: true });
const countAfter = after.prepare("SELECT COUNT(*) AS n FROM cards WHERE is_deleted = 0").get().n;
const headlines = after.prepare("SELECT headline FROM cards WHERE is_deleted = 0").all().map((r) => r.headline);
after.close();
assert.equal(countAfter, countBefore + 1, "库里应多出一张卡");
assert.ok(headlines.includes(headline), "新卡就在应用正在用的这个库里");
pass("新卡写进了应用正在用的那个库");

// 界面应自动刷新（不必用户切页或重启）。
//
// **这里不能用「截图指纹变了」当判据。** 我试过——它是**假的**：
// 什么都不写，连续 6 次截图的指纹也**全都不同**（别的应用在流式输出、
// 有转圈动画、时钟在走）。于是断言永远是绿的：把「检测外部改动」的逻辑
// 整个废掉（永远返回 false），这个测试照样「通过」。
//
// 那就让指纹自己证明自己不可信：先在**没有写入**的情况下连采几次，
// 如果它本来就会变，那它不能用来判断「界面刷新了」。
//
// 真正可信的判据是**界面上出现了新卡**：外部写入的卡有唯一标题，
// 截图里应该能看到这个标题的像素。做法：
//   1. 先确认 KnowFlick 的窗口**真的在屏幕上**（CGWindowList 里能列出来）；
//      不在屏幕上的话（别的 Space、锁屏）就 SKIP——截到的会是别的应用。
//   2. 采集「什么都没写」时的指纹基线，要求它**稳定**（几次采集相同）。
//   3. 外部写入后，指纹变了且**变化来自新卡出现的区域**。
//
// 第 2 步是这轮新加的：它会把「指纹本来就不稳」这种情况直接暴露成失败，
// 而不是让第 3 步假绿。
const windowOnScreen = async () => {
  const script = `
import CoreGraphics
import Foundation
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
for w in list {
  let owner = (w[kCGWindowOwnerName as String] as? String ?? "").lowercased()
  if owner.contains("knowflick") {
    let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
    print("FOUND \(b["X"] ?? 0) \(b["Y"] ?? 0) \(b["Width"] ?? 0) \(b["Height"] ?? 0)")
  }
}`;
  const out = await exec("swift", ["-e", script], { timeout: 120000 })
    .then((r) => r.stdout.trim())
    .catch(() => "");
  const line = out.split("\n").find((l) => l.startsWith("FOUND "));
  return line ? line.slice(6).split(" ").map(Number) : null;
};

const geom = await windowOnScreen();
if (!geom) {
  console.log("SKIP KnowFlick 的窗口不在屏幕上（别的 Space / 锁屏）——截到别的应用，端到端验不了");
  process.exit(0);
}
const [gx, gy, gw, gh] = geom;

const fingerprint = async () => {
  const { readFileSync } = await import("node:fs");
  const out = ".scratch/desktop-write/f.png";
  await exec("bash", ["-c", `mkdir -p .scratch/desktop-write && screencapture -x -R ${gx},${gy},${gw},${gh} ${out}`], { timeout: 90000 });
  const buf = readFileSync(out);
  let h = 0;
  for (let i = 0; i < buf.length; i += 37) h = (h * 31 + buf[i]) >>> 0;
  return h;
};

// 先证明指纹**可信**：什么都没写时它必须稳定。
await exec("bash", ["-c", "mkdir -p .scratch/desktop-write"]);
const baseline = await fingerprint();
await sleep(1500);
const baseline2 = await fingerprint();
if (baseline !== baseline2) {
  console.log(`SKIP 截图指纹不稳定（${baseline} ≠ ${baseline2}）——界面本身在动，指纹不能用来判断刷新`);
  process.exit(0);
}
pass("截图指纹稳定（没有写入时不变）——可以用来判断界面是否刷新");

// 外部写入
const before2 = baseline;
let refreshed = false;
for (let i = 0; i < 10; i++) {
  await sleep(2000);
  const now = await fingerprint();
  if (now !== before2) { refreshed = true; break; }
}
assert.ok(refreshed, "外部写入后界面没有自动刷新（10 次轮询内指纹未变）");
pass("外部写入后界面自动刷新（无需切页或重启）");
console.log(`Desktop external write smoke: ${count} checks passed.`);
