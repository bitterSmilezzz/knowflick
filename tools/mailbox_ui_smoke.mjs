#!/usr/bin/env node
/** Mail UI regression: isolated browser data and a deterministic AI response. No real mail or credentials. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
const exec = promisify(execFile);
const session = "knowflick-mailbox-smoke";
const url = process.env.KNOWFLICK_UI_URL || "http://localhost:1420";
const b = async (...args) => (await exec("agent-browser", ["--session", session, ...args], { timeout: 25000 })).stdout.trim();
const ev = async code => {
  let result = JSON.parse(await b("eval", `JSON.stringify(${code})`));
  return typeof result === "string" ? JSON.parse(result) : result;
};
let count = 0;
async function check(expression, label) {
  for (let n = 0; n < 40; n++) {
    if (await ev(expression)) { count++; console.log(`PASS ${label}`); return; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(label);
}
const clickText = text => b("eval", `(()=>{const el=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!el)throw Error('Button missing');el.click();return true})()`);
try {
  await b("set", "viewport", "1040", "760");
  await b("open", url);
  await check("!!document.querySelector('.ws')", "工作台就绪");
  const now = Date.now();
  const messages = [
    ["1", "项目计划", "请在周五前核对方案。", "项目组 <team@example.test>"],
    ["2", "Re: 项目计划", "补充议题，具体截止时间请核实。", "同事 <colleague@example.test>"],
    ["3", "本周 Newsletter", "这是一封中文订阅周刊。", "周刊 <weekly@example.test>"],
  ].map(([id, title, rawText, from], i) => ({ id: `mail-test-${id}`, sourceType: "email", title, rawText,
    contentHash: "", metadataJson: JSON.stringify({ mailAccountId: "fixture", from, to: "me@example.test", date: "2026-10-21", messageId: `<${id}@example.test>`, attachmentFilenames: i === 0 ? ["方案.pdf"] : [] }),
    inboxStatus: "inbox", createdAt: now - i * 1000, updatedAt: now - i * 1000,
  }));
  await b("eval", `(()=>{localStorage.clear();sessionStorage.clear();localStorage.setItem('knowflick.workspace.v1',${JSON.stringify(JSON.stringify({ materials: messages, cards: [], settings: JSON.stringify({ providerId: "custom", baseURL: "https://mail-ai.example.test", model: "fixture", enableAI: true, paperTheme: "RICE_PAPER" }) }))});sessionStorage.setItem('knowflick.workspace.key','fixture-only');return true})()`);
  await b("open", url);
  await check("[...document.querySelectorAll('.ws-nav-row')].some(b=>b.textContent.includes('邮箱'))", "导航出现邮箱入口");
  await b("eval", "(()=>{[...document.querySelectorAll('.ws-nav-row')].find(e=>e.textContent.includes('邮箱')).click();return true})()");
  await check("document.querySelectorAll('.mail-row').length===3", "已导入邮件显示三封");
  await check("document.querySelectorAll('.mail-thread').length===2", "回复按主题归组为两组");
  await check("document.querySelector('[data-page=mailbox]').textContent.includes('浏览器模式')", "连接能力边界就地说明");
  await clickText("连接邮箱");
  await check("!!document.querySelector('input[type=password]')", "连接表单使用密码输入框");
  await check("[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='测试连接').disabled", "浏览器不能伪造连接成功");
  await check("[...document.querySelectorAll('[aria-label=\"自动同步间隔\"] option')].map(o=>o.value).join(',')==='0,5,15,30,60,180,1440'", "自动同步默认关闭且可选定区间");
  await check("[...document.querySelectorAll('[aria-label=\"自动同步间隔\"] option')][0].selected", "自动同步默认是手动");
  await check("document.querySelector('[data-page=mailbox]').textContent.includes('仅在应用运行时')", "自动同步范围如实说明");
  await b("click", '[aria-label="关闭账号表单"]');
  await b("fill", '[aria-label="搜索邮件主题、发件人与正文"]', "Newsletter");
  await check("document.querySelectorAll('.mail-row').length===1", "搜索邮件主题");
  // Native input setter dispatches React change even when clearing to an empty string.
  await b("eval", "(()=>{const e=document.querySelector('.mail-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
  await check("document.querySelectorAll('.mail-row').length===3", "清空搜索恢复全部邮件");
  await b("select", '[aria-label="筛选邮件分类"]', "订阅与资讯");
  await check("document.querySelectorAll('.mail-row').length===1", "本地规则分类筛选");
  await b("select", '[aria-label="筛选邮件分类"]', "");
  await check("document.querySelectorAll('.mail-row').length===3", "清空分类筛选");
  await b("check", '.mail-selection input[type=checkbox]');
  await check("document.querySelectorAll('.mail-row[data-selected=true]').length===3", "全选当前邮件");
  await b("eval", `(()=>{const original=window.fetch;window.fetch=async(input,init)=>{if(String(input).includes('mail-ai.example.test')){window.__mailSummaryBody=JSON.parse(init.body);return new Response(JSON.stringify({choices:[{message:{content:'## 邮件归纳\\n项目计划需要核对 [邮件 1]。\\n\\n#### 待核实\\n截止时间由用户确认。'}}]}),{status:200,headers:{'Content-Type':'application/json'}})}return original(input,init)};return true})()`);
  await clickText("汇总所选邮件");
  await check("!!document.querySelector('[aria-label=\"邮件摘要结果\"]')", "AI 归纳呈现真实结果面板");
  await check("window.__mailSummaryBody.messages[1].content.includes('发件人：')", "模型收到邮件来源头");
  await check("document.querySelectorAll('.mail-row').length===3", "归纳不会删除原邮件");
  await check("document.querySelectorAll('[data-mail-source]').length===3", "摘要列出三封来源邮件");
  await check("document.querySelector('[aria-label=\"摘要来源邮件\"]').textContent.includes('[邮件 1]')", "来源按模型收到的编号标注");
  await b("eval", "(()=>{const el=[...document.querySelectorAll('[aria-label^=\"查看原邮件\"]')][0];el.click();return true})()");
  await check("document.querySelector('.ws-reader h1')?.textContent.includes('项目计划')", "从摘要可跳回原邮件");
  await b("eval", "(()=>{[...document.querySelectorAll('.ws-nav-row')].find(e=>e.textContent.includes('邮箱')).click();return true})()");
  await check("!!document.querySelector('[aria-label=\"邮件摘要结果\"]')", "回到邮箱仍保留摘要");
  await clickText("保存摘要到素材库");
  await check("JSON.parse(localStorage.getItem('knowflick.workspace.v1')).materials.some(m=>m.sourceType==='email-digest')", "摘要持久化为素材");
  await check("(()=>{const raw=JSON.parse(localStorage.getItem('knowflick.workspace.v1'));const d=raw.materials.find(m=>m.sourceType==='email-digest');const meta=JSON.parse(d.metadataJson);return meta.sources.length===3&&meta.sources[0].materialId==='mail-test-1'})()", "摘要素材持久保存来源映射");
  await check("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='摘要已保存'&&b.disabled)", "保存后按钮变已保存并禁用");
  // Jumping to an original mail leaves the mailbox page; the selection is intentionally
  // not preserved, so select again before a batch action (the digest itself survives).
  await check("document.querySelectorAll('.mail-row[data-selected=true]').length===0", "离开邮箱后选择被清空");
  await b("check", '.mail-selection input[type=checkbox]');
  await check("document.querySelectorAll('.mail-row[data-selected=true]').length===3", "重新全选后可批量操作");
  await clickText("本地归档");
  await check("JSON.parse(localStorage.getItem('knowflick.workspace.v1')).materials.filter(m=>m.sourceType==='email'&&m.inboxStatus==='processed').length===3", "所选邮件本地归档保留内容");
  await check("document.querySelectorAll('.mail-row').length===0", "待整理列表更新");
  await b("select", '[aria-label="筛选邮件状态"]', "processed");
  await check("document.querySelectorAll('.mail-row').length===3", "已归档邮件可找回");
  await b("set", "viewport", "860", "700");
  await check("document.documentElement.scrollWidth<=innerWidth", "窄窗没有横向溢出");
  await b("eval", "(()=>{const raw=JSON.parse(localStorage.getItem('knowflick.workspace.v1'));const settings=JSON.parse(raw.settings);settings.paperTheme='WARM_OBSIDIAN';raw.settings=JSON.stringify(settings);localStorage.setItem('knowflick.workspace.v1',JSON.stringify(raw));return true})()");
  await b("open", url);
  await check("document.querySelector('.ws')?.dataset.appearance==='dark'", "深色主题应用");
  await b("eval", "(()=>{[...document.querySelectorAll('.ws-nav-row')].find(e=>e.textContent.includes('邮箱')).click();return true})()");
  await b("select", '[aria-label="筛选邮件状态"]', "all");
  await check("document.querySelectorAll('.mail-row').length===3", "刷新后归档邮件仍可读");
  const shot = process.env.KNOWFLICK_MAIL_SCREENSHOT;
  if (shot) await b("screenshot", shot);
  console.log(`Mailbox UI smoke: ${count} checks passed.`);
} finally { await b("close").catch(() => {}); }
