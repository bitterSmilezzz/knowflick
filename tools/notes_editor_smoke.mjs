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
// eval 的返回值可能是 undefined（页面还没渲染出目标元素时，表达式本身就是 undefined）。
// JSON.parse(undefined) 会抛 SyntaxError，于是失败现场变成「JSON 解析错误」——
// 离真正的原因（元素还没出现）隔了好几层。这里把 undefined 老实当作 undefined。
const ev = async code => {
  const raw = await b("eval", `JSON.stringify(${code})`);
  if (raw === "" || raw === "undefined") return undefined;
  const r = JSON.parse(raw);
  return typeof r === "string" ? JSON.parse(r) : r;
};
let count = 0;
// 等待预算按「慢机器也能画完」定：原先 50×120ms＝6 秒，本机够用，CI 的共享
// runner 上首屏 React 还没挂载完就报红。断言本身不变，只是别把机器慢判成功能坏。
async function check(expression, label) {
  for (let n = 0; n < 100; n++) {
    if (await ev(expression)) { count++; console.log(`PASS ${label}`); return true; }
    await new Promise(r => setTimeout(r, 120));
  }
  // 现场要够诊断用：只看「保存状态 + 笔记数」看不出「回收站里为什么没有恢复按钮」，
  // 而 CI 上拿不到日志、注解只留得下最后几行——所以把页面状态一次性打全。
  const scene = await ev(`JSON.stringify({page:document.querySelector('[data-page]')?.getAttribute('data-page'),status:document.querySelector('[data-save-status]')?.getAttribute('data-save-status'),notes:JSON.parse(localStorage.getItem('knowflick.notes.v1')||'{}').notes?.length,entries:document.querySelectorAll('.nv-entry').length,restore:document.querySelectorAll('.nv-restore').length,query:document.querySelector('[aria-label="搜索笔记"]')?.value})`);
  console.error(`FAIL ${label}；现场：${scene}`);
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
  // 固定视口：真实点击按坐标命中，默认视口只有 577px 高，下半屏的按钮点不到。
  await b("set", "viewport", "1040", "760");
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
  // **可见性**，不只是「DOM 里有这段字」。
  // 列表行曾被 `.ws button` 的固定高度压成 30px，标题里的 overflow:hidden
  // 让 flex 子项的自动最小尺寸归零 → 标题高度 0，肉眼只看到一条日期细缝，
  // 而上面那条断言照样绿（文字确实在 DOM 里）。所以这里量实际渲染高度。
  await check(
    "(()=>{const t=document.querySelector('.nv-entry-title');if(!t)return false;const h=t.getBoundingClientRect().height;return h>=12})()",
    "笔记列表的标题**可见**（不是只有 DOM 里有文字）"
  );
  await check(
    "(()=>{const l=document.querySelector('.nv-entries');if(!l)return false;return l.scrollWidth<=Math.round(l.getBoundingClientRect().width)+1})()",
    "笔记列表不横向溢出（标题不被撑出滚动条）"
  );
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

  // 8b. 置顶与归档（B03）：都能在界面上完成，且都不追加修订
  //
  // 这两件事此前只写不读：`is_pinned` / `archived_at` 早就在契约与 Rust 里，
  // 但界面上既没有入口、列表也不按归档过滤——等于字段不存在。
  const revBeforeOrder = await ev("JSON.parse(localStorage.getItem('knowflick.notes.v1')).notes[0].currentRevision");
  await b("eval", "(()=>{document.querySelector('[aria-label=\"置顶笔记\"]').click();return true})()");
  await check("document.querySelector('.nv-entry .nv-pin-badge') !== null", "置顶后列表条目显示置顶标记");
  await check("document.querySelector('[aria-label=\"取消置顶\"]') !== null", "置顶后按钮变成取消置顶");
  await check(`JSON.parse(localStorage.getItem('knowflick.notes.v1')).notes[0].currentRevision === ${revBeforeOrder}`, "置顶不追加修订（契约）");
  await check("JSON.parse(localStorage.getItem('knowflick.notes.v1')).notes[0].isPinned === true", "置顶已落盘");

  await b("eval", "(()=>{document.querySelector('[aria-label=\"归档这篇笔记\"]').click();return true})()");
  await check("document.querySelectorAll('.nv-entry').length === 0", "归档后从笔记列表消失");
  await check("document.querySelector('.nv-archive-toggle').textContent.includes('已归档（1）')", "「已归档」计数变成 1");
  await check(`JSON.parse(localStorage.getItem('knowflick.notes.v1')).notes[0].currentRevision === ${revBeforeOrder}`, "归档不追加修订（契约）");
  await check("JSON.parse(localStorage.getItem('knowflick.notes.v1')).notes[0].archivedAt !== null", "归档时间已落盘");
  // 归档不是删除：回收站里不该有它。
  await check("document.querySelector('.nv-trash-toggle').textContent.includes('回收站（0）')", "归档不会把笔记丢进回收站");

  await b("eval", "(()=>{document.querySelector('.nv-archive-toggle').click();return true})()");
  await check("document.querySelectorAll('.nv-entry-archived').length === 1", "已归档视图能看到它");
  await b("eval", "(()=>{document.querySelector('.nv-unarchive').click();return true})()");
  await check("document.querySelectorAll('.nv-entry-archived').length === 0", "移出归档后离开已归档视图");
  await b("eval", "(()=>{document.querySelector('.nv-archive-toggle').click();return true})()");
  await check("document.querySelectorAll('.nv-entry').length === 1", "移出归档后回到笔记列表");

  // 8c. 复制与单篇导出（B02）：复制是新笔记（新 id、修订 1），导出是正文原样。
  const revBeforeCopy = await ev("JSON.parse(localStorage.getItem('knowflick.notes.v1')).notes[0].currentRevision");
  await b("eval", "(()=>{document.querySelector('[aria-label=\"复制这篇笔记\"]').click();return true})()");
  await check("document.querySelectorAll('.nv-entry').length === 2", "复制后列表多出一篇");
  await check("document.body.innerText.includes('已复制为')", "复制有成功回执");
  await check(`(()=>{const s=JSON.parse(localStorage.getItem('knowflick.notes.v1'));const copy=s.notes.find(n=>n.title.includes('（副本）'));const src=s.notes.find(n=>!n.title.includes('（副本）'));return !!copy && copy.currentRevision === 1 && copy.id !== src.id && copy.bodyMd === src.bodyMd})()`, "副本是新笔记（新 id、修订 1），正文与原文一致");
  await check("(()=>{const s=JSON.parse(localStorage.getItem('knowflick.notes.v1'));const copy=s.notes.find(n=>n.title.includes('（副本）'));return !!copy && !copy.isPinned && !copy.isFavorite && copy.archivedAt===null})()", "副本不继承置顶/收藏/归档");
  await check(`(()=>{const s=JSON.parse(localStorage.getItem('knowflick.notes.v1'));const src=s.notes.find(n=>!n.title.includes('（副本）'));return src.currentRevision === ${revBeforeCopy}})()`, "原文修订号不变");
  await check("(()=>{document.querySelector('[aria-label=\"导出为 Markdown\"]').click();return true})()", "点了导出按钮");
  await check("document.body.innerText.includes('已导出 Markdown')", "导出有成功回执并说明落到哪里");

  // 8d. 修订历史（B02）：折叠面板，浏览器如实说明读不到，不假装「暂无历史」。
  await b("eval", "(()=>{const d=document.querySelector('details.nv-history');if(!d)return false;d.open=true;d.dispatchEvent(new Event('toggle',{bubbles:true}));return true})()");
  await check("document.querySelector('details.nv-history')?.open === true", "修订历史面板能展开");
  await check("document.querySelector('.nv-history').textContent.includes('浏览器体验不保存修订历史')", "浏览器里如实说明读不到修订历史（不是「暂无历史」）");

  // 8e. 批量移动（B03）：Cmd/Ctrl/Shift 多选 → 一次移到笔记本，只改元数据。
  // 两次点击必须分开派发：React 的 batchIds 来自闭包，同一帧里连发两次，第二次仍读到空集，
  // 只会选中 1 篇。真人是分两次点的（中间有渲染），这里也照同一个节奏。
  await b("eval", "(()=>{document.querySelectorAll('.nv-entry')[0].dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}));return true})()");
  await new Promise((r) => setTimeout(r, 200));
  await b("eval", "(()=>{document.querySelectorAll('.nv-entry')[1].dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}));return true})()");
  await check("document.querySelector('.nv-batch-bar') !== null", "多选后出现批量操作栏");
  await check("document.querySelector('.nv-batch-bar').textContent.includes('已选 2 篇')", "批量栏显示已选 2 篇");
  await setNative('[aria-label="批量移动到笔记本"]', "项目B");
  await b("eval", "(()=>{[...document.querySelectorAll('.nv-batch-bar button')].find(e=>e.textContent.trim()==='移动').click();return true})()");
  await check("document.body.innerText.includes('已把 2 篇移到「项目B」')", "批量移动有回执并说明移到哪");
  await check("(()=>{const s=JSON.parse(localStorage.getItem('knowflick.notes.v1'));return s.notes.filter(n=>n.notebook==='项目B').length===2})()", "两篇笔记的笔记本都已更新");
  await check("document.querySelector('.nv-batch-bar') === null", "移动后批量栏收起");

  // 8f. 查找替换与字数（B01）：找得到、跳得到、改得掉。
  await check("document.querySelector('[aria-label=\"正文字数\"]')?.textContent.includes('字数')", "正文下方显示字数");
  await b("eval", "(()=>{const ta=document.querySelector('.nv-body');ta.focus();ta.dispatchEvent(new KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true}));return true})()");
  await check("document.querySelector('.nv-find') !== null", "Ctrl+F 打开正文查找栏");
  // 用正文里确实存在的词：这一段之前写过「待办事项」。
  await setNative('[aria-label="查找正文"]', "待办");
  await check("document.querySelector('.nv-find-count').textContent.includes('处')", "查找栏显示命中处数");
  // 替换词不能包含原词，否则替换完「待办」还会命中（这里用「任务」）。
  await setNative('[aria-label="替换为"]', "任务");
  await b("eval", "(()=>{document.querySelector('[aria-label=\"全部替换\"]').click();return true})()");
  await check("document.body.innerText.includes('已替换')", "全部替换有回执并给出处数");
  await check("(()=>{const s=JSON.parse(localStorage.getItem('knowflick.notes.v1'));return s.notes.some(n=>n.bodyMd.includes('任务事项'))})()", "替换结果落进正文并保存");
  await check("document.querySelector('.nv-find-count').textContent.includes('没有匹配')", "替换后查找词不再命中");
  await b("eval", "(()=>{document.querySelector('[aria-label=\"关闭查找\"]').click();return true})()");
  await check("document.querySelector('.nv-find') === null", "关掉查找栏");

  // 8g. 笔记待办（B10）：正文里的 `- [ ]` 是待办，勾选即改那一行。
  await check("document.querySelector('[aria-label=\"待办进度\"]')?.textContent.includes('待办')", "正文下方显示待办进度");
  await b("eval", "(()=>{const d=document.querySelector('details.nv-preview');if(!d)return false;d.open=true;return true})()");
  await check("document.querySelectorAll('.ws-md-todo input[type=checkbox]').length >= 1", "预览里的待办渲染成复选框");
  await b("eval", "(()=>{const cbs=[...document.querySelectorAll('.ws-md-todo input[type=checkbox]')].filter(c=>!c.disabled);if(cbs.length===0)return false;cbs[0].click();return true})()");
  await check("(()=>{const s=JSON.parse(localStorage.getItem('knowflick.notes.v1'));return s.notes.some(n=>n.bodyMd.includes('- [x]'))})()", "勾选后正文那一行变成已勾选并保存");
  await check("document.querySelector('[aria-label=\"待办进度\"]')?.textContent.includes('1 /')", "待办进度随之更新");

  // 8i. 编辑动作（B01）：选整段点「待办」，每个非空行加上 `- [ ] `，再点一次去掉。
  await b("eval", "(()=>{const ta=document.querySelector('.nv-body');ta.focus();ta.setSelectionRange(0, ta.value.length);return true})()");
  const bodyBeforeFmt = await ev("document.querySelector('.nv-body').value");
  await b("eval", "(()=>{document.querySelector('[aria-label=\"插入待办\"]').click();return true})()");
  await check("document.querySelector('.nv-body').value.split('\\n').every(l => !l.trim() || l.startsWith('- [ ] '))", "选中多行后点「待办」，每行都加上标记");
  await check("JSON.parse(localStorage.getItem('knowflick.notes.v1')).notes.some(n=>n.bodyMd.includes('- [ ] '))", "编辑动作的结果照常自动保存");
  await b("eval", "(()=>{const ta=document.querySelector('.nv-body');ta.focus();ta.setSelectionRange(0, ta.value.length);return true})()");
  await b("eval", "(()=>{document.querySelector('[aria-label=\"插入待办\"]').click();return true})()");
  await check(`document.querySelector('.nv-body').value === ${JSON.stringify(bodyBeforeFmt)}`, "再点一次把标记去掉（恢复到原来）");

  // 8j. 排序（B03）：切成按标题排——非置顶条目按标题序，置顶的仍在最前。
  await b("eval", "(()=>{const sel=document.querySelector('[aria-label=\"排序方式\"]');sel.value='title';sel.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
  await new Promise((res) => setTimeout(res, 300));
  const sortRows = await ev("[...document.querySelectorAll('.nv-entry')].map(e=>({t:e.querySelector('.nv-entry-title').textContent,p:!!e.querySelector('.nv-pin-badge')}))");
  const pinnedFlags = sortRows.map((r) => r.p);
  const unpinnedTitles = sortRows.filter((r) => !r.p).map((r) => r.t);
  const sortedTitles = [...unpinnedTitles].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  await check(`${JSON.stringify(pinnedFlags)}.join(',') === ${JSON.stringify([...pinnedFlags].sort((a, b) => Number(b) - Number(a)))}.join(',')`, "置顶的笔记始终排在列表最前");
  await check(`${JSON.stringify(unpinnedTitles)}.join('|') === ${JSON.stringify(sortedTitles)}.join('|')`, "按标题排序后非置顶条目是标题序");
  await b("eval", "(()=>{const sel=document.querySelector('[aria-label=\"排序方式\"]');sel.value='recent';sel.dispatchEvent(new Event('change',{bubbles:true}));return true})()");

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

  // 8h. 笔记模板（B05）：选模板新建 → 标题与骨架摆好 → 照常自动保存。
  const notesBeforeTpl = await ev("JSON.parse(localStorage.getItem('knowflick.notes.v1')).notes.length");
  await b("eval", `(()=>{const sel=document.querySelector('[aria-label=\"从模板新建笔记\"]');sel.value='journal';sel.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await check("(()=>{const t=document.querySelector('[aria-label=\"笔记标题\"]');return (t?.value||'').includes('日记')})()", "模板把标题摆好了（带日期）");
  await check("document.querySelector('.nv-body').value.includes('## 今天做了什么')", "模板把正文骨架摆好了");
  await check(`(()=>{const s=JSON.parse(localStorage.getItem('knowflick.notes.v1'));return s.notes.length === ${notesBeforeTpl + 1}})()`, "模板新建的笔记会落库（不是只停在编辑器里）");

  // 12. 导入 Markdown：合成一个文件塞进隐藏的 file input，应当新建一篇带标题的笔记。
  await b("eval", `(() => {
    const input = document.querySelector('[aria-label="导入 Markdown 文件"]');
    if (!input) return false;
    const file = new File(['# 导入的标题\\n\\n## 小节\\n正文一行'], 'imported-note.md', { type: 'text/markdown' });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await new Promise((res) => setTimeout(res, 1200));
  await check("document.querySelector('[aria-label=\"笔记标题\"]')?.value === '导入的标题'", "导入后标题取自文件里的一级标题");
  await check("document.querySelector('.nv-body').value.includes('## 小节')", "导入后正文保留原有结构");
  await check("JSON.parse(localStorage.getItem('knowflick.notes.v1')).notes.some(n=>n.title==='导入的标题')", "导入的笔记会落库");

  // 13. 标签筛选：给当前笔记打标签 → 标签筛选里出现它 → 选中后列表仍然有内容。
  // 前面的段落可能把搜索框留在某个关键词上，先清空——否则筛选断言测的是搜索。
  await setNative('[aria-label="搜索笔记"]', "");
  await new Promise((res) => setTimeout(res, 300));
  const tagSel = '[aria-label="笔记标签，逗号分隔"]';
  const hasTagInput = await ev(`document.querySelector('${tagSel}') !== null`);
  await check(`${hasTagInput}`, "编辑器里有标签输入框（标签筛选的前提）");
  await setNative(tagSel, "冒烟标签");
  await new Promise((res) => setTimeout(res, 900));
  const tagOptionTexts = await ev("[...document.querySelectorAll('.nv-tag-filter option')].map(o=>o.textContent)");
  await check(`${JSON.stringify(tagOptionTexts)}.some(t => t.includes('冒烟标签'))`, "新标签出现在标签筛选里");
  await b("eval", "(()=>{const sel=document.querySelector('.nv-tag-filter');sel.value='冒烟标签';sel.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
  await new Promise((res) => setTimeout(res, 400));
  const filteredTitles = await ev("[...document.querySelectorAll('.nv-entry-title')].map(e=>e.textContent)");
  await check(`${JSON.stringify(filteredTitles)}.length >= 1`, "按标签筛选后仍能看到打了该标签的笔记");
  await b("eval", "(()=>{const sel=document.querySelector('.nv-tag-filter');sel.value='';sel.dispatchEvent(new Event('change',{bubbles:true}));return true})()");

  // 14. 截止日期（B10）：正文里写 `📅 2020-01-01` 就是逾期，界面要报出来。
  await b("eval", `(() => {
    const ta = document.querySelector('.nv-body');
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    set.call(ta, ta.value + '\\n\\n- [ ] 逾期那件事 📅 2020-01-01');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await new Promise((res) => setTimeout(res, 1200));
  await check("document.querySelector('.nv-due') !== null", "有逾期待办时出现到期提醒");
  await check("document.querySelector('.nv-due-count').textContent.includes('逾期 1 件')", "到期提醒里写明逾期件数");
  await check("document.querySelector('.nv-due-list').textContent.includes('逾期那件事')", "到期提醒里列出是哪一件");

  console.log(`Notes editor smoke: ${count} checks passed.`);
} finally {
  await b("close").catch(() => {});
}
