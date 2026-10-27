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
    const input = document.querySelector('input[data-role=import-files]');
    const dt = new DataTransfer();
    dt.items.add(new File(['# 第一份' + String.fromCharCode(10, 10) + '北极星项目的周报：本周完成了检索模块的性能优化。' + String.fromCharCode(10, 10) + '万条数据下延迟从 33ms 降到 13.6ms，这是页内计时口径。' + String.fromCharCode(10, 10) + '下周开始做语义索引，先覆盖中英混合语料。' + String.fromCharCode(10, 10) + '另外记录一下构建产物体积的变化，供后续对照。'], 'note-a.md', { type: 'text/markdown' }));
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
  // R2 导入向导：转换报告持久化——刷新后还能回看（不再是转瞬即逝的提示条）
  await check("document.querySelector('.nv-import-report') !== null", "导入报告出现在侧栏");
  await check("document.body.innerText.includes('weird.xyz（暂不支持这种格式）') || [...document.querySelectorAll('.nv-report-failed')].some(e=>e.textContent.includes('weird.xyz'))", "报告含失败项与原因");
  await b("eval", "location.reload(); true");
  await new Promise((r) => setTimeout(r, 1200));
  await check("document.querySelector('.nv-import-report') !== null", "刷新后报告仍在（持久化）");
  await check("[...document.querySelectorAll('.nv-report-ok')].some(e=>e.textContent.includes('第一份'))", "报告含成功条目（按素材标题）");
  // C04 近似重复候选：导入与库内文字相近的内容 → 只提示、不自动删
  await ev(`(() => {
    const input = document.querySelector('input[data-role=import-files]');
    const dt = new DataTransfer();
    dt.items.add(new File(['# 近似改写' + String.fromCharCode(10, 10) + '北极星项目的周报：本周完成了检索方面的性能优化工作。' + String.fromCharCode(10, 10) + '万条记录下延迟从 33ms 降至 13.6ms，这是页内计时的口径。' + String.fromCharCode(10, 10) + '下周开始做语义索引，先覆盖中英混合的语料。'], 'near.md', { type: 'text/markdown' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await check("document.body.innerText.includes('疑似近似重复') && document.body.innerText.includes('未自动删除')", "近似重复只提示不自动删");
  await check("!document.body.innerText.includes('导入未全部完成')", "不再用「整批失败」的口吻");

  // 全部失败时仍给出明确结论，而不是静默
  await ev(`(() => {
    const input = document.querySelector('input[data-role=import-files]');
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'bad1.xyz', { type: 'application/octet-stream' }));
    dt.items.add(new File(['y'], 'bad2.xyz', { type: 'application/octet-stream' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await check("document.body.innerText.includes('没有文件导入成功')", "全部失败时明确说明");
  // 「重新读取」只对**读取失败**有意义。导入失败时挂那个按钮会误导：
  // 用户点了只会重载库，与他的问题无关，还打断当前操作。
  await check(
    "![...document.querySelectorAll('.ws-feedback button')].some(b => b.textContent.includes('重新读取'))",
    "导入失败时不提供「重新读取」（那是读取失败才有的出口）",
  );

  // 图片作为独立来源：不再是「不支持的格式」
  await ev(`(() => {
    const input = document.querySelector('input[data-role=import-files]');
    const dt = new DataTransfer();
    const png = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
    dt.items.add(new File([png], 'screenshot.png', { type: 'image/png' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await check("(()=>{const raw=JSON.parse(localStorage.getItem('knowflick.workspace.v1')||'{}');return (raw.materials||[]).some(m=>m.sourceType==='image')})()", "图片导入为独立素材类型");
  await check("(()=>{const raw=JSON.parse(localStorage.getItem('knowflick.workspace.v1')||'{}');const m=(raw.materials||[]).find(x=>x.sourceType==='image');return m.title==='screenshot'})()", "图片用文件名作标题");
  await check("document.querySelector('input[data-role=import-files]').accept.includes('.png')", "文件选择器接受图片");

  // 同一个文件导入两次不该变成两份
  const importSame = async () => ev(`(() => {
    const input = document.querySelector('input[data-role=import-files]');
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

  // PPT 是用户明确列出的来源之一，之前根本不在支持列表
  await check("document.querySelector('input[data-role=import-files]').accept.includes('.pptx')", "文件选择器接受 PPT");
  await ev(`(() => {
    // 手工构造一个 stored ZIP 当成最小 PPTX
    const enc = new TextEncoder();
    const entries = [
      ['ppt/slides/slide1.xml', '<p:sld><a:t>季度复盘</a:t></p:sld>'],
      ['ppt/slides/slide2.xml', '<p:sld><a:t>下一步计划</a:t></p:sld>'],
    ];
    const chunks = [];
    for (const [name, content] of entries) {
      const nameBytes = enc.encode(name);
      const data = enc.encode(content);
      const header = new Uint8Array(30 + nameBytes.length);
      const view = new DataView(header.buffer);
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(8, 0, true);
      view.setUint32(18, data.length, true);
      view.setUint32(22, data.length, true);
      view.setUint16(26, nameBytes.length, true);
      header.set(nameBytes, 30);
      chunks.push(header, data);
    }
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { out.set(c, offset); offset += c.length; }
    const input = document.querySelector('input[data-role=import-files]');
    const dt = new DataTransfer();
    dt.items.add(new File([out], 'deck.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await check("(()=>{const raw=JSON.parse(localStorage.getItem('knowflick.workspace.v1')||'{}');return (raw.materials||[]).some(m=>m.title==='季度复盘')})()", "PPT 被解析成素材");
  await check("(()=>{const raw=JSON.parse(localStorage.getItem('knowflick.workspace.v1')||'{}');const m=(raw.materials||[]).find(x=>x.title==='季度复盘');return m.rawText.includes('第 1 页')&&m.rawText.includes('下一步计划')})()", "PPT 按页提取文字");

  // 只有素材、没有卡片的旧版备份：素材已落库就不能再报「导入失败」
  await ev(`(() => {
    const input = document.querySelector('input[data-role=import-files]');
    const dt = new DataTransfer();
    const payload = JSON.stringify({ format: "knowflick-workspace", version: 1, materials: [{
      id: "legacy-m", sourceType: "web", title: "旧备份里的素材", sourceUrl: null,
      rawText: "旧素材正文", contentHash: "", metadataJson: "{}", inboxStatus: "inbox",
      createdAt: 1700000000000, updatedAt: 1700000000000,
    }] });
    dt.items.add(new File([payload], "legacy-backup.json", { type: "application/json" }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await check("(()=>{const raw=JSON.parse(localStorage.getItem('knowflick.workspace.v1')||'{}');return (raw.materials||[]).some(m=>m.id==='legacy-m')})()", "素材型备份已落库");
  await check("!document.body.innerText.includes('JSON 文件须包含卡片数组')", "不因缺少卡片数组而报失败");
  await check("!document.body.innerText.includes('没有文件导入成功')", "素材型备份整体算成功");

  // 浏览器体验里大图会把唯一的 localStorage key 撑爆，必须明确拒绝
  await ev(`(() => {
    const input = document.querySelector('input[data-role=import-files]');
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(1536 * 1024)], 'huge.png', { type: 'image/png' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await check("document.body.innerText.includes('1 MB 以内的图片')", "浏览器模式明确拒绝超大图片");
  await check("(()=>{const raw=JSON.parse(localStorage.getItem('knowflick.workspace.v1')||'{}');return !(raw.materials||[]).some(m=>m.title==='huge')})()", "超大图片没有落库");
  await check("(()=>{const raw=JSON.parse(localStorage.getItem('knowflick.workspace.v1')||'{}');return (raw.materials||[]).length>0})()", "拒绝大图不影响已有内容");

  // .eml 邮件文件：导回知识库是「数据完全归你所有」的自然一环
  const emlBody = [
    "From: zhangsan@example.com",
    "To: lisi@example.com",
    "Subject: =?UTF-8?B?" + btoa(unescape(encodeURIComponent("季度报告"))) + "?=",
    "Date: Tue, 21 Oct 2026 08:30:00 +0800",
    "Message-ID: <eml-probe@example.com>",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    btoa(unescape(encodeURIComponent("这是邮件正文内容。"))),
  ].join("\n");
  await b("eval", `(() => {
    const bin = atob(${JSON.stringify(btoa(unescape(encodeURIComponent(emlBody))))});
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const file = new File([arr], "probe.eml", { type: "message/rfc822" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('input[data-role=import-files]');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 1200));
  await check(
    "(() => { const m = (JSON.parse(localStorage.getItem('knowflick.workspace.v1')).materials || []).find(x => x.sourceType === 'email'); return !!m; })()",
    ".eml 邮件被导入成邮件素材"
  );
  await check(
    "(() => { const m = (JSON.parse(localStorage.getItem('knowflick.workspace.v1')).materials || []).find(x => x.sourceType === 'email'); return !!m && m.title === '季度报告'; })()",
    ".eml 的 RFC 2047 主题被解出来"
  );
  await check(
    "(() => { const m = (JSON.parse(localStorage.getItem('knowflick.workspace.v1')).materials || []).find(x => x.sourceType === 'email'); return !!m && m.rawText.includes('这是邮件正文内容'); })()",
    ".eml 的 base64 正文被解出来"
  );

  // 图片 MIME：浏览器的 File.type 不总是有值（HEIC 尤其常见），
  // 给空时若一律当成 PNG，JPEG/HEIC 会以 .png 落盘——内容与扩展名不符。
  for (const [name, ext, expected] of [["照片", "jpg", "image/jpeg"], ["截图", "heic", "image/heic"]]) {
    const b64 = await b("eval", `(() => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
      let bin = "";
      for (const b of bytes) bin += String.fromCharCode(b);
      return btoa(bin);
    })()`);
    const fired = await b("eval", `(() => {
      const bin = atob(${b64});
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const file = new File([arr], ${JSON.stringify(name + "." + ext)}, { type: "" });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.querySelector('input[data-role=import-files]');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    assert.ok(String(fired).includes("true"), "图片导入应被触发");
    await new Promise((r) => setTimeout(r, 900));
    const got = await b("eval", `(() => { const m = (JSON.parse(localStorage.getItem('knowflick.workspace.v1')).materials || []).find(x => x.title === ${JSON.stringify(name)}); return m ? JSON.parse(m.metadataJson).mime : null; })()`);
    assert.equal(String(got).replace(/^"|"$/g, ""), expected, `.${ext} 在浏览器不给 MIME 时应推断为 ${expected}，实际 ${got}`);
  }
  count++;
  console.log("PASS 图片在浏览器不给 MIME 时按扩展名推断");

  console.log(`Import UI smoke: ${count} checks passed.`);
} finally { await b("close").catch(() => {}); }
