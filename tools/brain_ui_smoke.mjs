#!/usr/bin/env node
/**
 * 「应用」阶段回归：知识问答与认知简报。
 *
 * 这两个页面此前没有任何自动化覆盖。写这条用例时发现一个真实的「点了没反应」：
 * 未配置密钥时提交问题，守卫写成 `needsKey && inShell()`——只在桌面端拦截，
 * 浏览器模式下会发出一个注定失败的请求，界面要转到 120 秒超时才报错。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
const exec = promisify(execFile);
const session = "knowflick-brain-smoke";
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
const goTo = async (name) => {
  await ev(`(() => { const el = [...document.querySelectorAll('.ws-nav-row')].find(e => e.textContent.includes(${JSON.stringify(name)})); if (el) el.click(); return !!el; })()`);
  await new Promise(r => setTimeout(r, 1200));
};
const seed = async (withKey) => {
  const now = Date.now();
  const cards = [0, 1, 2].map(i => ({
    id: `b${i}`, category: ["计算机", "心理学"][i % 2], headline: `知识卡 ${i}`,
    summary: `结论 ${i}`, details: `正文 ${i}：SQLite 索引与查询计划`, links: [], tags: [],
    source: "imported", createdAt: now - i * 3600000, editedAt: null, seenAt: now, swiped: null,
    isFavorite: false, favoritedAt: null, reviewCount: 1, masteryLevel: 1, lastReviewedAt: now,
    repetition: 1, intervalDays: 3, easeFactor: 2.5, stability: 1, difficulty: 1,
    subject: null, branch: null, level: null, track: null, orderKey: null, prereq: [],
  }));
  const settings = JSON.stringify({ providerId: "deepseek", baseURL: "https://api.deepseek.com",
    model: "deepseek-chat", enableAI: true, paperTheme: "RICE_PAPER" });
  const payload = JSON.stringify({ materials: [], cards, settings });
  await b("eval", `(() => { localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('knowflick.workspace.v1', ${JSON.stringify(payload)});
    ${withKey ? "sessionStorage.setItem('knowflick.workspace.key', 'test-key-not-used');" : ""}
    return true; })()`);
  await b("open", url);
  await new Promise(r => setTimeout(r, 1000));
};
const ask = async (text) => {
  await ev(`(() => {
    const el = document.querySelector('textarea') || document.querySelector('input[type=text]');
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await new Promise(r => setTimeout(r, 250));
  await ev("(() => { const btn = [...document.querySelectorAll('button')].find(x => /提问/.test(x.textContent)); if (btn) btn.click(); return !!btn; })()");
  await new Promise(r => setTimeout(r, 800));
};

try {
  await b("set", "viewport", "1040", "760");
  await b("open", url);

  // 1. 未配密钥：提交要立刻说明原因，而不是干等
  await seed(false);
  await goTo("知识问答");
  await check("!!document.querySelector('textarea, input[type=text]')", "问答页有输入框");
  await check("document.body.innerText.includes('尚未配置 API 密钥')", "未配密钥时页面有说明");
  await ask("我记录过哪些 SQLite 索引的要点？");
  await check("!!document.querySelector('[role=alert]')", "提交后立刻给出提示而不是没反应");
  await check(
    "document.querySelector('[role=alert]').innerText.includes('再点一次')",
    "提示说明如何继续"
  );
  await check(
    "!document.body.innerText.includes('我记录过哪些 SQLite 索引的要点？')",
    "未确认前不发出注定失败的请求"
  );
  await ev("(() => { const btn = [...document.querySelectorAll('button')].find(x => /提问/.test(x.textContent)); if (btn) btn.click(); return !!btn; })()");
  await check("document.body.innerText.includes('我记录过哪些 SQLite 索引的要点？')", "再点一次即可继续发送");

  // 2. 对话要留得住：切页与刷新之后还能接着问
  await goTo("全部知识");
  await goTo("知识问答");
  await check("document.body.innerText.includes('我记录过哪些 SQLite 索引的要点？')", "切页回来后对话仍在");
  await b("open", url);
  await new Promise(r => setTimeout(r, 1000));
  await goTo("知识问答");
  await check("document.body.innerText.includes('我记录过哪些 SQLite 索引的要点？')", "刷新后对话仍在");
  await check("!!document.querySelector('[aria-label=\"清空对话\"]')", "有对话时提供清空入口");
  await b("eval", "(document.querySelector('[aria-label=\"清空对话\"]')||{}).click?.(); true");
  await new Promise(r => setTimeout(r, 600));
  await check("!document.body.innerText.includes('我记录过哪些 SQLite 索引的要点？')", "清空后不再显示旧问题");
  await check("document.body.innerText.includes('我是你的知识库助手')", "清空后回到问候语");

  // 3. 认知简报：不依赖模型也能出结构化内容
  await seed(false);
  await goTo("认知简报");
  await check("document.body.innerText.includes('认知洞察简报')", "简报页有标题");
  await check(
    "document.body.innerText.includes('近期新增') || document.body.innerText.includes('一、')",
    "简报有结构化板块"
  );
  await check("[...document.querySelectorAll('button')].some(b=>/重新分析|存入产物库|复制/.test(b.textContent))", "简报有可执行动作");

  console.log(`Brain UI smoke: ${count} checks passed.`);
} finally { await b("close").catch(() => {}); }
