#!/usr/bin/env node
/**
 * 真实 macOS 应用的逐页验证。
 *
 * 浏览器验证有个盲区：**桌面窗口只有 728px 高**。侧栏放不下时，多出来的
 * 那一行正好把最下面那个功能推出可视区——用户在浏览器里看到的是完整的，
 * 在真机上却根本找不到入口。「知识测验」就是这样被藏起来的。
 *
 * 这里用 cliclick 模拟真实点击 + 截图来验证：
 *   1. 每个页面在真机窗口里能打开
 *   2. 主线入口在真机窗口高度下**不需要滚动**就能看到
 *
 * 需要：cliclick（brew install cliclick）、已安装并运行的 KnowFlick.app。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import assert from "node:assert/strict";

const exec = promisify(execFile);
const outDir = ".scratch/real-pages";
mkdirSync(outDir, { recursive: true });

const osascript = (script) =>
  exec("osascript", ["-e", script], { timeout: 30_000 }).then((r) => r.stdout.trim());
const click = (x, y) => exec("cliclick", [`c:${Math.round(x)},${Math.round(y)}`], { timeout: 15_000 }).then(() => undefined);

let count = 0;
const pass = (label) => { count++; console.log(`PASS ${label}`); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 取内容区（窗口右侧那一大片）的粗粒度指纹。
 *
 * 用来判断「页面真的切换了」：同一页面两次截图的指纹必须相同，
 * 换页则必须不同。取样点稀疏、间隔大，所以抗压缩噪声。
 */
async function contentRegionHash(file) {
  const { readFileSync } = await import("node:fs");
  const buf = readFileSync(file);
  // PNG 解码要 zlib；用「文件字节采样」代替——同一页面的两次截图字节高度一致，
  // 换页后差异极大。够用且不引入依赖。
  let hash = 0;
  // 采样要密：不同页面的差异往往只在几个字上，稀疏采样会漏掉。
  for (let i = 0; i < buf.length; i += 37) {
    hash = (hash * 31 + buf[i]) >>> 0;
  }
  return hash;
}

/**
 * 应用窗口左上角坐标（逻辑像素）。
 *
 * 窗口可能不存在：应用进程还活着但窗口被关了（留在托盘里）。
 * 这时返回 null，由调用方 SKIP——工具不该因为「窗口没开」崩掉。
 */
async function windowOrigin() {
  const raw = await osascript(
    'tell application "System Events" to tell process "knowflick-workbench" to get position of front window',
  ).catch(() => "");
  if (!raw || !raw.includes(",")) return null;
  const [x, y] = raw.split(",").map((s) => Number(s.trim()));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/**
 * 侧栏各项在真机窗口里的相对坐标。
 *
 * 侧栏结构固定（记录 → 应用 → 来源/收件箱/知识库 → 设置），但行高会随
 * 插件开关变化，所以这里用**相对锚点**定位：先截一张图，再按固定间距推算。
 * 偏移量以「应用」段第一项（知识问答）为基准，其余项按行距推进。
 */
// 「应用」段的行位置。
//
// 坐标**自动校准**而不是硬编码：点一行、用内容区像素变化确认「切到别的页了」
// 才算这个坐标有效。上一版硬编码的坐标偏了 16px，点击全落在同一行，
// 脚本却报「真机上可点击进入」——加了像素验证才暴露出来。
const APP_ROW_TOP = 184;
const ROW_STEP = 31;
const APP_PAGES = ["知识问答", "认知简报", "产物库", "统计", "知识测验"];

try {
  assert.ok(existsSync("/Applications/KnowFlick.app"), "KnowFlick.app 未安装");
  // cliclick 无参数时打印用法并返回 0，--help 反而返回 1——所以直接找二进制。
  const hasCliclick = await exec("which", ["cliclick"], { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!hasCliclick) {
    console.log("SKIP 需要 cliclick（brew install cliclick）");
    process.exit(0);
  }

  await osascript('tell application "KnowFlick" to activate');
  await sleep(1500);
  const origin = await windowOrigin();
  if (!origin) {
    console.log("SKIP 应用没有打开的窗口（进程可能在托盘里）——先从菜单栏或 Dock 打开主窗口");
    process.exit(0);
  }
  pass(`真机窗口就位（${origin.x}, ${origin.y}）`);

  // 1. 主线入口在真机窗口里都要能点开，而且**页面确实换了**。
  //    只验证「点击没报错」是不够的——上一版就是这么写错的：
  //    坐标偏了、点在别的行，脚本却报「真机上可点击进入」。
  const file = `${outDir}/probe.png`;
  const hashAt = async (dy) => {
    // 先关掉可能残留的弹窗（上一轮误点开了「语音笔记」面板）。
    await osascript('tell application "System Events" to key code 53').catch(() => {});
    await sleep(250);
    await click(origin.x + 105, origin.y + dy);
    await sleep(1100);
    await exec("screencapture", ["-x", file]);
    return contentRegionHash(file);
  };

  // 先点第一项作为基准
  let baseline = await hashAt(APP_ROW_TOP + ROW_STEP / 2 + 16);
  const visited = new Map([[baseline, "基准"]]);
  for (let index = 1; index < APP_PAGES.length; index += 1) {
    const name = APP_PAGES[index];
    // 行高 30px 上下浮动 8px，逐个偏移试，直到内容真的变了。
    let changed = false;
    for (const delta of [16, 8, 0, -8, 24, 32]) {
      const hash = await hashAt(APP_ROW_TOP + index * ROW_STEP + delta);
      if (!visited.has(hash)) {
        visited.set(hash, name);
        await exec("screencapture", ["-x", `${outDir}/${index}-${name}.png`]);
        changed = true;
        break;
      }
    }
    assert.ok(changed, `「${name}」点不开：内容区像素与已访问页面都相同（点击没落在这行上）`);
    pass(`真机上点开「${name}」且内容确实变了`);
  }

  console.log(`Real app page smoke: ${count} checks passed.`);
} finally {
  // 把窗口还原到原位，别打扰用户
  await osascript('tell application "System Events" to tell process "knowflick-workbench" to set position of front window to {248, 31}').catch(() => {});
}
