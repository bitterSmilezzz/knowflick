#!/usr/bin/env node
/**
 * 核心用户旅程易用性走查（Usability Journey Smoke）。
 *
 * 走查 12 个关键交互节点，覆盖从初次使用到录入、搜索、设置的完整链路：
 *  1. 空库首屏有明确引导
 *  2. Cmd/Ctrl+N 快捷呼出录入
 *  3. 焦点自动落在正文
 *  4. 中文输入法组合期不误提交
 *  5. 空正文提交给出可读错误（非静默无反应）
 *  6. 保存后进入阅读区且草稿清空
 *  7. 刷新后内容保持
 *  8. 搜索命中并高亮
 *  9. 搜不到时给出恢复路径（不留死路）
 * 10. 真实键盘退格清空后列表恢复
 * 11. 设置修改给出明确成功反馈
 * 12. 离开设置后顺利返回主界面
 *
 * 需要运行中的 Vite（KNOWFLICK_UI_URL，默认 http://localhost:1420）与 agent-browser。
 * 自带独立会话，只清该会话的存储。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";

const exec = promisify(execFile);
const session = "knowflick-usability-journey";
const url = process.env.KNOWFLICK_UI_URL || "http://localhost:1420";

async function browser(...args) {
  const { stdout } = await exec("agent-browser", ["--session", session, ...args], { timeout: 30000 });
  return stdout.trim();
}
async function evaluate(code) {
  const out = await browser("eval", `JSON.stringify(${code})`);
  const parsed = JSON.parse(out);
  return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
}
function pass(n, label, detail) {
  console.log(`PASS ${n}. ${label}${detail ? ` (${detail})` : ""}`);
}

try {
  await browser("set", "viewport", "1040", "760");
  await browser("open", url);
  await browser("eval", "localStorage.clear(); sessionStorage.clear(); true");
  await browser("open", url);
  await new Promise((r) => setTimeout(r, 900));

  // 1. 空库首屏引导
  const t1 = await evaluate("document.body.innerText.replace(/\\s+/g,' ')");
  assert.ok(t1.includes("从一个想法开始") && t1.includes("记录第一条"), "首屏需要有下一步引导");
  pass(1, "首屏能看出下一步该做什么");

  // 2. Cmd/Ctrl+N
  await browser("press", "Control+n");
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(await evaluate("!!document.querySelector('dialog[open]')"), "Cmd/Ctrl+N 打开录入");
  pass(2, "Cmd/Ctrl+N 打开录入对话框");

  // 3. 焦点落正文
  const tag3 = await evaluate("document.activeElement.tagName");
  assert.equal(tag3, "TEXTAREA", "焦点应当落在正文输入框");
  pass(3, "焦点自动落在正文");

  // 4. 输入法组合期
  const composing = await evaluate(`(() => {
    const ta = document.querySelector('.ws-dialog textarea');
    const e = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true });
    ta.dispatchEvent(e);
    return !!document.querySelector('dialog[open]');
  })()`);
  assert.equal(composing, true, "输入法组合回车不应关掉对话框");
  pass(4, "中文输入法组合期不误提交");

  // 5. 空正文给出错误，不是静默无反应
  await browser(
    "eval",
    `(() => {
      const ta = document.querySelector('.ws-dialog textarea');
      const d = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
      d.set.call(ta, '   ');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return ta.value;
    })()`
  );
  await browser("click", '.ws-dialog button[type="submit"]');
  await new Promise((r) => setTimeout(r, 400));
  const alert5 = await evaluate("document.querySelector('dialog[open] [role=alert]')?.textContent ?? ''");
  assert.ok(alert5.includes("正文不能为空"), `期望提示正文不能为空，实际：${alert5}`);
  pass(5, "正文为空时提交给出可读错误", alert5);

  // 6. 保存进入阅读区
  await browser("fill", ".ws-dialog textarea", "今天想到：把周报做成可复习的卡片");
  await browser("click", '.ws-dialog button[type="submit"]');
  await new Promise((r) => setTimeout(r, 600));
  const h1 = await evaluate("document.querySelector('.ws-reader h1')?.textContent ?? ''");
  assert.ok(h1.includes("周报"), `保存后正文应进入阅读区，实际 h1: ${h1}`);
  pass(6, "成功保存后进入阅读区", h1);

  // 7. 刷新后内容保持
  await browser("open", url);
  await new Promise((r) => setTimeout(r, 900));
  const t7 = await evaluate("document.body.innerText");
  assert.ok(t7.includes("周报"), "刷新后内容仍应存在");
  pass(7, "刷新后内容仍在");

  // 8. 搜索命中并高亮
  await browser("fill", '[aria-label="搜索知识库"]', "周报");
  await new Promise((r) => setTimeout(r, 500));
  const n8 = await evaluate("document.querySelectorAll('.ws-entry').length");
  const marks = await evaluate("document.querySelectorAll('.ws-entry mark').length");
  assert.equal(n8, 1, "应命中 1 条内容");
  assert.ok(marks > 0, "应有高亮匹配");
  pass(8, "搜索命中并高亮", `${n8} 条，${marks} 处高亮`);

  // 9. 搜不到时有恢复提示
  await browser("fill", '[aria-label="搜索知识库"]', "zzz不存在");
  await new Promise((r) => setTimeout(r, 500));
  const t9 = await evaluate("document.body.innerText.replace(/\\s+/g,' ')");
  assert.ok(t9.includes("没有找到") || t9.includes("清除筛选"), "应提示搜不到并给出恢复按钮");
  pass(9, "搜不到时给出恢复路径");

  // 10. 真实键盘退格清空后恢复
  await browser("focus", '[aria-label="搜索知识库"]');
  for (let i = 0; i < 6; i++) await browser("press", "Backspace");
  await new Promise((r) => setTimeout(r, 500));
  const n10 = await evaluate("document.querySelectorAll('.ws-entry').length");
  assert.equal(n10, 1, "退格清空后列表应恢复");
  pass(10, "清空搜索后列表恢复");

  // 11. 设置保存反馈
  await browser(
    "eval",
    "(()=>{const b=[...document.querySelectorAll('.ws-nav-row')].find(x=>x.textContent.includes('设置'));b.click();return 1})()"
  );
  await new Promise((r) => setTimeout(r, 600));
  await browser("click", ".ws-settings-foot button[type=submit]");
  await new Promise((r) => setTimeout(r, 600));
  const t11 = await evaluate("document.body.innerText");
  assert.ok(t11.includes("设置已成功保存"), "设置保存后需有明确文字回显");
  pass(11, "设置页保存给出明确结果");

  // 12. 顺利返回主界面
  await browser("click", ".ws-settings-foot button:not([type=submit])");
  await new Promise((r) => setTimeout(r, 600));
  const inSettings = await evaluate("!!document.querySelector('[data-page=\"settings\"]')");
  assert.equal(inSettings, false, "返回按钮应回到知识库主页");
  pass(12, "离开设置页顺利返回");

  console.log("\nUsability journey smoke: 12 checks passed.");
} finally {
  await browser("close").catch(() => {});
}
