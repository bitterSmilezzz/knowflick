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
  await browser("select", '[data-group="appearance"] select', "DARK");
  // 温故复习现在是 official-review-fsrs 插件，用它的稳定选择器点名，别落到插件矩阵第一行
  await browser("check", '[data-plugin-toggle="official-review-fsrs"]');
  await browser("click", ".ws-settings-foot button[type=submit]");
  await check('document.body.innerText.includes("设置已成功保存")', "settings save is reachable and reports success");
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

  console.log("UI smoke complete. Desktop SQLite behaviour is covered by cargo tests and the native-window check.");
} finally {
  await browser("close").catch(() => {});
}
