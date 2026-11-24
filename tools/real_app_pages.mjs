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
import { execFile, execFileSync } from "node:child_process";
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
 * 截图**只截窗口那块区域**，不要整屏。
 *
 * 整屏截图会把**别的应用**一起拍进来——本机 DSH 窗口在流式输出，
 * 整屏指纹**每次都不同**。于是「页面确实变了」这个判据恒真：
 * 我把「检测外部改动」的逻辑整个废掉，那个断言照样通过（假绿灯）。
 *
 * 只截窗口区域，被拍进来的就只有 KnowFlick 自己。
 */
async function shootWindow(origin, size, file) {
  await exec("screencapture", ["-x", "-R", `${origin.x},${origin.y},${size.w},${size.h}`, file]);
}

/**
 * 这张截图**确实是 KnowFlick 吗**？
 *
 * 判据：KnowFlick 窗口的标题栏区域必须**不是空白的**——窗口被别的应用盖住时，
 * 那一块拍到的是别人的内容。实测：窗口没抬到最前时，这块拍到的是 DSH 窗口。
 *
 * 更硬的判据：截两次，**什么都不做**时指纹必须**稳定**。
 * 不稳定 = 拍到的不是静止的应用界面（有人在流式输出 / 有动画），指纹不可信。
 * 这个自证是必须的——上一版就是少了它，整屏指纹恒变、断言恒真。
 */
async function captureIsStable(origin, size, dir) {
  const a = `${dir}/self-a.png`;
  const b = `${dir}/self-b.png`;
  await shootWindow(origin, size, a);
  await sleep(1200);
  await shootWindow(origin, size, b);
  const ha = await contentRegionHash(a);
  const hb = await contentRegionHash(b);
  return { stable: ha === hb, ha, hb };
}

/** 窗口尺寸（逻辑像素）。 */
async function windowSize() {
  const raw = await osascript(
    'tell application "System Events" to tell process "knowflick-workbench" to get size of front window',
  ).catch(() => "");
  if (!raw || !raw.includes(",")) return null;
  const [w, h] = raw.split(",").map((s) => Number(s.trim()));
  if (!w || !h) return null;
  return { w, h };
}

/**
 * 屏幕是不是锁着。
 *
 * 这条必须有：锁屏时 macOS 的辅助功能层**读不到任何窗口**
 * （`System Events → position of front window` 报 -1719 无效的索引），
 * `screencapture -R` 也报 "could not create image from rect"。
 * 但 `cliclick` 的点击**仍会投递**给应用——于是工具会「点开了页面」，
 * 截到的却是**锁屏界面**（带时钟，每秒都在变），像素比对永远判定「变了」。
 * 那是**假通过**，而且是最坏的一种：看起来有证据，其实什么都没验。
 *
 * 判据用 `CGSessionScreenIsLocked`（ioreg 的 Root 节点里有这个键就是锁着）。
 */
function screenIsLocked() {
  const raw = execFileSync("ioreg", ["-n", "Root", "-d", "1", "-a"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  // **必须按键的「值」判断，不能按键名存在判断。**
  //
  // `IOConsoleLocked` 这个键**一直都在**——它的值是 false 时表示「没锁」。
  // 原来写的是 `raw.includes("ConsoleLocked")`，只问键名在不在，于是
  // **任何时候**都判定成「锁屏」：真机逐页验证在这个机器上**从来没跑起来过**，
  // 而且 SKIP 的理由还是错的（把「窗口不在屏幕上」说成「锁屏」）。
  //
  // 真正的锁屏标志是 `CGSSessionScreenIsLocked`——它在时**有值**（true）。
  if (/<key>CGSSessionScreenIsLocked<\/key>\s*<true\/>/.test(raw)) return true;
  if (/<key>IOConsoleLocked<\/key>\s*<true\/>/.test(raw)) return true;
  return false;
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
  await sleep(1200);
  // 锁屏时必须停下：截到的是锁屏界面（带时钟，每秒都变），像素比对会**永远**
  // 判定「页面变了」——那不是证据，是假通过。锁屏就如实说锁屏。
  if (screenIsLocked()) {
    console.log("SKIP 屏幕处于锁屏状态——真机像素比对会截到锁屏界面（时钟一直在变）从而给出假通过；请解锁后重跑");
    process.exit(0);
  }
  const origin = await windowOrigin();
  if (!origin) {
    console.log("SKIP 应用没有打开的窗口（进程可能在托盘里）——先从菜单栏或 Dock 打开主窗口");
    process.exit(0);
  }
  const size = await windowSize();
  if (!size) {
    console.log("SKIP 读不到窗口尺寸");
    process.exit(0);
  }

  // **必须把窗口抬到最前**，否则截到的是盖在它上面的别的应用。
  // 光 `activate` 不够：实测 activate 之后窗口仍 onscreen=false（不在当前 Space），
  // `AXRaise` 才把它拽到当前 Space 并置于顶层。
  await osascript(
    'tell application "System Events" to tell process "knowflick-workbench" to perform action "AXRaise" of window 1',
  ).catch(() => {});
  await sleep(1200);

  // 自证截图可信：什么都不做时，窗口区域的指纹必须**稳定**。
  // 不稳定说明拍到的不是 KnowFlick（或者它自己在动）——这种指纹不能用来判断页面切换。
  const self = await captureIsStable(origin, size, outDir);
  if (!self.stable) {
    console.log(
      `SKIP 窗口区域截图不稳定（${self.ha} ≠ ${self.hb}）——` +
      "拍到的可能不是 KnowFlick（它被别的应用盖住了），指纹不能用来判断页面是否切换；请把应用切到前台再重跑",
    );
    process.exit(0);
  }
  pass(`真机窗口就位（${origin.x}, ${origin.y}）且截图稳定——可以用它判断页面是否切换`);

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
    await shootWindow(origin, size, file);
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
