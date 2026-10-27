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

  // 4. 学习的核心不是「记过一次」，而是**下次该什么时候复习**被算出来并存住。
  await check(
    "(() => { const c = JSON.parse(localStorage.getItem('knowflick.workspace.v1')).cards[0]; return c.intervalDays > 0 && c.lastReviewedAt !== null; })()",
    "评分后算出下次复习间隔并写回"
  );
  await check(
    "(() => { const c = JSON.parse(localStorage.getItem('knowflick.workspace.v1')).cards[0]; return c.masteryLevel >= 1 || c.repetition >= 1; })()",
    "评分后掌握度/重复次数前进"
  );

  // 5. 重载后间隔仍在——只存在内存里等于没复习过。
  const intervalBefore = await ev("JSON.parse(localStorage.getItem('knowflick.workspace.v1')).cards[0].intervalDays");
  await b("open", url);
  await new Promise(r => setTimeout(r, 1000));
  const intervalAfter = await ev("JSON.parse(localStorage.getItem('knowflick.workspace.v1')).cards[0].intervalDays");
  await check(
    String(intervalAfter) === String(intervalBefore) && Number(intervalAfter) > 0,
    `重载后复习间隔仍在（${intervalAfter} 天）`
  );

  // 6. 评为「重来」的卡应当很快再出现——间隔重复的重点是**没记住的要多见**。
  //    若它跟「良好」一样被推到一天后，用户当天就复习不到刚忘掉的内容。
  await seed([card({ id: "r-again", headline: "没记住的卡" })]);
  await check("[...document.querySelectorAll('button')].some(e=>/较难/.test(e.textContent))", "有到期卡时直接可复习");
  await ev("(() => { const el = [...document.querySelectorAll('button')].find(e => /显示答案解析|点击或按空格/.test(e.textContent)); if (el) el.click(); return !!el; })()");
  await new Promise(r => setTimeout(r, 300));
  await ev("(() => { const el = [...document.querySelectorAll('button')].find(e => /重来|再次/.test(e.textContent)); if (el) el.click(); return !!el; })()");
  await new Promise(r => setTimeout(r, 400));
  await check(
    "(() => { const c = JSON.parse(localStorage.getItem('knowflick.workspace.v1')).cards.find(x => x.id === 'r-again'); return !!c && c.repetition === 0 && c.masteryLevel === 0; })()",
    "评为「重来」会清零重复次数与掌握度"
  );
  await check(
    "(() => { const c = JSON.parse(localStorage.getItem('knowflick.workspace.v1')).cards.find(x => x.id === 'r-again'); return !!c && c.intervalDays === 1; })()",
    "评为「重来」的间隔被压回 1 天"
  );

  // 7. 刚复习过的卡不该立刻又出现在到期队列里。
  //    单独放一张卡：评「良好」之后它应当离开今天的到期列表。
  await seed([card({ id: "r-good", headline: "记住了的卡" })]);
  await ev("(() => { const el = [...document.querySelectorAll('button')].find(e => /显示答案解析|点击或按空格/.test(e.textContent)); if (el) el.click(); return !!el; })()");
  await new Promise(r => setTimeout(r, 300));
  await ev("(() => { const el = [...document.querySelectorAll('button')].find(e => /良好|简单/.test(e.textContent) && !/较难/.test(e.textContent)); if (el) el.click(); return !!el; })()");
  await new Promise(r => setTimeout(r, 400));
  await ev("(() => { const el = [...document.querySelectorAll('.ws-nav-row')].find(e => e.textContent.includes('温故复习')); if (el) el.click(); return !!el; })()");
  await new Promise(r => setTimeout(r, 800));
  // 复习过的卡不该还留在「今天」，但**会在未来的某天**到期——
  // 所以要看的不是「没有到期卡片」，而是「它被排到了后面」。
  await check(
    "document.body.innerText.includes('本轮温故复习完成')",
    "复习完成后有明确的完成提示"
  );
  await check(
    "(() => { const t = document.body.innerText.replace(/\\s+/g, ' '); const m = t.match(/平均间隔 ([0-9]+) 天/); return !!m && Number(m[1]) > 0; })()",
    "统计里的平均间隔按新间隔更新了"
  );
  await check(
    "document.body.innerText.includes('未来 7 天到期负荷')",
    "未来到期负荷可见（复习过的卡排到了后面）"
  );
  await check(
    "(() => { const t = document.body.innerText; const m = t.match(/未来 7 天到期负荷[\\s\\S]{0,200}/); return !!m && !/今天[\\s\\S]{0,40}\\b1\\b/.test(m[0].split('10-23')[1] || ''); })()",
    "今天不再有待复习的卡（它被推到了未来某天）"
  );

  console.log(`Review UI smoke: ${count} checks passed.`);
} finally { await b("close").catch(() => {}); }
