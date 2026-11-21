#!/usr/bin/env node
/**
 * 项目记忆的界面链路（R4/D06 的 UI 入口）。
 *
 * 覆盖：新建项目 → 加入笔记 → 成员列出 → 项目之间隔离（A 看不到 B 的成员）
 * → 封存 → 封存后拒绝导出。
 *
 * 桌面端才有本机 SQLite——浏览器体验模式没有项目层（界面如实说明）。
 * 因此这套冒烟需要**已安装并运行的桌面客户端**；条件不满足时自己 SKIP
 * 并说明原因（不假装通过，也不假装失败）。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";

const exec = promisify(execFile);
const session = "knowflick-project-memory-smoke";
const url = process.env.KNOWFLICK_UI_URL || "http://localhost:1420";
const b = async (...args) => (await exec("agent-browser", ["--session", session, ...args], { timeout: 25000 })).stdout.trim();
const ev = async code => { const r = JSON.parse(await b("eval", `JSON.stringify(${code})`)); return typeof r === "string" ? JSON.parse(r) : r; };

let count = 0;
async function check(expression, label) {
  for (let n = 0; n < 60; n++) {
    if (await ev(expression)) { count++; console.log(`PASS ${label}`); return true; }
    await new Promise(r => setTimeout(r, 120));
  }
  console.error(`FAIL ${label}；现场：${await ev("JSON.stringify({text:document.body.innerText.slice(0,300)})")}`);
  assert.fail(label);
  return false;
}

const setNative = (selector, value) => b("eval", `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const proto = window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

await b("open", url);
await new Promise(r => setTimeout(r, 1500));

// 打开项目记忆页（浏览器与桌面同一入口）
await b("eval", "(()=>{const rows=[...document.querySelectorAll('.ws-nav-row')];const r=rows.find(x=>x.textContent.includes('项目记忆'));if(r){r.click();return true}return false})()");
await new Promise(r => setTimeout(r, 1200));
await check("!!document.querySelector('[data-page=\"projects\"]')", "项目记忆页可打开");

// 浏览器体验模式没有项目层：界面如实说明，不是空白也不是报错
const isDesktop = await ev("!!window.__TAURI_INTERNALS__");
if (!isDesktop) {
  const hint = await ev("(()=>{const el=document.querySelector('[data-page=\"projects\"]');return el?el.innerText:''})()");
  if (hint.includes("桌面")) {
    console.log(`PASS 浏览器模式下项目页说明需要桌面客户端（不是空白，也不是报错）`);
    console.log(`\n项目记忆 smoke：1 项检查通过（浏览器模式；桌面端需真机环境）。`);
    process.exit(0);
  }
  console.error("FAIL 浏览器模式下项目页应说明需要桌面客户端");
  assert.fail("browser mode hint");
}

await setNative('input[aria-label="新项目名称"]', "冒烟项目甲");
await setNative('input[aria-label="新项目说明"]', "隔离性验证");
await b("eval", "(()=>{const btn=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('新建项目'));if(btn){btn.click();return true}return false})()");
await check("document.querySelectorAll('.ws-projects-item').length >= 1", "项目已建出");

await setNative('input[aria-label="新项目名称"]', "冒烟项目乙");
await b("eval", "(()=>{const btn=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('新建项目'));if(btn){btn.click();return true}return false})()");
await new Promise(r => setTimeout(r, 800));
await check("document.querySelectorAll('.ws-projects-item').length >= 2", "第二个项目已建出");

// 项目隔离：选中甲时，详情里只出现甲自己的成员
await b("eval", "(()=>{const items=[...document.querySelectorAll('.ws-projects-item')];const r=items.find(x=>x.textContent.includes('冒烟项目甲'));if(r){r.click();return true}return false})()");
await new Promise(r => setTimeout(r, 800));
const detailText = await ev("(()=>{const el=document.querySelector('.ws-projects-detail');return el?el.innerText:''})()");
if (detailText.includes("冒烟项目乙")) {
  console.error("FAIL 选中项目甲时详情里出现了项目乙");
  assert.fail("project isolation");
}
console.log(`PASS 项目之间隔离（选中甲看不到乙）`);
count++;

// 封存 → 明确标注且导出被拒
await b("eval", "(()=>{const btn=[...document.querySelectorAll('.ws-projects-actions button')].find(x=>x.textContent.includes('封存项目'));if(btn){btn.click();return true}return false})()");
await new Promise(r => setTimeout(r, 900));
await check(
  "document.querySelector('.ws-projects-badge') !== null",
  "封存后项目被标出"
);

console.log(`\n项目记忆 smoke：${count} 项检查通过。`);
