#!/usr/bin/env node
/**
 * 温故复习回归：复习必须按记忆算法安排，不能一进来就给一张没到期的卡。
 *
 * 发现的问题：QuizView 的 dueOnly 默认 false，复习页把所有卡都排进队列，
 * 于是「今日待复习 0」下面紧接着出现评分面板——计数和界面自相矛盾，
 * 也让 FSRS 的排期形同虚设。空态本身还有文案但没有任何出口。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
const exec = promisify(execFile);
const session = "knowflick-review-smoke";
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
const settings = JSON.stringify({ providerId: "x", baseURL: "https://x.test", model: "m", enableAI: true, paperTheme: "RICE_PAPER", reviewPluginEnabled: true });
const card = (over) => ({
  id: "r1", category: "计算机", headline: "复购率比拉新更重要", summary: "复购率比拉新更重要",
  details: "因为获取成本远高于维护成本。", links: [], tags: [], source: "imported",
  createdAt: Date.now(), editedAt: null, seenAt: null, swiped: null, isFavorite: false, favoritedAt: null,
  reviewCount: 0, masteryLevel: 0, lastReviewedAt: null, repetition: 0, intervalDays: 0,
  easeFactor: 2.5, stability: 0, difficulty: 0, subject: null, branch: null, level: null, track: null,
  orderKey: null, prereq: [], ...over,
});
const seed = async (cards) => {
  const payload = JSON.stringify({ materials: [], cards, settings });
  await b("eval", `(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('knowflick.workspace.v1', ${JSON.stringify(payload)}); return true; })()`);
  await b("open", url);
  await new Promise(r => setTimeout(r, 900));
  await ev("(() => { const el = [...document.querySelectorAll('.ws-nav-row')].find(e => e.textContent.includes('温故复习')); if (el) el.click(); return !!el; })()");
  await new Promise(r => setTimeout(r, 700));
};
const openReview = seed;

try {
  await b("set", "viewport", "1040", "760");
  await b("open", url);

  // 1. 没有到期卡：说明现状 + 给出口，而不是直接甩一张卡让你评分
  const then = Date.now() - 86_400_000;
  await seed([card({ lastReviewedAt: then, reviewCount: 3, repetition: 3, intervalDays: 7, dueAt: "2099-01-01" })]);
  await check("document.body.innerText.includes('今天没有到期的卡片')", "无到期卡时说明现状");
  await check("!document.body.innerText.includes('较难')", "无到期卡时不该出现评分按钮");
  await check("[...document.querySelectorAll('button')].some(e=>e.textContent.includes('仍要复习全部'))", "空态给出额外练习出口");

  // 2. 显式选择额外练习后进入复习
  await ev("(() => { const el = [...document.querySelectorAll('button')].find(e => e.textContent.includes('仍要复习全部')); if (el) el.click(); return !!el; })()");
  await check("[...document.querySelectorAll('button')].some(e=>/较难/.test(e.textContent))", "额外练习可进入复习");

  // 3. 有到期卡时直接进入复习，评分写回卡片
  await seed([card({})]);
  await check("[...document.querySelectorAll('button')].some(e=>/较难/.test(e.textContent))", "有到期卡时直接可复习");
  await check("document.body.innerText.includes('复购率')", "复习展示卡片内容");
  await ev("(() => { const el = [...document.querySelectorAll('button')].find(e => /显示答案解析|点击或按空格/.test(e.textContent)); if (el) el.click(); return !!el; })()");
  await new Promise(r => setTimeout(r, 300));
  await ev("(() => { const el = [...document.querySelectorAll('button')].find(e => /较难/.test(e.textContent)); if (el) el.click(); return !!el; })()");
  await check("(() => { const raw = JSON.parse(localStorage.getItem('knowflick.workspace.v1') || '{}'); const c = (raw.cards || [])[0]; return !!c && c.reviewCount >= 1; })()", "评分写回卡片");
  await check("document.body.innerText.includes('本轮温故复习完成')", "评分完一轮后有完成提示");
  await check("[...document.querySelectorAll('button')].some(e=>e.textContent.includes('再来一轮'))", "完成后可以再来一轮");

  console.log(`Review UI smoke: ${count} checks passed.`);
} finally { await b("close").catch(() => {}); }
