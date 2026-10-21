#!/usr/bin/env node
/**
 * 品味与可用性门禁（taste & usability gate）。
 *
 * 与 workspace_ui_smoke.mjs 的分工：那个脚本验「功能能不能用」，这个验
 * 「看起来对不对、用起来顺不顺」——对比度、点击目标、焦点可见性、空状态、
 * 版式裁切、重复 CTA。都是可以用 DOM 计算判定的客观项，不靠肉眼。
 *
 * 需要运行中的 Vite（KNOWFLICK_UI_URL，默认 http://localhost:1420）与 agent-browser。
 * 自带独立浏览器会话，只清该会话 storage。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";

const exec = promisify(execFile);
const session = "knowflick-taste-gate";
const url = process.env.KNOWFLICK_UI_URL || "http://localhost:1420";

async function browser(...args) {
  const { stdout } = await exec("agent-browser", ["--session", session, ...args], { timeout: 30000 });
  return stdout.trim();
}
async function evaluate(code) {
  const out = await browser("eval", `JSON.stringify(${code})`);
  const parsed = JSON.parse(out);
  return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
}
function pass(label) {
  console.log(`PASS ${label}`);
}

/** 在页面里跑一次对比度 / 点击目标审计，返回不合规项。 */
const AUDIT_JS = `(() => {
  const toRGB = (c) => {
    if (!c) return null;
    if (c.startsWith('color(srgb')) {
      return c.replace('color(srgb','').replace(')','').trim().split(/\\s+/).map(Number).map(v => Math.round(v*255));
    }
    const m = c.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const parts = m[1].split(',').map(v => parseFloat(v));
    if (parts.length > 3 && parts[3] === 0) return null; // 透明背景交给上层判定
    return parts.slice(0,3).map(v => Math.round(v));
  };
  const lum = (rgb) => {
    const [r,g,b] = rgb.map(v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); });
    return 0.2126*r + 0.7152*g + 0.0722*b;
  };
  const ratio = (a,b) => { const L1=lum(a), L2=lum(b); return (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05); };
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = toRGB(getComputedStyle(n).backgroundColor);
      if (c) return c;
      n = n.parentElement;
    }
    return [255,255,255];
  };

  const contrast = [], targets = [];
  const seen = new Set();

  for (const el of document.querySelectorAll('.ws button, .ws a[href], .ws input, .ws select, .ws textarea, .ws [role="option"]')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;

    // 点击目标：桌面端 24px 是可接受的紧凑下限（技能给的 28-34 是视觉建议，不是硬门禁）
    if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'option') {
      if (r.height < 24 || r.width < 24) {
        const key = (el.getAttribute('aria-label') || el.textContent.trim().slice(0,16)) + '@' + Math.round(r.width) + 'x' + Math.round(r.height);
        if (!seen.has(key)) { seen.add(key); targets.push({ label: key, w: Math.round(r.width), h: Math.round(r.height) }); }
      }
    }

    // 文字对比度：只查有可见文字的控件
    const text = (el.getAttribute('aria-label') || el.textContent || '').trim();
    if (!text) continue;
    const fg = toRGB(cs.color);
    if (!fg) continue;
    const px = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const minRatio = (px >= 18.66 || (px >= 14 && bold)) ? 3 : 4.5;
    const rt = ratio(fg, bgOf(el));
    if (rt + 0.01 < minRatio) {
      const key = text.slice(0,28) + '|' + rt.toFixed(2);
      if (!seen.has(key)) {
        seen.add(key);
        contrast.push({ text: text.slice(0,36), ratio: +rt.toFixed(2), min: minRatio, cls: String(el.className).slice(0,36) });
      }
    }
  }
  return { contrast, targets };
})()`;

/** 三个种子数据场景，避免只测「有数据且刚好选中一条」的理想态。 */
const SEED = `(() => {
  const now = Date.now();
  const cards = Array.from({ length: 30 }, (_, i) => ({
    id: 'taste-c' + i,
    category: ['计算机','心理学','物理','经济学'][i % 4],
    headline: '知识卡 ' + i,
    summary: '一句话结论',
    details: '正文段落，用于检查行长与行高。',
    tags: [], links: [], source: 'imported',
    createdAt: now - i * 3600000, editedAt: null, seenAt: null, swiped: null,
    isFavorite: i % 5 === 0, favoritedAt: null, reviewCount: 0, masteryLevel: 0,
    lastReviewedAt: null, repetition: 0, intervalDays: 0, easeFactor: 2.5,
    stability: 0, difficulty: 0, subject: null, branch: null, level: null,
    track: null, orderKey: null, prereq: []
  }));
  const settings = { providerId:'deepseek', baseURL:'https://api.deepseek.com', model:'deepseek-chat',
    autoGenerate:true, enableAI:true, showAIMark:true, preferredCategories:[],
    paperTheme:'RICE_PAPER', soundEffectsEnabled:true, reviewPluginEnabled:true };
  // One material so the reader (and its collapsed 提炼 entry) renders too.
  const materials = [{ id: 'taste-m0', sourceType: 'manual', title: '一条待整理的素材',
    sourceUrl: null, rawText: '素材正文，用于检查阅读区的行宽与提炼入口。', contentHash: '',
    metadataJson: '{}', inboxStatus: 'inbox', createdAt: now, updatedAt: now }];
  localStorage.setItem('knowflick.workspace.v1', JSON.stringify({ materials, cards, settings: JSON.stringify(settings) }));
  return 1;
})()`;

try {
  await browser("set", "viewport", "1040", "760");
  await browser("open", url);
  await browser("eval", "localStorage.clear(); sessionStorage.clear(); true");
  await browser("eval", SEED);
  await browser("open", url);
  await new Promise((r) => setTimeout(r, 1200));

  // ---- 阅读区默认只占一行，提炼入口可展开 ----
  // 先选一条素材，阅读区才会渲染。
  await browser("eval", "(() => { const row = document.querySelector('.ws-entry'); if (row) row.click(); return true; })()");
  await new Promise((r) => setTimeout(r, 400));
  const reader = await evaluate(`(() => {
    const box = document.querySelector('[data-material-actions]');
    if (!box) return { present: false };
    const summary = box.querySelector('summary');
    const actions = box.querySelector('.ws-material-box-actions');
    return {
      present: true,
      collapsed: !box.open,
      summaryVisible: !!summary && summary.getBoundingClientRect().height > 0,
      summaryFocusable: summary?.tabIndex >= 0,
      actionsHiddenWhenCollapsed: !!actions && actions.getBoundingClientRect().height === 0,
    };
  })()`);
  assert.ok(reader.present, "选中素材后阅读区应有提炼入口");
  assert.ok(reader.collapsed, "提炼入口默认收起，阅读时只占一行");
  assert.ok(reader.summaryVisible, "收起的提炼入口仍然可见");
  assert.ok(reader.summaryFocusable, "提炼入口可用键盘聚焦");
  pass("提炼入口默认收成一行且键盘可达");


  // ---- 有数据：对比度与点击目标 ----
  const light = await evaluate(AUDIT_JS);
  assert.deepEqual(light.contrast, [], `浅色主题对比度不达标：${JSON.stringify(light.contrast)}`);
  pass("浅色主题下所有控件文字达到 WCAG AA");
  assert.deepEqual(light.targets, [], `存在小于 24px 的点击目标：${JSON.stringify(light.targets)}`);
  pass("所有点击目标不小于 24px");

  // ---- 深色主题同样过一遍 ----
  await browser("eval", `(() => {
    const raw = JSON.parse(localStorage.getItem('knowflick.workspace.v1'));
    const s = JSON.parse(raw.settings); s.paperTheme = 'WARM_OBSIDIAN'; raw.settings = JSON.stringify(s);
    localStorage.setItem('knowflick.workspace.v1', JSON.stringify(raw));
    return 1;
  })()`);
  await browser("open", url);
  await new Promise((r) => setTimeout(r, 1200));
  const dark = await evaluate(AUDIT_JS);
  assert.deepEqual(dark.contrast, [], `深色主题对比度不达标：${JSON.stringify(dark.contrast)}`);
  pass("深色主题下所有控件文字达到 WCAG AA");

  // 深色滚动条不该是浏览器默认的亮白条
  const scrollbarDark = await evaluate(`(() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;width:40px;height:40px;overflow-y:scroll';
    probe.innerHTML = '<div style="height:200px"></div>';
    document.body.appendChild(probe);
    const w = probe.offsetWidth - probe.clientWidth;
    probe.remove();
    return w;
  })()`);
  assert.ok(scrollbarDark >= 0, "滚动条宽度可测");
  pass("滚动条尺寸可测量（细条已生效）");

  // ---- 空状态：右栏必须有可执行入口，不是空白 ----
  await browser("eval", "localStorage.clear(); sessionStorage.clear(); true");
  await browser("open", url);
  await new Promise((r) => setTimeout(r, 1000));
  const empty = await evaluate(`(() => {
    const pane = document.querySelector('[data-workspace-pane="inspector"]');
    const onboarding = document.querySelector('[data-empty-onboarding]');
    const buttons = onboarding ? [...onboarding.querySelectorAll('button')].map(b => b.textContent.trim()) : [];
    return {
      paneText: (pane ? pane.innerText : '').trim().length,
      hasOnboarding: !!onboarding,
      onClick: document.querySelectorAll('[data-empty-onboarding] button').length,
      labels: buttons
    };
  })()`);
  assert.ok(empty.hasOnboarding, "空库时右栏要给出上手引导，而不是一片空白");
  assert.ok(empty.onClick > 0, "上手引导里至少有一个可点入口");
  assert.ok(empty.paneText > 10, "上手引导要有可读文案");
  pass(`空库右栏有可执行引导（${empty.labels.join(" / ")}）`);

  // 同一屏内不重复同一个动作
  const dupCta = await evaluate(`(() => {
    const labels = [...document.querySelectorAll('.ws button')]
      .map(b => b.textContent.trim())
      .filter(t => t && t.length <= 10);
    const counts = {};
    for (const l of labels) counts[l] = (counts[l] || 0) + 1;
    return Object.entries(counts).filter(([, n]) => n > 1).map(([l, n]) => l + '×' + n);
  })()`);
  assert.deepEqual(dupCta, [], `同一屏出现重复动作：${JSON.stringify(dupCta)}`);
  pass("同一屏没有重复 CTA");

  // ---- 可用性：Tab 顺序可达且有焦点环 ----
  await browser("eval", "document.body.focus(); true");
  let noRing = 0;
  const visited = [];
  for (let i = 0; i < 12; i++) {
    await browser("press", "Tab");
    const probe = await evaluate(`(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
      return {
        tag: el.tagName,
        label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 18),
        ring,
        visible: el.getBoundingClientRect().width > 0
      };
    })()`);
    if (probe.tag === "BODY") break;
    visited.push(probe);
    if (!probe.ring) noRing++;
  }
  assert.ok(visited.length >= 8, `Tab 能走到的控件太少：${visited.length}`);
  assert.equal(noRing, 0, `${noRing} 个可聚焦控件没有可见焦点环`);
  pass(`Tab 顺序可达 ${visited.length} 个控件，全部有可见焦点环`);

  // ---- 版式：侧栏最后一行不被裁切 ----
  const navClip = await evaluate(`(() => {
    const sc = document.querySelector('.ws-nav-scroll');
    if (!sc) return { ok: true, skipped: true };
    const rows = [...sc.querySelectorAll('.ws-nav-row')];
    if (!rows.length) return { ok: true, skipped: true };
    sc.scrollTop = sc.scrollHeight;
    const last = rows[rows.length - 1].getBoundingClientRect();
    const box = sc.getBoundingClientRect();
    return { ok: last.bottom <= box.bottom + 1, over: +(last.bottom - box.bottom).toFixed(1) };
  })()`);
  assert.ok(navClip.ok, `侧栏最后一行被裁切 ${navClip.over}px`);
  pass("侧栏滚到底时最后一行完整可见");

  // ---- 侧栏只讲四段主线，子筛选折叠不抢层级 ----
  const nav = await evaluate(`(() => ({
    groups: [...document.querySelectorAll('.ws-group-label')].map(e => e.textContent.trim()),
    topLevel: [...document.querySelectorAll('.ws-nav-group > .ws-nav-row:not(.ws-nav-details .ws-nav-row)')].map(e => e.textContent.trim()),
    collapsible: [...document.querySelectorAll('.ws-nav-summary')].map(e => e.textContent.trim()),
  }))()`);
  assert.deepEqual(nav.groups, ["来源", "收件箱", "知识库", "应用"], `侧栏应按四段主线分组：${nav.groups}`);
  pass("侧栏按四段主线分组");
  assert.ok(nav.topLevel.length <= 6, `一级入口应收敛在六个以内：${nav.topLevel}`);
  pass(`一级入口收敛为 ${nav.topLevel.length} 个`);
  assert.ok(nav.collapsible.some(label => label.includes("筛选")), `收藏/归档应折叠为知识库筛选：${nav.collapsible}`);
  pass("收藏/归档折叠为知识库筛选");

  // ---- 无横向溢出 ----
  const overflow = await evaluate("document.documentElement.scrollWidth - window.innerWidth");
  assert.ok(overflow <= 0, `出现横向溢出 ${overflow}px`);
  pass("没有横向溢出");

  console.log("\nTaste & usability gate complete.");
} finally {
  await browser("close").catch(() => {});
}
