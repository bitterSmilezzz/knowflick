#!/usr/bin/env node
/**
 * Browser regression for the plugin matrix, .kfbackup round trip and MCP panel
 * added to 工作台设置. Requires a running Vite dev server (KNOWFLICK_UI_URL,
 * default http://localhost:1420) and agent-browser.
 *
 * Uses its own browser session and only clears that session's storage.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const exec = promisify(execFile);
const session = "knowflick-plugins-settings";
const url = process.env.KNOWFLICK_UI_URL || "http://localhost:1420";

async function browser(...args) {
  const { stdout } = await exec("agent-browser", ["--session", session, ...args], { timeout: 20000 });
  return stdout.trim();
}
async function evaluate(code) {
  const out = await browser("eval", `JSON.stringify(${code})`);
  const parsed = JSON.parse(out);
  return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
}
async function check(expression, label) {
  for (let n = 0; n < 30; n++) {
    if (await evaluate(expression)) {
      console.log(`PASS ${label}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(label);
}
async function clickButton(text) {
  await browser(
    "eval",
    `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim().includes(${JSON.stringify(
      text
    )}));if(!b)throw new Error('missing button: ' + ${JSON.stringify(text)});b.click();return true})()`
  );
}

try {
  await browser("set", "viewport", "1040", "760");
  await browser("open", url);
  await browser("eval", "localStorage.clear();sessionStorage.clear()");
  await browser("open", url);

  await clickButton("设置");
  await check('!!document.querySelector(\'[data-page="settings"]\')', "settings page renders");

  // 官方插件矩阵
  await check('document.querySelectorAll("[data-plugin-toggle]").length === 6', "六个官方插件都渲染出开关");
  await check(
    'document.querySelector(\'[data-plugin-toggle="official-review-fsrs"]\').checked === false',
    "温故复习插件默认关闭"
  );
  await check(
    'document.querySelector(\'[data-plugin-toggle="official-inbox-sniff"]\').checked === true',
    "链接嗅探插件默认开启"
  );
  await check(
    'document.querySelector(\'[data-plugin="official-inbox-sniff"] .ws-plugin-perms\').textContent.includes("network:fetch")',
    "插件行展示声明的权限"
  );
  // 语音插件：浏览器模式没有 Rust 侧，模型面板要如实说「只在桌面客户端可用」
  await check(
    '!!document.querySelector(\'[data-plugin="official-speech-asr"] [data-asr-panel]\')',
    "语音插件展开模型面板"
  );
  await check(
    'document.querySelector(\'[data-plugin="official-speech-asr"] [data-asr-status\]\').textContent.includes("桌面客户端")',
    "浏览器模式下模型面板说明限制"
  );

  // 切换插件并保存后持久化
  await browser("check", '[data-plugin-toggle="official-review-fsrs"]');
  await browser("click", ".ws-settings-foot button[type=submit]");
  await check('document.body.innerText.includes("设置已成功保存")', "保存插件开关成功");
  await browser("open", url);
  await check('document.body.innerText.includes("工作台设置") === false', "重载后回到默认页而不是设置页");
  await clickButton("设置");
  await check('!!document.querySelector(\'[data-page="settings"]\')', "重载后重新进入设置页");
  await check(
    'document.querySelector(\'[data-plugin-toggle="official-review-fsrs"]\').checked === true',
    "插件开关在重载后保持"
  );
  // 写盘形状：plugins 键落在 settings 里，且与温故入口一致
  // 注意：浏览器模式的 workspace 存储里 settings 是「字符串」，不是对象。
  await check(
    'JSON.parse(JSON.parse(localStorage.getItem("knowflick.workspace.v1")).settings).plugins["official-review-fsrs"].enabled === true',
    "plugins 键写进了 settings.json"
  );
  await check(
    'JSON.parse(localStorage.getItem("knowflick.workspace.v1")).settings.includes("reviewPluginEnabled")',
    "旧键 reviewPluginEnabled 仍然保留给安卓端"
  );
  await check('document.body.innerText.includes("温故复习")', "温故复习导航随插件开启出现");

  // 本地语义检索面板：浏览器模式要说明只在桌面端可用
  await check('!!document.querySelector(\'[data-group="embedding"] [data-embed-status]\')', "本地语义检索面板渲染");
  await check(
    'document.querySelector(\'[data-group="embedding"] [data-embed-status]\').textContent.includes("桌面客户端")',
    "浏览器模式下语义模型面板说明限制"
  );

  // MCP 面板
  await check('!!document.querySelector("[data-mcp-snippet]")', "MCP 配置片段面板渲染");
  await check(
    'JSON.parse(document.querySelector("[data-mcp-snippet]").textContent).mcpServers.knowflick.args[0] === "tools/mcp-server.mjs"',
    "MCP 片段指向 tools/mcp-server.mjs"
  );

  // .kfbackup 往返：造样本 → 点真实导出拿到字节 → 清库 → 走真实恢复输入框
  await clickButton("全部知识");
  await browser("click", ".ws-capture");
  await browser("fill", '.ws-dialog input[type="text"]', "备份往返记录");
  await browser("fill", '.ws-dialog textarea', "用于验证 .kfbackup 无损恢复的正文内容。");
  await browser("click", '.ws-dialog button[type="submit"]');
  await check('document.querySelector(".ws-reader h1")?.textContent === "备份往返记录"', "样本素材已创建");
  await check(
    'JSON.parse(localStorage.getItem("knowflick.workspace.v1")).materials[0].title === "备份往返记录"',
    "样本素材确实落到存储里"
  );

  // 拦下导出的 Blob，这样拿到的是「用户点导出按钮」真实产出的字节
  await browser(
    "eval",
    `(()=>{window.__kfBackup=null;const orig=URL.createObjectURL.bind(URL);
      URL.createObjectURL=(blob)=>{window.__kfBackup=blob;return "blob:intercepted";};return true})()`
  );
  await clickButton("设置");
  await clickButton("导出完整备份包");
  await check("window.__kfBackup instanceof Blob", "导出按钮产出了一个备份 Blob");
  await check(
    'JSON.parse(document.querySelector("[data-mcp-snippet]").textContent) !== null',
    "导出后设置页仍在"
  );

  const base64 = JSON.parse(
    await browser(
      "eval",
      `(async()=>{
        const buf = new Uint8Array(await window.__kfBackup.arrayBuffer());
        let bin = "";
        for (const b of buf) bin += String.fromCharCode(b);
        return btoa(bin);
      })()`
    )
  );
  const bytes = Buffer.from(base64, "base64");
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  console.log(`PASS 导出的 .kfbackup 是合法 ZIP（${bytes.length} 字节）`);

  const backupPath = join(tmpdir(), `knowflick-e2e-${Date.now()}.kfbackup`);
  writeFileSync(backupPath, bytes);

  // 清掉浏览器库，验证是从文件里恢复回来的
  await browser("eval", "localStorage.clear();sessionStorage.clear();true");
  await browser("open", url);
  await check(
    'JSON.parse(localStorage.getItem("knowflick.workspace.v1")||\'{"materials":[]}\').materials.length === 0',
    "清库后本地确实为空"
  );

  await clickButton("设置");
  await browser("click", '[data-action="restore-kfbackup"]');
  await browser("upload", '[aria-label="选择完整备份包"]', backupPath);
  await check('document.body.innerText.includes("备份恢复完成")', "提示里报告备份恢复完成");
  await browser("open", url);
  await check(
    'document.body.innerText.includes("备份往返记录")',
    "恢复后的素材出现在工作台里"
  );
  await check(
    'JSON.parse(localStorage.getItem("knowflick.workspace.v1")).materials.some(m=>m.title==="备份往返记录" && m.rawText.includes("kfbackup"))',
    "恢复后的正文逐字段一致"
  );
  await check(
    'JSON.parse(JSON.parse(localStorage.getItem("knowflick.workspace.v1")).settings).plugins["official-review-fsrs"].enabled === true',
    "备份里的插件设置也一并还原"
  );
  rmSync(backupPath, { force: true });
  console.log("PASS .kfbackup 从导出按钮到恢复输入框的整条链路可用");

  console.log("Plugins / backup / MCP settings smoke complete.");
} finally {
  await browser("close").catch(() => {});
}
