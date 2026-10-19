#!/usr/bin/env node
/** Requires the existing Vite frontend and agent-browser. Isolated browser storage only. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
const exec = promisify(execFile);
const session = "knowflick-desktop-interactions";
const url = process.env.KNOWFLICK_UI_URL || "http://localhost:1420";
let assertions = 0;
async function browser(...args) {
  return (await exec("agent-browser", ["--session", session, ...args], { timeout: 20000 })).stdout.trim();
}
async function value(js) {
  let result = JSON.parse(await browser("eval", `JSON.stringify(${js})`));
  return typeof result === "string" ? JSON.parse(result) : result;
}
async function check(js, message) {
  for (let i = 0; i < 20; i++) {
    if (await value(js)) { assertions++; console.log(`PASS ${message}`); return; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  console.error(await value('({events:window.__resizeEvents,width:innerWidth,nav:document.querySelector(".ws")?.dataset.nav,view:document.querySelector(".ws")?.dataset.view,focus:document.activeElement?.outerHTML?.slice(0,180),visibility:document.querySelector(".ws-nav")?getComputedStyle(document.querySelector(".ws-nav")).visibility:null})'));
  assert.fail(message);
}
async function drag(selector, delta) {
  const { x, y } = await value(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+150}})()`);
  await browser("mouse", "move", String(x), String(y));
  await browser("mouse", "down");
  await browser("mouse", "move", String(x + delta), String(y));
  await browser("mouse", "up");
}
try {
  await browser("set", "viewport", "1040", "760");
  await browser("open", url);
  await browser("eval", `(()=>{
    localStorage.clear();sessionStorage.clear();
    const now=Date.now();
    localStorage.setItem('knowflick.workspace.v1',JSON.stringify({cards:[],settings:null,materials:Array.from({length:70},(_,i)=>({id:'keyboard-'+i,sourceType:'manual',title:'操作验收 '+i,rawText:'阅读正文 '+i,sourceUrl:null,cleanedMarkdown:null,contentHash:'',mediaPath:null,mediaSizeBytes:0,metadataJson:'{}',inboxStatus:'inbox',createdAt:now-i,updatedAt:now-i}))}));
    return true;
  })()`);
  await browser("open", url);
  await check('document.querySelectorAll(".ws-entry").length===60', "initial batch shows sixty entries");
  await drag(".ws-resizer-nav", 40);
  await check('document.querySelector(".ws-nav").getBoundingClientRect().width===240', "real pointer drag widens navigation");
  await drag(".ws-resizer-list", 40);
  await check('document.querySelector(".ws-list").getBoundingClientRect().width===360', "real pointer drag widens list");
  await browser("open", url);
  await check('document.querySelector(".ws-nav").getBoundingClientRect().width===240 && document.querySelector(".ws-list").getBoundingClientRect().width===360', "split widths survive reload");
  await drag(".ws-resizer-list", 500);
  await check('document.querySelector(".ws-reader").getBoundingClientRect().width>=360', "resizing preserves reader width");
  await browser("dblclick", ".ws-resizer-nav");
  await browser("dblclick", ".ws-resizer-list");
  await check('document.querySelector(".ws-nav").getBoundingClientRect().width===200 && document.querySelector(".ws-list").getBoundingClientRect().width===320', "double click restores default split");
  await browser("focus", ".ws-resizer-list");
  await browser("press", "ArrowRight");
  await check('document.querySelector(".ws-list").getBoundingClientRect().width===330', "separator supports keyboard adjustment");
  await browser("dblclick", ".ws-resizer-list");
  await browser("focus", ".ws-entry");
  // One browser command to deliver actual keyboard events through focused elements.
  for (let i = 0; i < 63; i++) await browser("press", "ArrowDown");
  await check('document.querySelector(".ws-entry[aria-selected=true]").dataset.entryId==="keyboard-63" && document.activeElement===document.querySelector(".ws-entry[aria-selected=true]")', "keyboard browsing grows past first batch and moves focus");
  await check('(()=>{const a=document.querySelector(".ws-entry[aria-selected=true]").getBoundingClientRect(),b=document.querySelector(".ws-entries").getBoundingClientRect();return a.top>=b.top && a.bottom<=b.bottom})()', "keyboard-selected row scrolls into view");
  await browser("press", "Enter");
  await check('document.activeElement?.getAttribute("data-workspace-pane")==="inspector"', "Enter focuses reading pane");
  await browser("press", "Control+e");
  await check('document.activeElement?.getAttribute("aria-label")==="标题" && !!document.querySelector(".ws-editor")', "edit shortcut opens editor and focuses title");
  await browser("fill", '[aria-label="标题"]', "保留编辑中的内容");
  await browser("press", "ArrowDown");
  await check('document.querySelector(".ws-entry[aria-selected=true]").dataset.entryId==="keyboard-63"', "input arrow keys do not change selection");
  await browser("press", "Escape");
  await check('!document.querySelector(".ws-editor") && document.querySelector(".ws-reader h1").textContent==="操作验收 63"', "Escape cancels draft without overwriting original");
  await browser("press", "/");
  await check('document.activeElement?.getAttribute("aria-label")==="搜索知识库"', "slash focuses search");
  await browser("press", "Escape");
  await browser("click", '[aria-label="收起导航栏"]');
  await check('document.querySelector(".ws").dataset.nav==="collapsed" && getComputedStyle(document.querySelector(".ws-nav")).visibility==="hidden"', "manual navigation collapse works at desktop width");
  await browser("click", '[aria-label="展开导航栏"]');
  await browser("eval", 'window.__resizeEvents=[];window.addEventListener("resize",()=>window.__resizeEvents.push(innerWidth));true');
  await browser("set", "viewport", "900", "760");
  await browser("screenshot");
  await check('document.querySelector(".ws").dataset.nav==="overlay"', "explicitly reopened navigation becomes an overlay on a narrow window");
  await browser("press", "Escape");
  await check('document.querySelector(".ws").dataset.nav==="collapsed"', "Escape dismisses narrow navigation overlay");
  await browser("set", "viewport", "580", "180");
  await browser("open", `${url}/?window=capsule`);
  await check('document.activeElement?.getAttribute("aria-label")==="闪念正文"', "capsule focuses its textarea");
  await check('document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight && document.querySelector(".ws-capsule-submit").getBoundingClientRect().bottom<=innerHeight', "capsule fits its real window including save action");
  await browser("fill", ".ws-capsule-textarea", "胶囊第一行");
  await browser("press", "Shift+Enter");
  await browser("keyboard", "inserttext", "胶囊第二行");
  await check('document.querySelector(".ws-capsule-textarea").value.includes("\\n")', "Shift Enter adds a newline without submitting");
  await browser("eval", 'window.__originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new Error("模拟写入失败")};');
  await browser("press", "Enter");
  await check('document.querySelector("[role=alert]").textContent.includes("草稿已保留") && document.querySelector(".ws-capsule-textarea").value.includes("第二行")', "capsule failure displays error and retains complete draft");
  await browser("eval", 'Storage.prototype.setItem=window.__originalSetItem');
  await browser("press", "Enter");
  await check('document.querySelector(".ws-capsule-textarea").value==="" && JSON.parse(localStorage.getItem("knowflick.workspace.v1")).materials.filter(m=>m.rawText.includes("胶囊第二行")).length===1', "capsule Enter saves exactly one material");
  console.log(`Desktop interactions: ${assertions} assertions passed.`);
} finally { await browser("close").catch(() => {}); }
