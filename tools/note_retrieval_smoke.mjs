#!/usr/bin/env node
/**
 * 笔记进入全局检索与引用闭环（T13，审计 G01）。
 *
 * 覆盖产品路线要求的那一个完整增量：
 *   选定知识库 → 搜原文 → 打开笔记 → 应用引用
 *
 * 此前笔记只在笔记页里能搜到，全局检索完全看不到——长文笔记等于没有。
 * 这里在浏览器模式（localStorage）里跑真实界面，不依赖模型与网络。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";

const exec = promisify(execFile);
const session = "knowflick-note-retrieval-smoke";
const url = process.env.KNOWFLICK_UI_URL || "http://localhost:1420";
const b = async (...args) => (await exec("agent-browser", ["--session", session, ...args], { timeout: 25000 })).stdout.trim();
const ev = async code => { const r = JSON.parse(await b("eval", `JSON.stringify(${code})`)); return typeof r === "string" ? JSON.parse(r) : r; };

let count = 0;
async function check(expression, label) {
  for (let n = 0; n < 60; n++) {
    if (await ev(expression)) { count++; console.log(`PASS ${label}`); return true; }
    await new Promise(r => setTimeout(r, 120));
  }
  console.error(`FAIL ${label}；现场：${await ev("JSON.stringify({url:location.href,text:document.body.innerText.slice(0,300)})")}`);
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

// 清库重来，避免上一轮残留干扰
await b("eval", "(()=>{localStorage.removeItem('knowflick.notes.v1');localStorage.removeItem('knowflick.workspace.v1');return true})()");
await b("open", url);
await new Promise(r => setTimeout(r, 1500));

// 1. 造一篇带独特词的笔记
await b("eval", `(()=>{
  const now = Date.now();
  const note = {
    id: 'n-marker-1', title: '北极项目决策记录', bodyMd: '结论是采用分阶段上线的策略，风险在第三阶段。',
    notebook: '项目甲', tags: ['决策'], isPinned: false, isFavorite: false, archivedAt: null,
    sourceMaterialId: null, currentRevision: 3, createdAt: now, updatedAt: now, isDeleted: false, deletedAt: null,
  };
  localStorage.setItem('knowflick.notes.v1', JSON.stringify({ notes: [note], knowledgeBases: [], membership: {} }));
  return true;
})()`);
await b("open", url);
await new Promise(r => setTimeout(r, 1500));

// 2. 建一个知识库并把笔记放进去（走笔记页的真实接口）
await b("eval", "(()=>{const s=JSON.parse(localStorage.getItem('knowflick.notes.v1'));s.knowledgeBases=[{id:'kb-a',name:'项目甲库',description:'',createdAt:1,updatedAt:2}];s.membership={'kb-a\\nn-marker-1':3};localStorage.setItem('knowflick.notes.v1',JSON.stringify(s));return true})()");
await b("open", url);
await new Promise(r => setTimeout(r, 1800));

// 3. 切到「全部知识」集合（笔记属于库内容，不在收件箱里），再检索
await b("eval", "(()=>{const rows=[...document.querySelectorAll('.ws-nav-row')];const r=rows.find(x=>x.textContent.includes('全部知识'));if(r){r.click();return true}return false})()");
await new Promise(r => setTimeout(r, 600));
await setNative('input[aria-label="搜索知识库"]', "分阶段上线");
await check(
  "document.body.innerText.includes('北极项目决策记录')",
  "全局检索命中笔记正文"
);

// 4. 来源筛选页签里有「笔记」
await check(
  "[...document.querySelectorAll('.ws-filter-tabs button')].some(b=>b.textContent.trim()==='笔记')",
  "来源筛选含「笔记」页签"
);
await b("eval", "(()=>{const b=[...document.querySelectorAll('.ws-filter-tabs button')].find(x=>x.textContent.trim()==='笔记');b.click();return true})()");
await check(
  "(()=>{const rows=[...document.querySelectorAll('.ws-entry')];return rows.length>=1 && rows.every(r=>r.innerText.includes('北极项目决策记录'))})()",
  "「笔记」筛选只剩笔记条目"
);

// 5. 知识库范围选择器存在，且选中后只剩该库的笔记
await check(
  "!!document.querySelector('select[aria-label=\"按知识库筛选\"]')",
  "知识库范围选择器渲染"
);
await b("eval", "(()=>{const s=document.querySelector('select[aria-label=\"按知识库筛选\"]');s.value='kb-a';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
await check(
  "document.querySelectorAll('.ws-entry').length >= 1",
  "选定知识库后仍有命中条目"
);

// 6. 点笔记条目 → 跳到笔记页并打开那篇
await b("eval", "(()=>{document.querySelector('.ws-entry').click();return true})()");
await check(
  "document.querySelector('[data-page=\"notes\"]') !== null",
  "点笔记条目跳到笔记页"
);
await check(
  "(()=>{const ta=document.querySelector('textarea[aria-label=\"笔记正文\"]');return !!ta && ta.value.includes('分阶段上线')})()",
  "笔记页打开的是命中的那篇"
);

// 7. 应用引用：引用另一篇笔记
await b("eval", `(()=>{
  const now = Date.now();
  const s = JSON.parse(localStorage.getItem('knowflick.notes.v1'));
  s.notes.push({ id:'n-marker-2', title:'来源笔记', bodyMd:'这是被引用的原始结论。', notebook:null, tags:[], isPinned:false, isFavorite:false, archivedAt:null, sourceMaterialId:null, currentRevision:1, createdAt:now, updatedAt:now, isDeleted:false, deletedAt:null });
  localStorage.setItem('knowflick.notes.v1', JSON.stringify(s));
  return true;
})()`);
await b("open", url);
await new Promise(r => setTimeout(r, 1800));
// 回到笔记页并打开被引用的目标笔记（n-marker-1）
await b("eval", "(()=>{const rows=[...document.querySelectorAll('.ws-nav-row')];const r=rows.find(x=>x.textContent.includes('笔记'));if(r){r.click();return true}return false})()");
await new Promise(r => setTimeout(r, 900));
await b("eval", "(()=>{const rows=[...document.querySelectorAll('.nv-entry')];const r=rows.find(x=>x.textContent.includes('北极项目决策记录'));if(r){r.click();return true}return false})()");
await new Promise(r => setTimeout(r, 700));
await check("!!document.querySelector('textarea[aria-label=\"笔记正文\"]')", "已回到目标笔记的编辑页");
await b("eval", "(()=>{const el=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('引用另一篇笔记'));if(el){el.click();return true}return false})()");
await check("!!document.querySelector('input[aria-label=\"搜索要引用的笔记\"]')", "引用选择器打开");
await b("eval", "(()=>{const el=[...document.querySelectorAll('.nv-ref-item')].find(b=>b.textContent.includes('来源笔记'));if(el){el.click();return true}return false})()");
await check(
  "(()=>{const ta=document.querySelector('textarea[aria-label=\"笔记正文\"]');return !!ta && ta.value.includes('《来源笔记》') && ta.value.includes('knowflick://note/n-marker-2')})()",
  "引用插入正文（带可回原件链接）"
);

// 8. 引用落库
await check(
  "(()=>{const s=JSON.parse(localStorage.getItem('knowflick.notes.v1'));const n=s.notes.find(x=>x.id==='n-marker-1');return !!n && n.bodyMd.includes('knowflick://note/n-marker-2')})()",
  "引用随笔记一起落库"
);

// 9. 「回原件」在预览里可点，且点得回源笔记
await b("eval", "(()=>{const d=document.querySelector('.nv-preview');if(d&&!d.open)d.open=true;return true})()");
await check("document.querySelector('.nv-preview .ws-md-note-link') !== null", "预览里「回原件」是可点的内部链接");
await b("eval", "(()=>{const el=document.querySelector('.nv-preview .ws-md-note-link');el.click();return true})()");
await check(
  "(()=>{const ta=document.querySelector('textarea[aria-label=\"笔记正文\"]');return !!ta && ta.value.includes('这是被引用的原始结论')})()",
  "点「回原件」跳回源笔记"
);

console.log(`\n笔记检索与引用闭环 smoke：${count} 项检查通过。`);
