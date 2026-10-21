#!/usr/bin/env node
/** 笔记本体回归：手写与语音是「笔记软件」的基本盘，必须能记、能落库。 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
const exec = promisify(execFile);
const session = "knowflick-notes-smoke";
const url = process.env.KNOWFLICK_UI_URL || "http://localhost:1420";
const b = async (...args) => (await exec("agent-browser", ["--session", session, ...args], { timeout: 25000 })).stdout.trim();
const ev = async code => { const r = JSON.parse(await b("eval", `JSON.stringify(${code})`)); return typeof r === "string" ? JSON.parse(r) : r; };
let count = 0;
async function check(expression, label) {
  for (let n = 0; n < 40; n++) {
    if (await ev(expression)) { count++; console.log(`PASS ${label}`); return; }
    await new Promise(r => setTimeout(r, 100));
  }
  assert.fail(label);
}
const stroke = async (points) => b("eval", `(()=>{const c=document.querySelector('.ink-canvas');const r=c.getBoundingClientRect();
  const fire=(t,x,y)=>c.dispatchEvent(new PointerEvent(t,{clientX:r.left+x,clientY:r.top+y,pointerId:1,bubbles:true,buttons:t==='pointerup'?0:1}));
  fire('pointerdown',${points[0][0]},${points[0][1]});
  ${points.slice(1).map(([x, y]) => `fire('pointermove',${x},${y});`).join("")}
  fire('pointerup',${points.at(-1)[0]},${points.at(-1)[1]});
  return true})()`);

try {
  await b("set", "viewport", "1040", "760");
  await b("open", url);
  await b("eval", "localStorage.clear();sessionStorage.clear();true");
  await b("open", url);
  await check("!!document.querySelector('.ws')", "工作台就绪");

  // 三种记法并列在记录入口下
  await check("[...document.querySelectorAll('.ws-capture-mode')].map(e=>e.getAttribute('aria-label')).join(',')==='手写笔记,语音笔记,导入音频转写'", "记录入口并列手写/语音/转写");

  // 手写
  await b("click", '[aria-label="手写笔记"]');
  await check("!!document.querySelector('.ink-canvas')", "手写板打开");
  await check("document.querySelector('.ink-canvas').getAttribute('aria-label').includes('0 笔')", "空画布显示 0 笔");
  await check("[...document.querySelectorAll('.ink-swatch')].length===3", "提供三档笔色");
  await check("[...document.querySelectorAll('.ink-width')].length===3", "提供三档笔宽");
  await stroke([[60, 80], [120, 110], [180, 90], [240, 130]]);
  await stroke([[80, 200], [160, 220], [260, 190]]);
  await check("document.querySelector('.ink-canvas').getAttribute('aria-label').includes('2 笔')", "画两笔后计数正确");
  await b("eval", "(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='撤销').click();return true})()");
  await check("document.querySelector('.ink-canvas').getAttribute('aria-label').includes('1 笔')", "撤销按笔回退");
  await stroke([[90, 150], [200, 170], [300, 150]]);
  await check("document.querySelector('.ink-canvas').getAttribute('aria-label').includes('2 笔')", "撤销后可继续书写");

  // 保存 → 落进收件箱，且笔迹写进素材
  await b("eval", "(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.includes('保存手写笔记')).click();return true})()");
  await check("!document.querySelector('.ink-canvas')", "保存后关闭手写板");
  await check("(()=>{const raw=JSON.parse(localStorage.getItem('knowflick.workspace.v1'));return raw.materials.some(m=>m.sourceType==='ink')})()", "手写笔记落成素材");
  await check("(()=>{const raw=JSON.parse(localStorage.getItem('knowflick.workspace.v1'));const m=raw.materials.find(x=>x.sourceType==='ink');const meta=JSON.parse(m.metadataJson);return meta.ink.strokes.length===2})()", "笔迹随素材保存");
  await check("(()=>{const raw=JSON.parse(localStorage.getItem('knowflick.workspace.v1'));const m=raw.materials.find(x=>x.sourceType==='ink');return m.title.includes('手写笔记')&&m.title.includes('2 笔')})()", "手写笔记标题可辨认");
  // 回执走 .ws-feedback（aria-live 区），不是底部状态栏。
  await check("document.body.innerText.includes('手写笔记已存入收件箱')", "保存后有明确回执");

  // 空画布不允许保存
  await b("click", '[aria-label="手写笔记"]');
  await check("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('保存手写笔记')).disabled===false", "空画布按钮可点但会校验");
  await b("eval", "(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.includes('保存手写笔记')).click();return true})()");
  await check("document.body.innerText.includes('还没有落笔')", "空画布保存给出可读原因");
  await b("eval", "(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='取消').click();return true})()");

  // 语音
  await b("click", '[aria-label="语音笔记"]');
  await check("!!document.querySelector('.voice-recorder')", "语音面板打开");
  await check("document.querySelector('.voice-status').textContent.includes('准备录音')", "语音面板初始为准备录音");
  await check("document.body.innerText.includes('不上传音频')", "录音说明本地处理");
  await check("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('保存语音笔记')).disabled===true", "没有录音时不能保存");
  await b("eval", "(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='取消').click();return true})()");
  await check("!document.querySelector('.voice-recorder')", "语音面板可取消");

  console.log(`Notes UI smoke: ${count} checks passed.`);
} finally { await b("close").catch(() => {}); }
