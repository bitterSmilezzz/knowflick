#!/usr/bin/env node
/**
 * Browser UI regression for the KnowFlick workspace against the same React entry
 * the desktop client renders. Requires an already-running Vite dev server
 * (KNOWFLICK_UI_URL, default http://localhost:1420) and agent-browser.
 *
 * Uses a dedicated browser session; it only clears that session's own storage and
 * never touches the desktop library under Application Support.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";

const exec = promisify(execFile);
const session = "knowflick-workspace-regression";
const url = process.env.KNOWFLICK_UI_URL || "http://localhost:1420";

async function browser(...args) {
  const { stdout } = await exec("agent-browser", ["--session", session, ...args], { timeout: 20000 });
  return stdout.trim();
}
async function evaluate(code) {
  const out = await browser("eval", `JSON.stringify(${code})`);
  const parsed = JSON.parse(out);
  return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
}
async function check(expression, label) {
  for (let n = 0; n < 30; n++) {
    if (await evaluate(expression)) {
      console.log(`PASS ${label}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(label);
}
async function clickButton(text) {
  await browser(
    "eval",
    `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim().includes(${JSON.stringify(
      text
    )}));if(!b)throw new Error('missing button');b.click();return true})()`
  );
}

try {
  await browser("open", url);
  await browser("eval", "localStorage.clear();sessionStorage.clear()");
  await browser("open", url);

  await check('document.querySelectorAll("[data-workspace-pane]").length === 3', "three desktop panes render");
  await check(
    'getComputedStyle(document.querySelector(".ws")).gridTemplateColumns.split(" ").length === 3',
    "grid resolves to three columns"
  );
  await check(
    'parseFloat(getComputedStyle(document.querySelector(".ws")).fontSize) >= 12 && parseFloat(getComputedStyle(document.querySelector(".ws-prose")||document.body).fontSize) >= 14',
    "base type is at least 12px"
  );
  await check('document.documentElement.scrollWidth <= innerWidth', "no horizontal page overflow");

  // Capture
  await browser("click", ".ws-capture");
  await check('!!document.querySelector("dialog[open]")', "capture opens as an in-window dialog");
  await browser("fill", '.ws-dialog input[type="text"]', "界面回归记录");
  await browser("fill", '.ws-dialog textarea', "原始素材包含中文检索关键词：记忆。用于验证正文编辑与刷新后的持久化。");
  await browser("click", '.ws-dialog button[type="submit"]');
  await check('document.querySelector(".ws-reader h1")?.textContent === "界面回归记录"', "capture lands in the reader");

  // Edit + reload persistence
  await browser("click", '[aria-label="编辑"]');
  await browser("fill", '.ws-editor textarea[aria-label="正文"]', "修改后的正文：记忆与知识管理，刷新后仍然存在。");
  await browser("click", '.ws-editor button[type="submit"]');
  await check('document.body.innerText.includes("修改已保存")', "editor save is reachable and reports success");
  await browser("open", url);
  await check('document.querySelector(".ws-prose")?.textContent.includes("修改后的正文")', "edited body survives reload");

  // 语音转写入口存在，但插件默认关闭时必须是禁用态
  await check('!!document.querySelector(\'[aria-label="语音转写"]\')', "top bar exposes the speech entry");
  await check(
    'document.querySelector(\'[aria-label="语音转写"]\').disabled === true && document.querySelector(\'[aria-label="语音转写"]\').title.includes("插件未启用")',
    "speech entry is disabled while its plugin is off"
  );

  // Material -> card
  await clickButton("保存为知识卡");
  await check(
    'JSON.parse(localStorage.getItem("knowflick.workspace.v1")).cards.some(c=>c.materialId && c.headline.includes("界面回归记录"))',
    "material converts into a linked card"
  );
  await browser("click", '[aria-label="收藏此卡片"]');
  await check(
    'JSON.parse(localStorage.getItem("knowflick.workspace.v1")).cards[0].isFavorite === true',
    "favorite persists"
  );

  // Search
  await browser("fill", '[aria-label="搜索知识库"]', "记忆");
  await check('document.querySelectorAll(".ws-entry").length === 1', "two-character Chinese search matches");
  await browser("fill", '[aria-label="搜索知识库"]', "不匹配的词语");
  await check('document.body.innerText.includes("没有找到匹配内容")', "honest no-results state");
  await browser("fill", '[aria-label="搜索知识库"]', "");

  // Archive round trip
  await browser("click", '.ws-nav-row[aria-current="page"]');
  await clickButton("全部知识");
  await check('document.querySelectorAll(".ws-entry").length >= 1', "library lists the new card");
  await browser("fill", '[aria-label="搜索知识库"]', "界面回归");
  await browser("click", ".ws-entry");
  const archiveLabel = await evaluate(
    '(document.querySelector(\'[aria-label="归档素材"]\')||document.querySelector(\'[aria-label="移回收件箱"]\'))?.getAttribute("aria-label") ?? ""'
  );
  if (archiveLabel.includes("归档")) {
    await browser("click", '[aria-label="归档素材"]');
    await check('document.body.innerText.includes("已归档")', "archiving reports where the material went");
  }
  await browser("fill", '[aria-label="搜索知识库"]', "");

  // Settings: three appearance options and module toggle
  await clickButton("设置");
  await check('!!document.querySelector(\'[data-page="settings"]\')', "settings page renders");
  const options = await evaluate(
    '[...document.querySelectorAll(\'[data-group="appearance"] select option\')].map(o=>o.textContent.trim())'
  );
  assert.deepEqual(options, ["跟随系统", "浅色", "深色"], "appearance has exactly three options");
  console.log("PASS appearance offers exactly three options");
  // 操作音效开关：跨端共享设置，工作台此前只存不用、也没有入口
  await check('!!document.querySelector(\'[aria-label="操作音效"]\')', "设置页有操作音效开关");
  await browser("eval", "(() => { const el = document.querySelector('[aria-label=\"操作音效\"]'); if (el) el.click(); return !!el; })()");
  await new Promise((r) => setTimeout(r, 250));
  await check(
    "document.querySelector('[aria-label=\"操作音效\"]').checked === false",
    "音效开关可以关掉"
  );
  await browser("select", '[data-group="appearance"] select', "DARK");
  // 温故复习现在是 official-review-fsrs 插件，用它的稳定选择器点名，别落到插件矩阵第一行
  await browser("check", '[data-plugin-toggle="official-review-fsrs"]');
  await browser("click", ".ws-settings-foot button[type=submit]");
  await check('document.body.innerText.includes("设置已成功保存")', "settings save is reachable and reports success");
  // 开关必须真的落盘，只改界面不改设置等于没接
  await check(
    "JSON.parse(JSON.parse(localStorage.getItem('knowflick.workspace.v1')).settings).soundEffectsEnabled === false",
    "音效开关写入设置"
  );
  await check('document.querySelector(".ws").dataset.appearance === "dark"', "dark theme applies immediately");
  await browser("open", url);
  await check(
    'document.querySelector(".ws").dataset.appearance === "dark" && document.body.innerText.includes("温故复习")',
    "dark theme and review module survive reload"
  );

  // Failure path keeps the draft
  await browser("click", ".ws-capture");
  await browser("fill", ".ws-dialog textarea", "失败时应保留这段草稿");
  await browser(
    "eval",
    'window.__smokeSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new Error("验收模拟：磁盘空间不足")};'
  );
  await browser("click", '.ws-dialog button[type="submit"]');
  await check(
    'document.querySelector("dialog[open] [role=alert]")?.textContent.includes("磁盘空间不足") && document.querySelector(".ws-dialog textarea").value.includes("保留这段草稿")',
    "save failure keeps the draft and shows the reason"
  );
  await browser("eval", "Storage.prototype.setItem=window.__smokeSetItem");
  await browser("press", "Escape");
  await check('!document.querySelector("dialog[open]")', "Escape closes capture");

  // Narrow window collapses the nav instead of squeezing three panes
  await browser("set", "viewport", "900", "760");
  await browser("screenshot");
  await check(
    'getComputedStyle(document.querySelector(".ws-nav")).visibility === "hidden"',
    "narrow window collapses the navigation"
  );
  await browser("click", '[aria-label="展开导航栏"]');
  await check('document.querySelector(".ws").dataset.nav === "overlay"', "navigation can be reopened on narrow windows");
  await browser("press", "Escape");
  await browser("set", "viewport", "1040", "760");

  // 归档的语义：处理完了 ≠ 讨厌这个来源。
  // 归档曾被写成 dismissed，而来源洞察把 dismissed 当负面信号降权——
  // 于是用户只是归档了一份邮件，这个发件人就被降权了。
  await check(
    `(() => { const raw = JSON.parse(localStorage.getItem('knowflick.workspace.v1'));
      const m = (raw.materials || []).find(x => x.inboxStatus !== 'inbox');
      return !!m && m.inboxStatus === 'processed'; })()`,
    "归档用 processed 而不是 dismissed（处理完 ≠ 讨厌来源）"
  );
  await check(
    "!document.body.innerText.includes('素材已归档')",
    "归档后不谎称状态名（归档≠忽略）"
  );

  // 订阅来源在收件箱里要认得出来（否则「来源」只是入口，不是可用的维度）
  await browser("eval", `(() => {
    const raw = JSON.parse(localStorage.getItem('knowflick.workspace.v1') || '{}');
    const now = Date.now();
    raw.materials = (raw.materials || []).concat([1, 2].map(i => ({
      id: 'sub-src-' + i, sourceType: 'web', title: '订阅文章 ' + i,
      sourceUrl: 'https://feed.example.com/p' + i, rawText: '订阅正文 ' + i,
      contentHash: '', metadataJson: JSON.stringify({ subscriptionId: 'sub-1' }),
      inboxStatus: 'inbox', createdAt: now - i * 1000, updatedAt: now - i * 1000,
    })));
    localStorage.setItem('knowflick.workspace.v1', JSON.stringify(raw));
    return true;
  })()`);
  await browser("open", url);
  await new Promise((r) => setTimeout(r, 800));
  await clickButton("收件箱");
  await new Promise((r) => setTimeout(r, 500));
  await check(
    "[...document.querySelectorAll('.ws-entry-source')].some(e => e.textContent.includes('订阅'))",
    "收件箱能认出订阅来源"
  );
  await check(
    "[...document.querySelectorAll('button')].some(b => b.textContent.trim() === '订阅')",
    "能按订阅来源筛选"
  );
  // 筛出来还要能处理：订阅会持续进货，不能只筛不整理
  await browser("eval", `(() => {
    const tab = [...document.querySelectorAll('.ws-filter-tabs button')].find(b => b.textContent.trim() === '订阅');
    if (tab) tab.click();
    return !!tab;
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  await browser("eval", "(() => { const r = [...document.querySelectorAll('.ws-entry')][0]; if (r) r.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); return true; })()");
  await new Promise((r) => setTimeout(r, 350));
  await browser("eval", "(() => { const r = [...document.querySelectorAll('.ws-entry')][1]; if (r) r.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })); return true; })()");
  await new Promise((r) => setTimeout(r, 400));
  await check("!!document.querySelector('[aria-label=\"批量操作\"]')", "多选订阅素材也出现批量栏");
  await check(
    "[...document.querySelectorAll('button')].some(b => b.textContent.includes('归档'))",
    "订阅素材可批量归档"
  );
  await check('!!document.querySelector(\'[aria-label="导出选中内容"]\')', "多选后可导出选中内容");
  // 导出走浏览器下载，这里只验证点击不抛错并有回执
  await browser("eval", "window.__kfExportError = null; window.addEventListener('error', e => { window.__kfExportError = String(e.message); }); true");
  await browser("eval", "(document.querySelector('[aria-label=\"导出选中内容\"]')||{}).click?.(); true");
  await new Promise((r) => setTimeout(r, 700));
  await check("window.__kfExportError === null", "导出选中不抛错");
  await check("document.body.innerText.includes('已导出')", "导出选中给出回执");
  const inboxBefore = await evaluate(
    "((JSON.parse(localStorage.getItem('knowflick.workspace.v1')||'{}').materials)||[]).filter(m=>m.inboxStatus==='inbox').length"
  );
  await browser("eval", "(document.querySelector('[aria-label=\"批量归档素材\"]')||{}).click?.(); true");
  await new Promise((r) => setTimeout(r, 700));
  await check(
    `((JSON.parse(localStorage.getItem('knowflick.workspace.v1')||'{}').materials)||[]).filter(m=>m.inboxStatus==='inbox').length < ${inboxBefore}`,
    "批量归档真的改了状态"
  );
  await check("document.body.innerText.includes('已归档')", "批量归档有回执");
  await check(
    "!document.querySelector('[aria-label=\"批量操作\"]')",
    "归档后批量栏收起"
  );

  // 批量操作：⌘/Ctrl 多选后可一次打标
  // 先补第二张卡——只靠前面流程产出一张，带条件的分支会永远不执行，
  // 断言就成了摆设。
  await browser("eval", `(() => {
    const raw = JSON.parse(localStorage.getItem('knowflick.workspace.v1') || '{}');
    const cards = raw.cards || [];
    if (cards.length < 2) {
      const base = cards[0] || {};
      cards.push(JSON.parse(JSON.stringify({
        ...base, id: 'batch-seed-2', headline: '批量回归用卡片',
        summary: 's', details: '用于验证批量操作', isFavorite: false,
        favoritedAt: null, seenAt: null, lastReviewedAt: null, reviewCount: 0,
      })));
    }
    raw.cards = cards;
    localStorage.setItem('knowflick.workspace.v1', JSON.stringify(raw));
    return cards.length;
  })()`);
  await browser("open", url);
  await new Promise((r) => setTimeout(r, 800));
  await clickButton("全部知识");
  await browser("eval", `(() => {
    const tab = [...document.querySelectorAll('.ws-filter-tabs button')].find(b => b.textContent.trim() === '知识卡');
    if (tab) tab.click();
    return !!tab;
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  await check('document.querySelectorAll(".ws-entry").length >= 2', "至少有两张卡片可选");
  // 两次点击分开发：选中态变化会让列表重渲染，连着 dispatch 会打到同一批旧节点。
  await browser("eval", `(() => {
    const rows = [...document.querySelectorAll('.ws-entry')];
    rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 350));
  await browser("eval", `(() => {
    const rows = [...document.querySelectorAll('.ws-entry')];
    rows[1].dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  await check('!!document.querySelector(\'[aria-label="批量操作"]\')', "多选后出现批量操作栏");
  await check('!!document.querySelector(\'[aria-label="导出选中内容"]\')', "选卡片时也能导出选中");
  await check(
    "document.querySelectorAll('.ws-entry[data-picked=\"true\"]').length === 2",
    "被勾选的行有可见标记"
  );
  await check(
    'document.querySelector(\'[data-batch-count]\')?.textContent.includes("2")',
    "批量栏显示已选数量"
  );
  // 多选不能妨碍单选阅读：读区应仍然显示最后点的那张
  await check(
    '!!document.querySelector(".ws-reader h1")',
    "多选时阅读区仍显示内容"
  );
  // 设分类用界面内输入，不用原生 prompt（样式割裂且挡列表）
  await check(
    '!document.querySelector(\'input[aria-label="统一分类名称"]\')',
    "批量栏默认不显示分类输入"
  );
  await browser("eval", "(document.querySelector('[aria-label=\"设置统一分类\"]')||{}).click?.(); true");
  await new Promise((r) => setTimeout(r, 300));
  await check(
    '!!document.querySelector(\'input[aria-label="统一分类名称"]\')',
    "点设分类后出现输入框"
  );
  await browser("fill", 'input[aria-label="统一分类名称"]', "批量归类");
  await browser("press", "Enter");
  await new Promise((r) => setTimeout(r, 700));
  await check(
    `((JSON.parse(localStorage.getItem('knowflick.workspace.v1')||'{}').cards)||[]).filter(c => c.category === "批量归类").length >= 2`,
    "回车即应用分类到所有选中卡片"
  );

  // 再多选一张，验证「标记已复习」作用于全部选中项
  await browser("eval", `(() => {
    const rows = [...document.querySelectorAll('.ws-entry')];
    rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 350));
  await browser("eval", `(() => {
    const rows = [...document.querySelectorAll('.ws-entry')];
    rows[1].dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 350));
  await check(
    'document.querySelector(\'[data-batch-count]\')?.textContent.includes("2")',
    "重新多选两张以验证批量打标"
  );
  await browser("eval", "(document.querySelector('[aria-label=\"标记为已复习\"]')||{}).click?.(); true");
  await new Promise((r) => setTimeout(r, 700));
  await check(
    `((JSON.parse(localStorage.getItem('knowflick.workspace.v1')||'{}').cards)||[]).filter(c => (c.seenAt||null) !== null).length >= 2`,
    "批量打标写回所有选中卡片"
  );

  // 键盘用户也能多选：Shift+方向键做范围选择（多选不能只靠鼠标）。
  // 直接派发带 shiftKey 的 KeyboardEvent：agent-browser 对组合键的实现不稳定，
  // 这里要验证的是应用自己的处理器。
  // 先清状态：焦点若落在输入框，处理器会因「正在输入」提前返回；对话框开着也会整段忽略。
  await browser("eval", `(() => {
    const dialog = document.querySelector('dialog[open]');
    if (dialog && typeof dialog.close === 'function') dialog.close();
    const el = document.activeElement;
    if (el && el !== document.body) el.blur();
    document.querySelector('.ws-entry')?.focus();
    return !document.querySelector('dialog[open]');
  })()`);
  await new Promise((r) => setTimeout(r, 250));
  await browser("eval", `(() => {
    const target = document.querySelector('.ws-entry');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }));
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }));
    return true;
  })()`);
  // 已经在最后一行时 ArrowDown 无法再下移，范围起止会重合成一项（这是正确行为：
  // 不能越过末尾扩展）。所以先回退到第一行，再用 Shift+方向键拉一个范围。
  await browser("eval", `(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 300));
  await browser("eval", `(() => {
    const target = document.querySelector('.ws-entry');
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }));
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  await check(
    'document.querySelectorAll(\'.ws-entry[data-picked="true"]\').length >= 2',
    "Shift+方向键可选多行"
  );
  // 顺带锁住：在最后一行时 Shift+方向键不会扩展出范围（不能越过末尾）
  await check(
    'document.querySelectorAll(\'.ws-entry[data-picked="true"]\').length < 3',
    "范围选择不会越过列表末尾"
  );

  // 普通点击应退出多选，不留看不见的待处理选择
  await browser("eval", `(() => {
    const row = document.querySelector('.ws-entry');
    if (row) row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 350));
  await check('!document.querySelector(\'[aria-label="批量操作"]\')', "普通点击退出批量选择");

  // 知识卡删除：两步确认（第一下只提示，第二下才删），且素材不受影响
  await clickButton("全部知识");
  // 按卡片标题定位，避免选到素材（素材只有归档，没有删除）
  // 用「知识卡」筛选把素材排除掉，确保选中的是卡片
  await browser("eval", `(() => {
    const tab = [...document.querySelectorAll('.ws-filter-tabs button')].find(b => b.textContent.trim() === '知识卡');
    if (tab) tab.click();
    return !!tab;
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  await browser("eval", "(document.querySelector('.ws-entry')||{}).click?.(); true");
  await new Promise((r) => setTimeout(r, 400));
  await check('!!document.querySelector(\'[aria-label="删除这张卡片"]\')', "card reader offers a delete action");
  // 基线用持久化的卡片条数：DOM 行数受筛选与提示重渲染影响，两者口径不同。
  const storedCardsBefore = await evaluate(
    "((JSON.parse(localStorage.getItem('knowflick.workspace.v1') || '{}').cards) || []).length"
  );
  assert.ok(storedCardsBefore > 0, "库里应当有卡片可删");
  await browser("eval", "(() => { const b = document.querySelector('[aria-label=\"删除这张卡片\"]'); if (b) b.click(); return !!b; })()");
  await check('!!document.querySelector(\'[aria-label="确认删除这张卡片"]\')', "deleting a card asks for confirmation");
  await check(
    `((JSON.parse(localStorage.getItem('knowflick.workspace.v1') || '{}').cards) || []).length === ${storedCardsBefore}`,
    "first click does not delete anything"
  );
  await new Promise((r) => setTimeout(r, 250));
  // 用 DOM 直接触发：按钮会因 label 变化重渲染，自动化点击容易落到旧节点上。
  await browser("eval", "(() => { const b = document.querySelector('[aria-label=\"确认删除这张卡片\"]'); if (b) b.click(); return !!b; })()");
  await new Promise((r) => setTimeout(r, 600));
  await check(
    `(() => { const raw = JSON.parse(localStorage.getItem('knowflick.workspace.v1') || '{}');
      return (raw.cards || []).length === ${storedCardsBefore - 1}; })()`,
    "confirmed delete removes exactly one card"
  );
  await check('document.body.innerText.includes("已删除知识卡")', "delete reports what happened");
  await browser("fill", '[aria-label="搜索知识库"]', "");

  // 笔记转知识卡：解析器早就有，却一直没有入口——笔记软件最该有的能力
  await check('!!document.querySelector(\'[aria-label="笔记转知识卡"]\')', "有「笔记转知识卡」入口");
  await browser("eval", `(() => {
    const input = document.querySelector('input[data-role=notes-to-cards]');
    if (!input) return 'NO_INPUT';
    const dt = new DataTransfer();
    dt.items.add(new File(['## 复购率比拉新重要\\n\\n获取成本远高于维护成本。\\n\\n## 小团队更要自动化\\n\\n人手少时浪费被放大。'], '笔记.md', { type: 'text/markdown' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 900));
  await check(
    "((JSON.parse(localStorage.getItem('knowflick.workspace.v1')||'{}').cards)||[]).length >= 2",
    "笔记被拆成多张知识卡"
  );
  await check(
    "((JSON.parse(localStorage.getItem('knowflick.workspace.v1')||'{}').cards)||[]).some(c => c.headline.includes('复购率'))",
    "卡片标题来自笔记小节"
  );
  await check(
    "((JSON.parse(localStorage.getItem('knowflick.workspace.v1')||'{}').cards)||[]).every(c => c.source === 'imported')",
    "转出的卡片是可复习的导入卡"
  );

  // 统计：ADR-0002 把「统计」列进第一版交付物，命令早就在，但没有界面
  await check(
    "[...document.querySelectorAll('.ws-nav-row')].some(e => e.textContent.includes('统计'))",
    "侧栏有统计入口"
  );
  await clickButton("统计");
  await check('!!document.querySelector(\'[data-page="stats"]\')', "统计页渲染");
  await check(
    "document.body.innerText.includes('知识卡') && document.body.innerText.includes('素材')",
    "统计页展示卡片与素材的数量"
  );
  await check(
    "document.body.innerText.includes('待复习') || document.body.innerText.includes('到期')",
    "统计页展示待复习情况"
  );
  await check(
    "document.querySelectorAll('[data-stat]').length >= 4",
    "统计页至少四个指标块"
  );

  console.log("UI smoke complete. Desktop SQLite behaviour is covered by cargo tests and the native-window check.");
} finally {
  await browser("close").catch(() => {});
}
