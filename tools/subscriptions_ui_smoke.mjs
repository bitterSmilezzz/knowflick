#!/usr/bin/env node
/**
 * Browser regression for the 订阅源 page. Requires a running Vite dev server
 * (KNOWFLICK_UI_URL, default http://localhost:1420) and agent-browser.
 *
 * 浏览器体验模式没有 subscriptions 表，所以这里验的是「页面在缺表时如实降级」：
 * 表单禁用、提示指向桌面端；解析与去重逻辑由 subscription.test.ts 覆盖。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";

const exec = promisify(execFile);
const session = "knowflick-subscriptions";
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

try {
  await browser("set", "viewport", "1040", "760");
  await browser("open", url);
  await browser("eval", "localStorage.clear();sessionStorage.clear()");
  await browser("open", url);

  await check(
    '[...document.querySelectorAll(".ws-nav-row")].some((b) => b.textContent.includes("订阅源"))',
    "导航里有订阅源入口"
  );
  await browser(
    "eval",
    '(()=>{const b=[...document.querySelectorAll(".ws-nav-row")].find(x=>x.textContent.includes("订阅源"));b.click();return true})()'
  );
  await check('!!document.querySelector(\'[data-page="subscriptions"]\')', "订阅源页面渲染");
  await check(
    'document.querySelector("[data-page=\\"subscriptions\\"]").innerText.includes("浏览器体验模式不能添加或抓取")',
    "浏览器模式如实说明不能添加/抓取"
  );
  await check(
    'document.querySelector(\'[aria-label="订阅目标"]\').disabled === true',
    "缺表时订阅目标输入框禁用"
  );
  await check(
    '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="添加订阅").disabled === true',
    "缺表时添加按钮禁用"
  );
  await check(
    'document.querySelector("[data-page=\\"subscriptions\\"]").innerText.includes("还没有订阅源")',
    "空列表有说明文案"
  );
  await check(
    '[...document.querySelectorAll("[aria-label=\\"订阅类型\\"] option")].map(o=>o.value).join(",") === "rss,github_release,github_trending,tech_board"',
    "四种订阅类型齐全"
  );
  await check(
    'document.querySelector("[data-page=\\"subscriptions\\"]").innerText.includes("当前没有到期的订阅")',
    "到期计数如实显示"
  );

  console.log("Subscriptions UI smoke complete.");
} finally {
  await browser("close").catch(() => {});
}
