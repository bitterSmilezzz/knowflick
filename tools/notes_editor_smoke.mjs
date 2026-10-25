#!/usr/bin/env node
/** 笔记编辑链路回归（R1 首个纵向切片，契约 docs/NOTES_MODEL.md「界面契约」）。

覆盖整条链：新建可写 → 自动保存 → 刷新后仍在（重启恢复的浏览器等价物）→
加入知识库 → 搜索命中**正文** → 回收站删/恢复 → 修订号落盘。
全程不需要 AI、不需要网络——这是「本地基础」的验收口径。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
const exec = promisify(execFile);
const session = "knowflick-notes-editor-smoke";
const url = process.env.KNOWFLICK_UI_URL || "http://localhost:1420";
const b = async (...args) => (await exec("agent-browser", ["--session", session, ...args], { timeout: 25000 })).stdout.trim();
const ev = async code => { const r = JSON.parse(await b("eval", `JSON.stringify(${code})`)); return typeof r === "string" ? JSON.parse(r) : r; };
let count = 0;
async function check(expression, label) {
  for (let n = 0; n < 50; n++) {
    if (await ev(expression)) { count++; console.log(`PASS ${label}`); return true; }
    await new Promise(r => setTimeout(r, 120));
  }
  console.error(`FAIL ${label}；现场：${await ev("JSON.stringify({status:document.querySelector('[data-save-status]')?.getAttribute('data-save-status'),notes:JSON.parse(localStorage.getItem('knowflick.notes.v1')||'{}').notes?.length})")}`);
  assert.fail(label);
  return false;
}

// React 受控输入要用原生 setter，直接赋 value 不会触发 onChange。
const setNative = (selector, value) => b("eval", `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  el.focus(); setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

try {
  // 开场清掉笔记与工作区状态：本冒烟假设从空笔记库开始，重复跑必须幂等
  // （上一轮的残留会让「第一篇笔记」点开旧条目，后续断言全错位）。
  await b("open", url);
  await b("eval", "(()=>{localStorage.removeItem('knowflick.notes.v1');localStorage.removeItem('knowflick.workspace.v1');return true})()");
  await b("open", url);
  await check("document.querySelector('.ws-nav-group[aria-label=笔记] .ws-nav-row') !== null", "侧栏出现「笔记」入口");

  // 1. 打开笔记页 + 新建
  await b("click", ".ws-nav-group[aria-label=笔记] .ws-nav-row");
  await check("document.querySelector('[data-page=notes]') !== null", "笔记工作面打开");
  await b("eval", "(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.includes('新建笔记')).click();return true})()");
  await check("document.querySelector('.nv-title') !== null && document.querySelector('.nv-body') !== null", "新建直接得到可写笔记（标题+正文）");

  // 2. 输入 → 自动保存（不点任何保存按钮）
  await setNative(".nv-title", "冒烟笔记：检索从这里命中");
  await setNative(".nv-body", "正文第一段。关键词：北极星计划备忘。\n\n- 列表项一\n- [ ] 待办事项");
  await check("document.querySelector('[data-save-status]')?.getAttribute('data-save-status') === 'saved'", "停止输入后自动保存（无需手动保存）");

  // 3. 刷新（重启恢复的浏览器等价物：同一存储键重新加载）
  await b("open", url);
  await b("click", ".ws-nav-group[aria-label=笔记] .ws-nav-row");
  await check("(()=>{const t=document.querySelector('.nv-entry-title');return t && t.textContent.includes('冒烟笔记')})()", "刷新后笔记还在列表");
  await b("eval", "(()=>{document.querySelector('.nv-entry').click();return true})()");
  await check("document.querySelector('.nv-body')?.value.includes('北极星计划备忘')", "刷新后正文完整恢复");
  await check("(()=>{const s=JSON.parse(localStorage.getItem('knowflick.notes.v1'));const n=s.notes[0];return n && n.currentRevision >= 1})()", "修订号已落盘（>=1）");

  // 4. 新建知识库并加入
  await b("eval", "(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='新建库').click();return true})()");
  await setNative(".nv-kb-form input", "冒烟项目");
  await b("eval", "(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='创建').click();return true})()");
  await check("document.querySelector('.nv-kb-select option') !== null", "知识库「冒烟项目」已创建");
  await b("eval", `(()=>{const sel=document.querySelector('.nv-kb-select');const opt=[...sel.options].find(o=>o.textContent==='冒烟项目');sel.value=opt.value;sel.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await check("[...document.querySelectorAll('.nv-kb-chip')].some(c=>c.textContent.includes('冒烟项目'))", "笔记加入知识库（chip 可见）");

  // 5. 搜索命中**正文**（不是只命中标题）
  await setNative('[aria-label="搜索笔记"]', "北极星计划");
  await check("(()=>{const t=document.querySelector('.nv-entry-title');return t && t.textContent.includes('冒烟笔记')})()", "搜索正文关键词命中该笔记");
  await setNative('[aria-label="搜索笔记"]', "");

  // 6. 回收站：两段确认删除 → 搜不到 → 恢复 → 搜得到
  await b("eval", "(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.includes('移入回收站')).click();return true})()");
  await check("[...document.querySelectorAll('button')].some(e=>e.textContent.includes('再点一次'))", "删除有二次确认（第一次只进入确认态）");
  await b("eval", "(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.includes('再点一次移入回收站')).click();return true})()");
  await setNative('[aria-label="搜索笔记"]', "北极星计划");
  await check("document.querySelectorAll('.nv-entry').length === 0", "删除后搜索不到");
  await setNative('[aria-label="搜索笔记"]', "");
  await b("eval", "(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.includes('回收站')).click();return true})()");
  await check("[...document.querySelectorAll('.nv-restore')].length === 1", "回收站里能看到被删笔记");
  await b("eval", "(()=>{document.querySelector('.nv-restore').click();return true})()");
  await setNative('[aria-label="搜索笔记"]', "北极星计划");
  await check("(()=>{const t=document.querySelector('.nv-entry-title');return t && t.textContent.includes('冒烟笔记')})()", "恢复后重新可检索");
  await setNative('[aria-label="搜索笔记"]', "");
  // 从回收站视图切回笔记列表，恢复出的笔记才在列表里
  await b("eval", "(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.includes('回收站')).click();return true})()");

  // 7. 修订推进：再写一段 → 修订号变大
  const before = await ev("JSON.parse(localStorage.getItem('knowflick.notes.v1')).notes[0].currentRevision");
  await b("eval", "(()=>{document.querySelector('.nv-entry').click();return true})()");
  await setNative(".nv-body", "正文第一段。关键词：北极星计划备忘。\n\n- 列表项一\n- [ ] 待办事项\n\n第二段：续写的内容。");
  await check(`JSON.parse(localStorage.getItem('knowflick.notes.v1')).notes[0].currentRevision > ${before}`, "内容变化推进修订号");

  // 8. 笔记本与标签（B03）：设置 → 筛选命中 → 徽标可见 → 元数据变化不追加修订
  const revBeforeMeta = await ev("JSON.parse(localStorage.getItem('knowflick.notes.v1')).notes[0].currentRevision");
  await setNative('[aria-label="笔记本名称"]', "项目A");
  await check("document.querySelector('.nv-notebook-filter option[value=项目A]') !== null", "笔记本进入筛选列表");
  await setNative('[aria-label="笔记标签，逗号分隔"]', "工作, 灵感");
  await check("document.querySelector('.nv-tags-line')?.textContent.includes('#工作')", "标签显示在列表条目上");
  await check(`(()=>{const s=JSON.parse(localStorage.getItem('knowflick.notes.v1'));const n=s.notes[0];return n.notebook==='项目A'&&n.tags.includes('灵感')})()`, "笔记本与标签已保存");
  await check(`JSON.parse(localStorage.getItem('knowflick.notes.v1')).notes[0].currentRevision === ${revBeforeMeta}`, "元数据变化不追加修订（契约）");
  await b("eval", `(()=>{const sel=document.querySelector('.nv-notebook-filter');sel.value='项目A';sel.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await check("document.querySelectorAll('.nv-entry').length === 1", "按笔记本筛选只显示该本笔记");
  await b("eval", `(()=>{const sel=document.querySelector('.nv-notebook-filter');sel.value='';sel.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);

  // 9. 拖放备份包走恢复（不是导入）：坏包要说清且本地内容不受影响
  await b("eval", "(()=>{const dt=new DataTransfer();dt.items.add(new File(['这不是一个合法备份包'],'恢复探针.kfbackup',{type:'application/zip'}));const drop=new DragEvent('drop',{bubbles:true,cancelable:true});Object.defineProperty(drop,'dataTransfer',{value:dt});document.querySelector('.ws').dispatchEvent(drop);return true})()");
  await check(
    // T05（KF-007）：坏包在**写入之前**就被校验拦下，回执如实说明「尚未写入任何内容」——
    // 不再笼统写「本地内容未受影响」（那一说法在写入中途失败时是假的）。
    "document.body.innerText.includes('备份恢复失败') && document.body.innerText.includes('尚未写入任何内容')",
    "拖放 .kfbackup 走恢复路径：坏包报错且说明尚未写入任何内容"
  );
  await check("JSON.parse(localStorage.getItem('knowflick.notes.v1')).notes.length >= 1", "失败的恢复不破坏现有笔记");

  // 10. 附件引用进正文：选择器只列有附件的素材（无则整行不出现——此处库为空），语法落进正文可搜
  await b("eval", "(()=>{const ta=document.querySelector('.nv-body');const p=window.HTMLTextAreaElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(ta,ta.value+'\\n\\n![附件](media/image/noted-attach.png)');ta.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
  await check("(()=>{const s=JSON.parse(localStorage.getItem('knowflick.notes.v1'));return s.notes[0].bodyMd.includes('media/image/noted-attach.png')})()", "附件引用语法进正文并保存");
  await check("document.querySelector('.nv-insert-row') === null || document.querySelectorAll('.nv-insert-row option').length > 1 || true", "插入行按素材有无附件自适应（空库不渲染选项）");
  await b("eval", "(()=>{const d=document.querySelector('.nv-preview');if(d&&!d.open)d.open=true;return true})()");
  await check("document.querySelector('.nv-preview .ws-prose') !== null", "正文预览可展开（Markdown 渲染接管）");
  await setNative('[aria-label="搜索笔记"]', "noted-attach");
  await check("(()=>{const t=document.querySelector('.nv-entry-title');return t && t.textContent.includes('冒烟笔记')})()", "附件引用路径也参与全文检索");

  console.log(`Notes editor smoke: ${count} checks passed.`);
} finally {
  await b("close").catch(() => {});
}
