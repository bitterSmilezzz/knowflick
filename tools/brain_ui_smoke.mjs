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

  // 3. 旧格式（整张卡片对象）也能读出来，升级不该让历史引用消失
  await b("eval", `(() => {
    const alive = { id: "legacy-cite", category: "计算机", headline: "旧格式引用", summary: "s", details: "d",
      links: [], tags: [], source: "imported", createdAt: Date.now(), editedAt: null, seenAt: Date.now(),
      swiped: null, isFavorite: false, favoritedAt: null, reviewCount: 0, masteryLevel: 0,
      lastReviewedAt: null, repetition: 0, intervalDays: 0, easeFactor: 2.5, stability: 0, difficulty: 0,
      subject: null, branch: null, level: null, track: null, orderKey: null, prereq: [] };
    const raw = JSON.parse(localStorage.getItem('knowflick.workspace.v1') || '{}');
    raw.cards = [alive];
    localStorage.setItem('knowflick.workspace.v1', JSON.stringify(raw));
    localStorage.setItem('knowflick.workspace.chat', JSON.stringify([
      { role: "assistant", content: "你好！我是你的知识库助手。我会基于你收集的卡片检索事实，回答你的提问并指出引用来源。" },
      { role: "assistant", content: "旧格式的回答。", cited: [alive] },
    ]));
    return true;
  })()`);
  await b("open", url);
  await new Promise(r => setTimeout(r, 900));
  await goTo("知识问答");
  await check("document.body.innerText.includes('旧格式引用')", "旧格式的整卡引用仍能显示");
  await check("!document.body.innerText.includes('已删除')", "旧格式里仍存在的卡片不该标成已删除");

  // 4. 引用指向已删除的卡片：不能静默跳到别的卡
  await b("eval", `(() => {
    const now = Date.now();
    const alive = { id: "cite-alive", category: "计算机", headline: "还在的卡", summary: "s", details: "d",
      links: [], tags: [], source: "imported", createdAt: now, editedAt: null, seenAt: now, swiped: null,
      isFavorite: false, favoritedAt: null, reviewCount: 0, masteryLevel: 0, lastReviewedAt: null,
      repetition: 0, intervalDays: 0, easeFactor: 2.5, stability: 0, difficulty: 0, subject: null,
      branch: null, level: null, track: null, orderKey: null, prereq: [] };
    const gone = { ...alive, id: "cite-gone", headline: "已被删除的卡" };
    const raw = JSON.parse(localStorage.getItem('knowflick.workspace.v1') || '{}');
    raw.cards = [alive];
    localStorage.setItem('knowflick.workspace.v1', JSON.stringify(raw));
    localStorage.setItem('knowflick.workspace.chat', JSON.stringify([
      { role: "assistant", content: "你好！我是你的知识库助手。我会基于你收集的卡片检索事实，回答你的提问并指出引用来源。" },
      { role: "user", content: "之前问过的问题" },
      { role: "assistant", content: "依据你之前的记录。", cited: [gone, alive] },
    ]));
    return true;
  })()`);
  await b("open", url);
  await new Promise(r => setTimeout(r, 900));
  await goTo("知识问答");
  await check("document.querySelectorAll('.ws-cite-chip').length === 2", "引用列表保留两条");
  await check(
    "document.body.innerText.includes('已被删除')",
    "已删除的引用要标出来"
  );
  await ev("(() => { const chip = [...document.querySelectorAll('.ws-cite-chip')].find(c => c.textContent.includes('已被删除')); if (chip) chip.click(); return !!chip; })()");
  await new Promise(r => setTimeout(r, 800));
  await check(
    "document.querySelector('.ws-reader h1')?.textContent !== '还在的卡'",
    "点已删除的引用不会静默跳到别的卡片"
  );
  await check(
    "document.body.innerText.includes('已删除')",
    "点已删除的引用有明确说明"
  );

  // 4. 认知简报：不依赖模型也能出结构化内容
  await seed(false);
  await goTo("认知简报");
  await check("document.body.innerText.includes('认知洞察简报')", "简报页有标题");
  await check(
    "document.body.innerText.includes('近期新增') || document.body.innerText.includes('一、')",
    "简报有结构化板块"
  );
  await check("[...document.querySelectorAll('button')].some(b=>/重新分析|存入产物库|复制/.test(b.textContent))", "简报有可执行动作");
  await check("document.body.innerText.includes('重新分析')", "重新分析默认显示为「重新分析」");
  await ev("(() => { const b=[...document.querySelectorAll('button')].find(x=>/重新分析/.test(x.textContent)); if(b){b.click();return true} return false })()");
  await new Promise(r => setTimeout(r, 400));
  await check("document.body.innerText.includes('已按当前卡片重算')", "重新分析后给出反馈而不是没反应");

  // 5. 存入产物库的简报必须能再看到——存进去却无处可读等于白存
  await seed(false);
  await goTo("认知简报");
  await ev("(() => { const b=[...document.querySelectorAll('button')].find(x=>/存入产物库/.test(x.textContent)); if(b){b.click();return true} return false })()");
  await new Promise(r => setTimeout(r, 900));
  const stored = await ev(
    "((JSON.parse(localStorage.getItem('knowflick.workspace.artifacts')||'[]')).length) + '|' + ((JSON.parse(localStorage.getItem('knowflick.workspace.v1')||'{}').artifacts)||[]).length"
  );
  await check("Number(String('" + stored + "').split('|')[0]) + Number(String('" + stored + "').split('|')[1]) > 0",
    "简报已存入产物库");
  await check(
    "[...document.querySelectorAll('.ws-nav-row')].some(e => e.textContent.includes('产物'))",
    "侧栏有产物库入口"
  );
  await goTo("产物");
  await check("document.querySelectorAll('[data-artifact]').length >= 1", "产物库列出已存简报");
  await check(
    "document.querySelector('[data-artifact]')?.textContent.includes('认知') || document.body.innerText.includes('简报')",
    "产物条目能看出是什么"
  );

  // 6. 产物可展开读全文，可删除（删除不可撤销，故走确认）
  await ev("(() => { const b=[...document.querySelectorAll('[data-artifact] button')].find(x=>x.textContent.trim()==='查看'); if(b){b.click();return true} return false })()");
  await new Promise(r => setTimeout(r, 400));
  await check("!!document.querySelector('.ws-artifact-body')", "产物可展开查看全文");
  await check(
    "document.querySelector('.ws-artifact-body').textContent.length > 20",
    "展开后确有内容"
  );
  // 删除需要原生 confirm：先替换掉，再点删除
  await b("eval", "window.__confirmCalls = 0; window.confirm = () => { window.__confirmCalls++; return true; }; true");
  await check("!!document.querySelector('[aria-label=\"删除产物\"]')", "产物有删除入口");
  await ev("(() => { const b=document.querySelector('[aria-label=\"删除产物\"]'); if(b){b.click();return true} return false })()");
  await new Promise(r => setTimeout(r, 700));
  await check("(window.__confirmCalls || 0) >= 1", "删除前会确认");
  await check(
    "!document.querySelector('[data-artifact]')",
    "删除后产物从列表消失"
  );

  console.log(`Brain UI smoke: ${count} checks passed.`);
} finally { await b("close").catch(() => {}); }
