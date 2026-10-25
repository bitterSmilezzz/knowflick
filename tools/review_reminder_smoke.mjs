#!/usr/bin/env node
/**
 * 主动回顾的界面链路（R4/D09）。
 *
 * 覆盖路线图口径：用户选频率与项目范围，安静时段、暂停和退订；
 * **只提醒可处理事项**——没有记录不是失败，所以不会为「没记录」发提醒。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";

const exec = promisify(execFile);
const session = "knowflick-review-reminder-smoke";
const url = process.env.KNOWFLICK_UI_URL || "http://localhost:1420";
const b = async (...args) => (await exec("agent-browser", ["--session", session, ...args], { timeout: 25000 })).stdout.trim();
const ev = async code => { const r = JSON.parse(await b("eval", `JSON.stringify(${code})`)); return typeof r === "string" ? JSON.parse(r) : r; };

let count = 0;
async function check(expression, label) {
  for (let n = 0; n < 60; n++) {
    if (await ev(expression)) { count++; console.log(`PASS ${label}`); return true; }
    await new Promise(r => setTimeout(r, 120));
  }
  console.error(`FAIL ${label}；现场：${await ev("JSON.stringify({text:document.body.innerText.slice(0,400)})")}`);
  assert.fail(label);
  return false;
}

const selectOption = (selector, value) => b("eval", `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  el.value = ${JSON.stringify(value)};
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);

await b("open", url);
await new Promise(r => setTimeout(r, 1500));

// 造一个可处理事项：目标有证据但未确认（需要走桌面端的目标表，这里改用收件箱堆积）
await b("eval", `(()=>{
  const key='knowflick.workspace.v1';
  const d = JSON.parse(localStorage.getItem(key) || '{"materials":[],"cards":[],"settings":"{}"}');
  d.materials = Array.from({length:6},(_,i)=>({
    id:'m-rem-'+i, sourceType:'manual', title:'待整理 '+i, sourceUrl:null, rawText:'正文',
    contentHash:'', mediaPath:null, mediaSizeBytes:0, metadataJson:'{}', inboxStatus:'inbox',
    createdAt:1, updatedAt:1
  }));
  localStorage.setItem(key, JSON.stringify(d));
  return true;
})()`);
await b("open", url);
await new Promise(r => setTimeout(r, 1600));

// 1. 打开复盘页
await b("eval", "(()=>{const rows=[...document.querySelectorAll('.ws-nav-row')];const r=rows.find(x=>x.textContent.includes('复盘'));if(r){r.click();return true}return false})()");
await check("!!document.querySelector('[aria-label=\"主动回顾\"]')", "主动回顾区块存在");

// 2. 频率可选（含退订）
await check(
  "(()=>{const sel=document.querySelector('select[aria-label=\"回顾频率\"]');return !!sel && [...sel.options].map(o=>o.value).join(',')==='off,daily,weekly,monthly'})()",
  "频率可选：关闭/每天/每周/每月"
);

// 3. 安静时段可设
await check(
  "!!document.querySelector('select[aria-label=\"安静时段开始\"]') && !!document.querySelector('select[aria-label=\"安静时段结束\"]')",
  "安静时段可设（起止）"
);

// 4. 暂停开关存在
await check("!!document.querySelector('input[aria-label=\"暂停主动回顾\"]')", "暂停开关存在");

// 5. 可处理事项清单：收件箱堆积 6 条 → 有提醒
await check(
  "(()=>{const el=document.querySelector('[data-reminders]');return !!el && el.innerText.includes('收件箱')})()",
  "收件箱堆积产生可处理提醒"
);

// 6. 退订后不再提醒
await selectOption('select[aria-label="回顾频率"]', "off");
await new Promise(r => setTimeout(r, 500));
await check(
  "(()=>{const el=document.querySelector('[aria-label=\"主动回顾\"]');return el.innerText.includes('已退订')})()",
  "退订后界面说明不再提醒"
);

// 7. 恢复频率
await selectOption('select[aria-label="回顾频率"]', "weekly");
await new Promise(r => setTimeout(r, 800));
await check(
  "(()=>{const el=document.querySelector('[aria-label=\"主动回顾\"]');return !el.innerText.includes('已退订')})()",
  "恢复频率后不再显示已退订"
);

// 8. 暂停后说明暂停（轮询确保 click 命中，避免连跑调度抖动）
await check(
  "(()=>{const el=document.querySelector('input[aria-label=\"暂停主动回顾\"]');if(!el)return false;if(!el.checked)el.click();return (document.querySelector('[aria-label=\"主动回顾\"]')?.innerText||'').includes('已暂停')})()",
  "暂停后界面说明不会提醒"
);

console.log(`\n主动回顾 smoke：${count} 项检查通过。`);
