#!/usr/bin/env node
/**
 * 「外部进程（MCP server）写入 → 桌面端界面自动刷新」的端到端验证。
 *
 * 这个脚本踩过的坑，每一个都写在这里，因为它们都会让断言**假通过**：
 *
 * 1. **不能整屏截图。** 整屏会把别的应用一起拍进来（本机有个浏览器一直抢前台），
 *    它的内容在变 → 指纹每次都不同 → 「内容确实变了」恒真。
 *    所以只截 **KnowFlick 窗口那块区域**。
 * 2. **光「指纹稳定」不够。** 盖住 KnowFlick 的那个应用也可能恰好稳定。
 *    所以还要**确认拍到的确实是 KnowFlick**——看标题栏那三个交通灯（红/黄/绿）。
 * 3. **要让窗口在最前。** 光 `activate` 不够（实测 activate 后窗口仍
 *    `onscreen=false`，它不在当前 Space），要 `AXRaise` 才把它拽过来。
 * 4. **要对着会变的那一页。** MCP 写的是**卡**，而应用默认停在**收件箱**页——
 *    收件箱显示素材，写卡不会让它变一像素。得先切到**卡库页**。
 * 5. **基线必须在写入之前采。** 反过来就等于「已经看到新卡」，恒真。
 * 6. **`swift -e` 只吃单行。** 传多行它会把脚本文本原样打印出来（不是执行结果），
 *    于是永远「找不到窗口」。要写成临时文件再 `swift <file>`。
 *
 * 跑法：node tools/desktop_external_write_smoke.mjs
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { screenShowsKnowFlick } from "./knowflick_window_probe.mjs";

const exec = promisify(execFile);
const libDir = join(homedir(), "Library/Application Support/KnowFlick/store");
const dbPath = join(libDir, "knowflick.db");
const workDir = ".scratch/desktop-write";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let count = 0;
const pass = (label) => { count++; console.log(`PASS ${label}`); };
const skip = (why) => { console.log(`SKIP ${why}`); process.exit(0); };

mkdirSync(workDir, { recursive: true });

if (!existsSync(dbPath)) skip(`找不到应用库：${dbPath}（先启动一次桌面端）`);

// --- 0. 锁屏时必须停下 ---
// 锁屏时 `screencapture` 报 "could not create image from rect"，而点击**仍会投递**
// 给应用——于是工具会「点开了页面」，截到的却是**锁屏界面**（带时钟，每秒都在变），
// 像素比对永远判定「变了」。那是**假通过**。
//
// 判据要按**键的值**看：`IOConsoleLocked` 这个键一直都在（值 false 表示没锁），
// 只看键名存在会永远判成「锁屏」。
const lockRaw = await exec("ioreg", ["-n", "Root", "-d", "1", "-a"], {
  timeout: 60_000, maxBuffer: 64 * 1024 * 1024,
}).then((r) => r.stdout).catch(() => "");
if (/<key>CGSSessionScreenIsLocked<\/key>\s*<true\/>/.test(lockRaw)
  || /<key>IOConsoleLocked<\/key>\s*<true\/>/.test(lockRaw)) {
  skip("屏幕处于锁屏状态——真机像素比对会截到锁屏界面（时钟一直在变）从而给出假通过；请解锁后重跑");
}

// --- 1. 应用在跑吗 ---
try {
  await exec("pgrep", ["-f", "KnowFlick.app/Contents/MacOS/knowflick-workbench"], { timeout: 15_000 });
} catch {
  skip("桌面端没在运行");
}
pass("桌面端在运行");

// --- 2. 把窗口抬到最前 ---
// activate 之后窗口仍可能不在当前 Space（onscreen=false）；AXRaise 才把它拽过来。
await exec("osascript", ["-e", 'tell application "KnowFlick" to activate'], { timeout: 20_000 })
  .catch(() => {});
await sleep(1000);
await exec("osascript", [
  "-e", 'tell application "System Events" to tell process "knowflick-workbench" to perform action "AXRaise" of window 1',
], { timeout: 20_000 }).catch(() => {});
await sleep(1500);

// --- 3. 找窗口位置（用临时 swift 文件；`swift -e` 只吃单行） ---
const swiftScript = `
import CoreGraphics
import Foundation
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
for w in list {
  let owner = (w[kCGWindowOwnerName as String] as? String ?? "").lowercased()
  if owner.contains("knowflick") {
    let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
    let name = (w[kCGWindowName as String] as? String ?? "")
    if name == "KnowFlick" {
      print("FOUND \\(b["X"] ?? 0) \\(b["Y"] ?? 0) \\(b["Width"] ?? 0) \\(b["Height"] ?? 0)")
    }
  }
}`;
const swiftFile = join(workDir, "probe.swift");
writeFileSync(swiftFile, swiftScript, "utf-8");
const probeOut = await exec("swift", [swiftFile], { timeout: 120_000 })
  .then((r) => r.stdout.trim())
  .catch(() => "");
const geomLine = probeOut.split("\n").find((l) => l.startsWith("FOUND "));
if (!geomLine) {
  skip("KnowFlick 的窗口不在屏幕上（别的 Space / 锁屏）——截到的会是别的应用，端到端验不了");
}
const [gx, gy, gw, gh] = geomLine.slice(6).split(" ").map(Number);
pass(`KnowFlick 窗口在屏幕上（${gx}, ${gy}, ${gw}×${gh}）`);

// --- 4. 确认拍到的是 KnowFlick：标题栏要有红黄绿三个交通灯 ---
const marker = await screenShowsKnowFlick(gx, gy, 140, 30, join(workDir, "marker.png"));
if (!marker.isKnowFlick) {
  skip(
    `标题栏没有 KnowFlick 的交通灯（红${marker.red} 黄${marker.yellow} 绿${marker.green}）——` +
    "窗口被别的应用盖住了，截到的不是它",
  );
}
pass("标题栏有 KnowFlick 的交通灯——截到的确实是它");

// --- 5. 切到卡库页（MCP 写的是卡，收件箱页不会变） ---
const winPos = await exec("osascript", [
  "-e", 'tell application "System Events" to tell process "knowflick-workbench" to get position of window 1',
], { timeout: 20_000 }).then((r) => r.stdout.trim()).catch(() => "0, 0");
const [wx, wy] = winPos.split(",").map((n) => Number(n.trim()) || 0);
await exec("cliclick", [`c:${wx + 47},${wy + 382}`], { timeout: 20_000 }).catch(() => {});
await sleep(2000);
await exec("osascript", [
  "-e", 'tell application "System Events" to tell process "knowflick-workbench" to perform action "AXRaise" of window 1',
], { timeout: 20_000 }).catch(() => {});
await sleep(800);

// --- 6. 采基线，并自证指纹稳定 ---
const fingerprint = async () => {
  const out = join(workDir, "f.png");
  await exec("screencapture", ["-x", "-R", `${gx},${gy},${gw},${gh}`, out], { timeout: 90_000 });
  const buf = readFileSync(out);
  let h = 0;
  for (let i = 0; i < buf.length; i += 37) h = (h * 31 + buf[i]) >>> 0;
  return h;
};
const baseline = await fingerprint();
await sleep(1500);
const baseline2 = await fingerprint();
if (baseline !== baseline2) {
  skip(`截图指纹不稳定（${baseline} ≠ ${baseline2}）——界面本身在动，指纹不能用来判断刷新`);
}
pass("已切到卡库页且指纹稳定——卡库页会随新卡出现而变化");

// --- 7. 外部进程写入（基线之后！） ---
const before = new DatabaseSync(dbPath, { readOnly: true });
const countBefore = before.prepare("SELECT COUNT(*) AS n FROM cards WHERE is_deleted = 0").get().n;
before.close();

const headline = `外部写入验证 ${randomUUID().slice(0, 8)}`;
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
assert.ok(out.includes("成功"), `MCP 写入失败：${out.slice(0, 300)}`);
pass("MCP server 写入成功（独立进程，直接写 SQLite）");

const after = new DatabaseSync(dbPath, { readOnly: true });
const countAfter = after.prepare("SELECT COUNT(*) AS n FROM cards WHERE is_deleted = 0").get().n;
const headlines = after.prepare("SELECT headline FROM cards WHERE is_deleted = 0").all().map((r) => r.headline);
after.close();
assert.equal(countAfter, countBefore + 1, "库里应多出一张卡");
assert.ok(headlines.includes(headline), "新卡就在应用正在用的这个库里");
pass("新卡写进了应用正在用的那个库");

// --- 8. 界面应自动刷新（不必用户切页或重启） ---
let refreshed = false;
for (let i = 0; i < 10; i++) {
  await sleep(2000);
  const now = await fingerprint();
  if (now !== baseline) { refreshed = true; break; }
}
assert.ok(refreshed, "外部写入后界面没有自动刷新（10 次轮询内指纹未变）");
pass("外部写入后界面自动刷新（无需切页或重启）");
console.log(`Desktop external write smoke: ${count} checks passed.`);
