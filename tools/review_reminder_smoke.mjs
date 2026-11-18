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

// 清掉上一次的回顾计划残留。
//
// 为什么必须清：回顾计划存在 settings 的 raw.reviewSchedule 里，lastRemindedAt
// 一旦写上，weekly 频率下 7 天内都不再「到期」——上次跑过的冒烟会让
// 这次跑到「到期入口」那一步时条件根本不成立，看起来像产品坏了。
// 每次都从「从未回顾过」开始，断言才是确定的。
//
// 注意 settings 在浏览器里存的是**字符串**（encodeSettings 的结果），
// 不是对象——直接 delete 会静默无效。
await b("eval", `(()=>{
  const key='knowflick.workspace.v1';
  const d = JSON.parse(localStorage.getItem(key) || '{"materials":[],"cards":[],"settings":null}');
  let raw = {};
  if (typeof d.settings === 'string' && d.settings) {
    try { raw = JSON.parse(d.settings); } catch { raw = {}; }
  } else if (d.settings && typeof d.settings === 'object') {
    raw = d.settings;
  }
  delete raw.reviewSchedule;
  raw.baseURL = 'http://127.0.0.1:11434/v1';
  raw.model = 'review-smoke';
  raw.enableAI = true;
  d.settings = JSON.stringify(raw);
  localStorage.setItem(key, JSON.stringify(d));
  return true;
})()`);

// 造一个可处理事项：目标有证据但未确认（需要走桌面端的目标表，这里改用收件箱堆积）
await b("eval", `(()=>{
  const key='knowflick.workspace.v1';
  const d = JSON.parse(localStorage.getItem(key) || '{"materials":[],"cards":[],"settings":"{}"}');
  d.materials = Array.from({length:6},(_,i)=>({
    id:'m-rem-'+i, sourceType:'manual', title:'待整理 '+i, sourceUrl:null, rawText:'正文',
    contentHash:'', mediaPath:null, mediaSizeBytes:0, metadataJson:'{}', inboxStatus:'inbox',
    createdAt:Date.now()-1000, updatedAt:Date.now()-1000
  }));
  localStorage.setItem(key, JSON.stringify(d));
  return true;
})()`);
await b("open", url);
await new Promise(r => setTimeout(r, 1600));

// 1. 打开复盘页
await b("eval", "(()=>{const rows=[...document.querySelectorAll('.ws-nav-row')];const r=rows.find(x=>x.textContent.includes('复盘'));if(r){r.click();return true}return false})()");
await check("!!document.querySelector('[aria-label=\"主动回顾\"]')", "主动回顾区块存在");
await check("!!document.querySelector('[aria-label=\"AI 建议\"]')", "复盘 AI 建议区块存在");
await check(
  "(()=>{const section=document.querySelector('[aria-label=\"AI 建议\"]');const box=section?.querySelector('input[type=checkbox]');const button=[...(section?.querySelectorAll('button')||[])].find(x=>x.textContent.includes('生成建议'));return !!box && !box.checked && !!button && button.disabled && !!section.querySelector('.rv-ai-preview') && section.textContent.includes('待整理')})()",
  "AI 请求先展示来源预览并要求逐次同意"
);
await b("eval", "(()=>{const box=document.querySelector('[aria-label=\"AI 建议\"] input[type=checkbox]');if(box)box.click();return !!box})()");
await check(
  "(()=>{const section=document.querySelector('[aria-label=\"AI 建议\"]');const box=section?.querySelector('input[type=checkbox]');const button=[...(section?.querySelectorAll('button')||[])].find(x=>x.textContent.includes('生成建议'));return !!box?.checked && !!button && !button.disabled})()",
  "明确同意后才启用生成按钮"
);
await b("eval", `(()=>{
  window.__reviewCalls=0;
  window.__reviewFetchOriginal=window.fetch.bind(window);
  window.fetch=async(input,init)=>{
    if(!String(input).includes('127.0.0.1:11434'))return window.__reviewFetchOriginal(input,init);
    window.__reviewCalls++;
    window.__reviewPrompt=JSON.parse(init.body);
    const answer=JSON.stringify([{text:'把这批待整理素材归成一个主题，并选出一条后续动作',evidenceIds:['material:m-rem-0']}]);
    return new Response(JSON.stringify({choices:[{message:{content:answer}}]}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const key='knowflick.workspace.v1';
  const data=JSON.parse(localStorage.getItem(key));
  data.materials=data.materials.map(item=>item.id==='m-rem-0'?{...item,rawText:'刷新后的正文，供发送前核对'}:item);
  localStorage.setItem(key,JSON.stringify(data));
  return true;
})()`);
await b("eval", "(()=>{const section=document.querySelector('[aria-label=\"AI 建议\"]');const button=[...(section?.querySelectorAll('button')||[])].find(x=>x.textContent.includes('生成建议'));button?.click();return !!button})()");
await check(
  "(()=>{const section=document.querySelector('[aria-label=\"AI 建议\"]');const box=section?.querySelector('input[type=checkbox]');const button=[...(section?.querySelectorAll('button')||[])].find(x=>x.textContent.includes('生成建议'));return !!section?.textContent.includes('刷新后的正文') && section.innerText.includes('刷新下方预览') && !!box && !box.checked && !!button?.disabled && window.__reviewCalls===0})()",
  "来源变化后刷新预览并在发送前中止"
);
await b("eval", "(()=>{const box=document.querySelector('[aria-label=\"AI 建议\"] input[type=checkbox]');if(box)box.click();return !!box})()");
await check(
  "(()=>{const section=document.querySelector('[aria-label=\"AI 建议\"]');const button=[...(section?.querySelectorAll('button')||[])].find(x=>x.textContent.includes('生成建议'));return !!section?.querySelector('input[type=checkbox]')?.checked && !!button && !button.disabled})()",
  "核对刷新后的来源并再次同意"
);
await b("eval", `(()=>{
  window.__reviewNotesBefore=localStorage.getItem('knowflick.notes.v1');
  window.__reviewArtifactsBefore=localStorage.getItem('knowflick.workspace.artifacts');
  const section=document.querySelector('[aria-label="AI 建议"]');
  [...section.querySelectorAll('button')].find(x=>x.textContent.includes('生成建议'))?.click();
  return true;
})()`);
await check(
  "(()=>{const section=document.querySelector('[aria-label=\"AI 建议\"]');return section?.innerText.includes('建议已生成') && section.textContent.includes('把这批待整理素材归成一个主题') && section.textContent.includes('待整理 0') && window.__reviewCalls===1 && window.__reviewPrompt.messages[1].content.includes('刷新后的正文')})()",
  "模拟模型结果只显示本页且带回原件引用"
);
await check(
  "localStorage.getItem('knowflick.notes.v1')===window.__reviewNotesBefore && localStorage.getItem('knowflick.workspace.artifacts')===window.__reviewArtifactsBefore",
  "AI 建议不会自动写入笔记或产物"
);

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

// 系统通知必须由用户显式开启；浏览器预览不应请求桌面权限。
await check(
  "(()=>{const el=document.querySelector('input[aria-label=\"启用系统通知\"]');return !!el && !el.checked && el.disabled})()",
  "系统通知默认关闭，浏览器预览不请求桌面权限"
);

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

// 9. 取消暂停 → 到期时出现回顾入口，且写回上次回顾时间
await check(
  "(()=>{const el=document.querySelector('input[aria-label=\"暂停主动回顾\"]');if(!el)return false;if(el.checked)el.click();return true})()",
  "取消暂停"
);

// 安静时段的两个分支必须分开测，顺序有讲究：
// **先**测「到期但被安静时段挡着」，**再**测「到期入口」。
// 反过来测会失败——第 11 步点了「我现在回顾」就写回了上次提醒时间，
// 之后不再处于「到期」状态，第 10 步的条件就不成立了。
//
// 安静时段默认 22:00–08:00，冒烟可能在夜里跑——两处都要按当前时刻动态算。
const hour = new Date().getHours();
// 覆盖当前时刻的那一小时（start=h, end=h+1）：此刻必在安静时段里
await selectOption('select[aria-label="安静时段开始"]', String(hour));
await selectOption('select[aria-label="安静时段结束"]', String((hour + 1) % 24));
await new Promise(r => setTimeout(r, 700));
await check(
  "!!document.querySelector('[data-due-quiet]') && !document.querySelector('[data-due]')",
  "安静时段内的到期状态单独说明"
);

// 把安静时段挪到 6 小时后——此刻一定不在里面
await selectOption('select[aria-label="安静时段开始"]', String((hour + 6) % 24));
await selectOption('select[aria-label="安静时段结束"]', String((hour + 7) % 24));
await new Promise(r => setTimeout(r, 700));

await check(
  "!!document.querySelector('[data-due]') && !!document.querySelector('button[aria-label=\"我现在回顾\"]')",
  "到期时出现回顾入口"
);
await check(
  "(()=>{const el=document.querySelector('[aria-label=\"主动回顾\"]');return el.innerText.includes('还没回顾过')})()",
  "未回顾过时如实显示"
);

// 点「我现在回顾」→ 到期状态消失，上次回顾时间被写上
await b("eval", `(()=>{const btn=document.querySelector('button[aria-label="我现在回顾"]');if(btn)btn.click();return !!btn})()`);
await new Promise(r => setTimeout(r, 800));
await check(
  "(()=>{const el=document.querySelector('[aria-label=\"主动回顾\"]');return el.innerText.includes('上次回顾：') && !el.innerText.includes('还没回顾过')})()",
  "回顾完成后写回上次回顾时间"
);
await check(
  "(()=>{return !document.querySelector('[data-due]')})()",
  "回顾完成后不再显示到期入口"
);

console.log(`\n主动回顾 smoke：${count} 项检查通过。`);
