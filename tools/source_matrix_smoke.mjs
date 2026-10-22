#!/usr/bin/env node
/**
 * 来源矩阵回归。
 *
 * 产品主线是「多来源 → 收件箱 → 知识库 → 应用」。这条链上最容易出的问题是
 * **某个来源进了库却走不通**：进不了收件箱、搜不到、转不成卡、来源标签认不出。
 * 此前每一类来源都有各自的冒烟，但**没有任何一套覆盖全部来源**——
 * 于是「来源」这条线是拼起来的，不是验过的。
 *
 * 这套把矩阵显式化：每种来源都必须能
 *   1. 进入收件箱并显示出来
 *   2. 被搜索命中（搜索索引要覆盖它）
 *   3. 带上正确的来源标签（用户要认得出这是从哪来的）
 *   4. 转成知识卡，且卡片能回溯到原始素材
 *
 * 手写 / 语音需要真实设备或插件，这里用**同样的素材形状**注入——
 * 它们与来源矩阵的差别只在采集方式，落到库后的路径完全一致。
 */
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";

const exec = promisify(execFile);
const session = "knowflick-source-matrix";
const url = process.env.KNOWFLICK_UI_URL || "http://localhost:1420";
const b = async (...args) => (await exec("agent-browser", ["--session", session, ...args], { timeout: 60000 })).stdout.trim();
const ev = async (code) => {
  const raw = await b("eval", `JSON.stringify(${code})`);
  const parsed = JSON.parse(raw);
  return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
};

let count = 0;
const pass = (label) => { count++; console.log(`PASS ${label}`); };

/** agent-browser 是否可用。 */
function hasAgentBrowser() {
  try {
    execFileSync("agent-browser", ["--help"], { timeout: 15000, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * 来源矩阵。
 *
 * `kind` 是素材的 sourceType；`label` 是界面上显示的来源标签。
 * `extra` 是该来源特有的元数据（搜索索引要覆盖它，见 materialSearchText）。
 */
const SOURCES = [
  { kind: "web", label: "example.test", title: "剪藏标题", text: "网页剪藏的正文内容", meta: { subject: "剪藏标题" } },
  { kind: "email", label: "邮件", title: "邮件标题", text: "邮件的正文内容", meta: { from: "someone@example.test", subject: "邮件标题" } },
  { kind: "document", label: "文档", title: "报告.docx", text: "文档的正文内容", meta: { fileName: "报告.docx" } },
  { kind: "image", label: "图片", title: "截图.png", text: "图片素材占位", meta: { fileName: "截图.png", mime: "image/png" } },
  { kind: "audio", label: "语音", title: "录音.webm", text: "语音转写的正文内容", meta: { fileName: "录音.webm" } },
  { kind: "ink", label: "手写笔记", title: "手写.json", text: "手写笔迹的占位内容", meta: { fileName: "手写.json" } },
  { kind: "manual", label: "随手灵感", title: "闪念", text: "随手记下的一条闪念", meta: {} },
];

// 需要 agent-browser（真实浏览器）。CI 环境没有它，所以在那里跳过——
// 本机跑门禁时它必须真的执行，否则这条线就白验了。
if (!hasAgentBrowser()) {
  console.log("SKIP 来源矩阵需要 agent-browser（CI 环境没有）");
  process.exit(0);
}

try {
  await b("set", "viewport", "1040", "760");
  await b("open", url);
  await new Promise((r) => setTimeout(r, 600));

  // 一次性把全部来源注入库（每种一条）
  await ev(`(() => {
    const now = Date.now();
    const defs = ${JSON.stringify(SOURCES)};
    const materials = defs.map((d, i) => ({
      id: "src-" + d.kind,
      sourceType: d.kind,
      title: d.meta.subject || d.meta.fileName || d.kind + " 来源",
      sourceUrl: d.kind === "web" ? "https://example.test/post" : null,
      rawText: d.text,
      contentHash: "",
      mediaPath: null,
      mediaSizeBytes: 0,
      metadataJson: JSON.stringify(d.meta),
      inboxStatus: "inbox",
      createdAt: now - i * 1000,
      updatedAt: now - i * 1000,
    }));
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("knowflick.workspace.v1", JSON.stringify({
      materials,
      cards: [],
      settings: JSON.stringify({ providerId: "x", baseURL: "https://x.test", model: "m", enableAI: true, paperTheme: "RICE_PAPER" }),
    }));
    return true;
  })()`);
  await b("open", url);
  await new Promise((r) => setTimeout(r, 1000));

  // 1. 每种来源都要出现在收件箱，且带着正确的来源标签
  await ev("(() => { const el = [...document.querySelectorAll('.ws-nav-row')].find(e => e.textContent.includes('收件箱')); if (el) el.click(); return !!el; })()");
  await new Promise((r) => setTimeout(r, 800));
  const inboxText = await ev("document.body.innerText");
  for (const source of SOURCES) {
    assert.ok(
      inboxText.includes(source.label),
      `${source.kind} 在收件箱里应显示来源标签「${source.label}」`,
    );
  }
  pass(`${SOURCES.length} 种来源都进得了收件箱并带来源标签`);

  // 2. 每种来源都要能被搜索命中（索引要覆盖各自的正文与元数据）
  for (const source of SOURCES) {
    const needle = source.text.slice(0, 6);
    await ev(`(() => {
      const el = document.querySelector('.ws-search input');
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(el, ${JSON.stringify(needle)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 400));
    const hits = await ev("document.querySelectorAll('.ws-entry').length");
    assert.ok(hits > 0, `${source.kind} 应能被搜索命中（关键词「${needle}」）`);
  }
  pass("每种来源都能被搜索命中");

  // 3. 邮件来源还要能按发件人搜到（搜索索引要覆盖 from/to/subject）
  await ev(`(() => {
    const el = document.querySelector('.ws-search input');
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(el, "someone@example.test");
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(await ev("document.querySelectorAll('.ws-entry').length > 0"), "邮件应能按发件人搜到");
  pass("邮件能按发件人搜到（索引覆盖 from）");

  // 4. 每种来源都要能转成知识卡，且卡片能回溯到原始素材
  for (const source of SOURCES) {
    // 转卡后会跳到知识库，所以每轮都要先回到收件箱。
    await ev("(() => { const el = [...document.querySelectorAll('.ws-nav-row')].find(e => e.textContent.includes('收件箱')); if (el) el.click(); return !!el; })()");
    await new Promise((r) => setTimeout(r, 600));
    await ev(`(() => { const e = [...document.querySelectorAll('.ws-entry')].find(x => x.textContent.includes(${JSON.stringify(source.title)})); if (e) e.click(); return !!e; })()`);
    await new Promise((r) => setTimeout(r, 500));
    const clicked = await ev(`(() => {
      const d = document.querySelector('[data-material-actions]');
      if (d) d.open = true;
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('保存为知识卡'));
      if (b) { b.click(); return true; }
      return false;
    })()`);
    assert.ok(clicked === true || String(clicked).includes("true"), `${source.kind} 应能点「保存为知识卡」`);
    await new Promise((r) => setTimeout(r, 900));
  }
  const cardLinks = await ev(`(() => {
    const raw = JSON.parse(localStorage.getItem('knowflick.workspace.v1') || '{}');
    return JSON.stringify((raw.cards || []).map(c => c.materialId));
  })()`);
  for (const source of SOURCES) {
    assert.ok(
      String(cardLinks).includes(`src-${source.kind}`),
      `${source.kind} 转出的卡片应能回溯到原始素材（materialId=src-${source.kind}）`,
    );
  }
  pass("每种来源都能转成知识卡且卡片回溯到原始素材");

  // 5. 转卡后素材仍在库里（回溯链不能断）
  const materialIds = await ev(`(() => {
    const raw = JSON.parse(localStorage.getItem('knowflick.workspace.v1') || '{}');
    return JSON.stringify((raw.materials || []).map(m => m.id));
  })()`);
  for (const source of SOURCES) {
    assert.ok(String(materialIds).includes(`src-${source.kind}`), `${source.kind} 的原始素材转卡后仍应保留`);
  }
  pass("转卡后原始素材仍可回溯");

  console.log(`Source matrix smoke: ${count} checks passed.`);
} finally {
  await b("close").catch(() => {});
}
