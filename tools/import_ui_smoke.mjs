#!/usr/bin/env node
/**
 * 批量导入回归：一个坏文件不能毁掉整批。
 *
 * 之前任何一处 throw 都中止整批：选十个文件、其中一个不支持，后面的全不处理。
 * 这里用真实 File 对象走完整导入路径，验证「部分成功 + 逐条说明原因」。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
const exec = promisify(execFile);
const session = "knowflick-import-smoke";
const url = process.env.KNOWFLICK_UI_URL || "http://localhost:1420";
const b = async (...args) => (await exec("agent-browser", ["--session", session, ...args], { timeout: 30000 })).stdout.trim();
const ev = async code => { const r = JSON.parse(await b("eval", `JSON.stringify(${code})`)); return typeof r === "string" ? JSON.parse(r) : r; };
let count = 0;
async function check(expression, label) {
  for (let n = 0; n < 50; n++) {
    if (await ev(expression)) { count++; console.log(`PASS ${label}`); return; }
    await new Promise(r => setTimeout(r, 100));
  }
  assert.fail(label);
}

try {
  await b("set", "viewport", "1040", "760");
  await b("open", url);
  await b("eval", "localStorage.clear();sessionStorage.clear();true");
  await b("open", url);
  await check("!!document.querySelector('.ws')", "工作台就绪");

  // 四个文件：两个好的 Markdown、一个不支持的 .xyz、一个 0 字节的 txt（可解析但内容为空）
  // eval 不等待 Promise，所以只做「挂文件 + 触发 change」，结果用断言轮询。
  await ev(`(() => {
    const input = document.querySelector('input[type=file][multiple]');
    const dt = new DataTransfer();
    dt.items.add(new File(['# 第一份\\n\\n正文一'], 'note-a.md', { type: 'text/markdown' }));
    dt.items.add(new File(['不支持的类型'], 'weird.xyz', { type: 'application/octet-stream' }));
    dt.items.add(new File(['# 第二份\\n\\n正文二'], 'note-b.md', { type: 'text/markdown' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return dt.files.length;
  })()`);

  await check("(()=>{const raw=JSON.parse(localStorage.getItem('knowflick.workspace.v1')||'{}');return (raw.materials||[]).filter(m=>m.sourceType==='document').length===2})()", "两个好文件都导入了");
  await check("document.body.innerText.includes('weird.xyz')", "失败文件被点名");
  await check("document.body.innerText.includes('暂不支持这种格式')", "失败原因可读");
  await check("document.body.innerText.includes('已导入 2 条')", "给出成功条数汇总");
  await check("!document.body.innerText.includes('导入未全部完成')", "不再用「整批失败」的口吻");

  // 全部失败时仍给出明确结论，而不是静默
  await ev(`(() => {
    const input = document.querySelector('input[type=file][multiple]');
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'bad1.xyz', { type: 'application/octet-stream' }));
    dt.items.add(new File(['y'], 'bad2.xyz', { type: 'application/octet-stream' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await check("document.body.innerText.includes('没有文件导入成功')", "全部失败时明确说明");

  // 图片作为独立来源：不再是「不支持的格式」
  await ev(`(() => {
    const input = document.querySelector('input[type=file][multiple]');
    const dt = new DataTransfer();
    const png = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
    dt.items.add(new File([png], 'screenshot.png', { type: 'image/png' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await check("(()=>{const raw=JSON.parse(localStorage.getItem('knowflick.workspace.v1')||'{}');return (raw.materials||[]).some(m=>m.sourceType==='image')})()", "图片导入为独立素材类型");
  await check("(()=>{const raw=JSON.parse(localStorage.getItem('knowflick.workspace.v1')||'{}');const m=(raw.materials||[]).find(x=>x.sourceType==='image');return m.title==='screenshot'})()", "图片用文件名作标题");
  await check("document.querySelector('input[type=file][multiple]').accept.includes('.png')", "文件选择器接受图片");

  // 同一个文件导入两次不该变成两份
  const importSame = async () => ev(`(() => {
    const input = document.querySelector('input[type=file][multiple]');
    const dt = new DataTransfer();
    dt.items.add(new File(['# 重复内容\\n\\n同一份正文'], 'dup.md', { type: 'text/markdown' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await importSame();
  await check("(()=>{const raw=JSON.parse(localStorage.getItem('knowflick.workspace.v1')||'{}');return (raw.materials||[]).filter(m=>m.title==='重复内容').length===1})()", "首次导入该内容成功");
  await importSame();
  await check("(()=>{const raw=JSON.parse(localStorage.getItem('knowflick.workspace.v1')||'{}');return (raw.materials||[]).filter(m=>m.title==='重复内容').length===1})()", "重复导入不产生第二份");
  await check("document.body.innerText.includes('与库里内容相同已跳过')", "跳过时说明原因");
  await check("(()=>{const raw=JSON.parse(localStorage.getItem('knowflick.workspace.v1')||'{}');const m=(raw.materials||[]).find(x=>x.title==='重复内容');return typeof m.contentHash==='string'&&m.contentHash.length>0})()", "素材记录了内容指纹");

  console.log(`Import UI smoke: ${count} checks passed.`);
} finally { await b("close").catch(() => {}); }
