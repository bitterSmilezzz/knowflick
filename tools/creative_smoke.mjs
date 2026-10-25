#!/usr/bin/env node
/**
 * 创作工作台的界面链路（R4/D07）。
 *
 * 覆盖路线图要求的那条：检索 → 选取证据 → 大纲/文稿 → 人工修改 → 导出。
 * R4 退出门槛「创作草稿可以检查、修改与导出」——整条链路**不依赖模型**，
 * 所以这套冒烟在浏览器模式就能跑完整。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";

const exec = promisify(execFile);
const session = "knowflick-creative-smoke";
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

const setNative = (selector, value) => b("eval", `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

await b("open", url);
await new Promise(r => setTimeout(r, 1500));

// 造一条笔记当证据（浏览器仓储）
await b("eval", `(()=>{
  const now = Date.now();
  const s = JSON.parse(localStorage.getItem('knowflick.notes.v1') || '{"notes":[],"knowledgeBases":[],"membership":{}}');
  s.notes = s.notes.filter(n=>n.id!=='n-creative-1');
  s.notes.push({ id:'n-creative-1', title:'创作证据笔记', bodyMd:'这条笔记的正文里有可引用的独特词 zzzcreativeevidence。', notebook:null, tags:[], isPinned:false, isFavorite:false, archivedAt:null, sourceMaterialId:null, currentRevision:1, createdAt:now, updatedAt:now, isDeleted:false, deletedAt:null });
  localStorage.setItem('knowflick.notes.v1', JSON.stringify(s));
  return true;
})()`);
await b("open", url);
await new Promise(r => setTimeout(r, 1600));

// 1. 打开创作台
await b("eval", "(()=>{const rows=[...document.querySelectorAll('.ws-nav-row')];const r=rows.find(x=>x.textContent.includes('创作台'));if(r){r.click();return true}return false})()");
await check("!!document.querySelector('[data-page=\"creative\"]')", "创作台页可打开");

// 2. 检索证据
await setNative('input[aria-label="搜索证据"]', "zzzcreativeevidence");
await check(
  "(()=>{const items=[...document.querySelectorAll('.ws-creative-candidate')];return items.some(x=>x.textContent.includes('创作证据笔记'))})()",
  "检索命中笔记证据"
);

// 3. 选取证据
await b("eval", "(()=>{const items=[...document.querySelectorAll('.ws-creative-candidate')];const r=items.find(x=>x.textContent.includes('创作证据笔记'));if(r){r.click();return true}return false})()");
await check(
  "document.querySelectorAll('.ws-creative-picked-item').length === 1",
  "证据已选入"
);

// 4. 按证据生成大纲（不依赖模型）
await b("eval", "(()=>{const btn=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('按证据生成大纲'));if(btn){btn.click();return true}return false})()");
await check(
  "(()=>{const ta=document.querySelector('textarea[aria-label=\"草稿正文\"]');return !!ta && ta.value.includes('创作证据笔记') && ta.value.includes('## 1.')})()",
  "大纲由证据生成（可检查）"
);

// 5. 人工修改
await setNative('textarea[aria-label="草稿正文"]', "我自己的论点：分阶段上线更稳妥。\n\n## 补充\n再加一段。");
await check(
  "(()=>{const ta=document.querySelector('textarea[aria-label=\"草稿正文\"]');return !!ta && ta.value.includes('我自己的论点')})()",
  "草稿可人工修改"
);

// 6. 标题
await setNative('input[aria-label="草稿标题"]', "我的创作稿");

// 7. 导出（Markdown 下载）
const downloadName = await b("eval", `(()=>{
  const orig = document.createElement.bind(document);
  let captured = null;
  document.createElement = function(tag){
    const el = orig(tag);
    if (tag === 'a') { const origClick = el.click.bind(el); el.click = function(){ captured = el.download; }; }
    return el;
  };
  const btn = [...document.querySelectorAll('button')].find(x=>x.textContent.includes('导出 Markdown'));
  if (btn) btn.click();
  document.createElement = orig;
  return captured;
})()`);
// 下载名只触发一次，不能用会重复求值的 check
assert.ok(typeof downloadName === "string" && downloadName.length > 0, `导出应触发下载，实际：${downloadName}`);
count++;
console.log(`PASS 导出触发下载（${downloadName}）`);

// 9. 明确不代发：界面有说明
await check(
  "document.querySelector('[data-page=\"creative\"]').innerText.includes('不代发')",
  "界面明确说明不代发到外部平台"
);

console.log(`\n创作工作台 smoke：${count} 项检查通过。`);
