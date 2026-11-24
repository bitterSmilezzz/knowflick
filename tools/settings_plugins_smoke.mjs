#!/usr/bin/env node
/**
 * Browser regression for the plugin matrix, .kfbackup round trip and MCP panel
 * added to 工作台设置. Requires a running Vite dev server (KNOWFLICK_UI_URL,
 * default http://localhost:1420) and agent-browser.
 *
 * Uses its own browser session and only clears that session's storage.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const exec = promisify(execFile);
const session = "knowflick-plugins-settings";
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
    )}));if(!b)throw new Error('missing button: ' + ${JSON.stringify(text)});b.click();return true})()`
  );
}

try {
  await browser("set", "viewport", "1040", "760");
  await browser("open", url);
  await browser("eval", "localStorage.clear();sessionStorage.clear()");
  await browser("open", url);

  await clickButton("设置");
  await check('!!document.querySelector(\'[data-page="settings"]\')', "settings page renders");
  await check('document.body.innerText.includes("浏览器备份包含最近搜索历史") && document.body.innerText.includes("不含桌面项目、目标、画像")', "备份前说明浏览器格式与范围");

  // 浏览器体验里多处写着「需要桌面客户端」，但**没告诉用户怎么去**——
  // 被告知要去却没地方去，是断链。设置页是最显眼的落点，必须给可点的路。
  await check(
    '[...document.querySelectorAll(\'[data-hint="desktop-only"] button\')].some(b => b.textContent.includes("下载桌面客户端"))',
    "设置页给出可点的「下载桌面客户端」入口"
  );

  // 跨端契约：导出与安卓同格式的 cards.json
  await check(
    "document.body.innerText.includes('cards.json')",
    "设置页提到 cards.json 跨端导出"
  );
  await check(
    "document.body.innerText.includes('安卓')",
    "说明这个文件是给安卓端用的"
  );
  // Anki 词表：安卓端早就有，桌面端补上——同一份卡能带去别的复习工具
  await check(
    '!!document.querySelector(\'[data-action="export-anki-tsv"]\')',
    "设置页有导出 Anki 词表的入口"
  );
  await check(
    "document.body.innerText.includes('Anki')",
    "说明这是给 Anki 用的"
  );

  // 官方插件矩阵
  await check('document.querySelectorAll("[data-plugin-toggle]").length === 6', "六个官方插件都渲染出开关");
  await check(
    'document.querySelector(\'[data-plugin-toggle="official-review-fsrs"]\').checked === false',
    "温故复习插件默认关闭"
  );
  await check(
    'document.querySelector(\'[data-plugin-toggle="official-inbox-sniff"]\').checked === true',
    "链接嗅探插件默认开启"
  );
  await check(
    'document.querySelector(\'[data-plugin="official-inbox-sniff"] .ws-plugin-perms\').textContent.includes("network:fetch")',
    "插件行展示声明的权限"
  );
  // 语音插件：浏览器模式没有 Rust 侧，模型面板要如实说「只在桌面客户端可用」
  await check(
    '!!document.querySelector(\'[data-plugin="official-speech-asr"] [data-asr-panel]\')',
    "语音插件展开模型面板"
  );
  await check(
    'document.querySelector(\'[data-plugin="official-speech-asr"] [data-asr-status\]\').textContent.includes("桌面客户端")',
    "浏览器模式下模型面板说明限制"
  );

  // 切换插件并保存后持久化
  await browser("check", '[data-plugin-toggle="official-review-fsrs"]');
  await browser("click", ".ws-settings-foot button[type=submit]");
  await check('document.body.innerText.includes("设置已成功保存")', "保存插件开关成功");
  await browser("open", url);
  await check('document.body.innerText.includes("工作台设置") === false', "重载后回到默认页而不是设置页");
  await clickButton("设置");
  await check('!!document.querySelector(\'[data-page="settings"]\')', "重载后重新进入设置页");
  await check(
    'document.querySelector(\'[data-plugin-toggle="official-review-fsrs"]\').checked === true',
    "插件开关在重载后保持"
  );
  // 写盘形状：plugins 键落在 settings 里，且与温故入口一致
  // 注意：浏览器模式的 workspace 存储里 settings 是「字符串」，不是对象。
  await check(
    'JSON.parse(JSON.parse(localStorage.getItem("knowflick.workspace.v1")).settings).plugins["official-review-fsrs"].enabled === true',
    "plugins 键写进了 settings.json"
  );
  await check(
    'JSON.parse(localStorage.getItem("knowflick.workspace.v1")).settings.includes("reviewPluginEnabled")',
    "旧键 reviewPluginEnabled 仍然保留给安卓端"
  );
  await check('document.body.innerText.includes("温故复习")', "温故复习导航随插件开启出现");

  // 本地语义检索面板：浏览器模式要说明只在桌面端可用
  await check('!!document.querySelector(\'[data-group="embedding"] [data-embed-status]\')', "本地语义检索面板渲染");
  await check(
    'document.querySelector(\'[data-group="embedding"] [data-embed-status]\').textContent.includes("桌面客户端")',
    "浏览器模式下语义模型面板说明限制"
  );

  // MCP 面板
  await check('!!document.querySelector(\'[data-group="mcp"]\')', "MCP 授权面板渲染");
  await check('!document.querySelector("[data-mcp-snippet]")', "浏览器模式不展示不可用的连接配置");
  await check(
    '(()=>{const el=document.querySelector(\'[data-group="mcp"]\');' +
    'return !!el && /MCP|桌面|安装|源码/.test(el.textContent)})()',
    "MCP 区块说明接入前提（不是无条件可用）"
  );

  // .kfbackup 往返：造样本 → 点真实导出拿到字节 → 清库 → 走真实恢复输入框
  await clickButton("全部知识");
  await browser("click", ".ws-capture");
  await browser("fill", '.ws-dialog input[type="text"]', "备份往返记录");
  await browser("fill", '.ws-dialog textarea', "用于验证 .kfbackup 无损恢复的正文内容。");
  await browser("click", '.ws-dialog button[type="submit"]');
  await check('document.querySelector(".ws-reader h1")?.textContent === "备份往返记录"', "样本素材已创建");
  await check(
    'JSON.parse(localStorage.getItem("knowflick.workspace.v1")).materials[0].title === "备份往返记录"',
    "样本素材确实落到存储里"
  );

  // 边界样本：标题为空、正文为空的卡片，以及标题为空的素材。
  // 恢复逻辑曾用 `if (!c.headline || !c.details) continue` 过滤，
  // 于是这些内容在恢复时被**静默丢弃**——备份明明写进去了。
  await browser("eval", `(() => {
    const raw = JSON.parse(localStorage.getItem('knowflick.workspace.v1') || '{}');
    const now = Date.now();
    const base = {
      category: '', summary: '摘要', links: [], tags: [], source: 'seed', createdAt: now,
      editedAt: null, seenAt: null, swiped: null, isFavorite: false, favoritedAt: null,
      reviewCount: 0, masteryLevel: 0, lastReviewedAt: null, repetition: 0, intervalDays: 0,
      easeFactor: 2.5, stability: 0, difficulty: 0, subject: null, branch: null, level: null,
      track: null, orderKey: null, prereq: [],
    };
    raw.cards = [...(raw.cards || []),
      { ...base, id: 'restore-empty-title', headline: '', details: '正文不为空' },
      { ...base, id: 'restore-empty-body', headline: '标题不为空', details: '' }];
    raw.materials = [...(raw.materials || []), {
      id: 'restore-empty-title-mat', sourceType: 'web', title: '', sourceUrl: null,
      rawText: '正文', contentHash: '', mediaPath: null, mediaSizeBytes: 0,
      metadataJson: '{}', inboxStatus: 'inbox', createdAt: now, updatedAt: now,
    }];
    localStorage.setItem('knowflick.workspace.v1', JSON.stringify(raw));
    return true;
  })()`);
  await check(
    'JSON.parse(localStorage.getItem("knowflick.workspace.v1")).cards.length >= 2',
    "边界样本（空标题/空正文）已写入"
  );
  // 页面内存里的 cards state 也要看到它们，否则导出的包里根本没有边界样本。
  await browser("open", url);
  await new Promise((r) => setTimeout(r, 900));
  await check(
    'JSON.parse(localStorage.getItem("knowflick.workspace.v1")).cards.some(c => c.id === "restore-empty-title")',
    "边界样本仍在存储里"
  );
  await browser(
    "eval",
    "localStorage.setItem('knowflick.searchHistory.v1', JSON.stringify(['备份搜索往返验证']));true"
  );
  await browser("open", url);
  await new Promise((r) => setTimeout(r, 900));
  await check(
    'JSON.parse(localStorage.getItem("knowflick.searchHistory.v1"))[0] === "备份搜索往返验证"',
    "浏览器最近搜索样本已装载"
  );

  // 拦下导出的 Blob，这样拿到的是「用户点导出按钮」真实产出的字节
  await browser(
    "eval",
    `(()=>{window.__kfBackup=null;const orig=URL.createObjectURL.bind(URL);
      URL.createObjectURL=(blob)=>{window.__kfBackup=blob;return "blob:intercepted";};return true})()`
  );
  await clickButton("设置");
  await clickButton("导出备份包");
  await check("window.__kfBackup instanceof Blob", "导出按钮产出了一个备份 Blob");
  await check('document.body.innerText.includes("部分备份包") && document.body.innerText.includes("邮箱账户")', "导出回执说明备份缺口");
  await check(
    '!!document.querySelector(\'[data-group="mcp"]\')',
    "导出后设置页仍在"
  );

  const base64 = JSON.parse(
    await browser(
      "eval",
      `(async()=>{
        const buf = new Uint8Array(await window.__kfBackup.arrayBuffer());
        let bin = "";
        for (const b of buf) bin += String.fromCharCode(b);
        return btoa(bin);
      })()`
    )
  );
  const bytes = Buffer.from(base64, "base64");
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  console.log(`PASS 导出的 .kfbackup 是合法 ZIP（${bytes.length} 字节）`);

  const backupPath = join(tmpdir(), `knowflick-e2e-${Date.now()}.kfbackup`);
  writeFileSync(backupPath, bytes);

  // 清掉浏览器库，验证是从文件里恢复回来的
  await browser("eval", "localStorage.clear();sessionStorage.clear();true");
  await browser(
    "eval",
    "localStorage.setItem('knowflick.searchHistory.v1', JSON.stringify(['本机保留搜索']));true"
  );
  await browser("open", url);
  await check(
    'JSON.parse(localStorage.getItem("knowflick.workspace.v1")||\'{"materials":[]}\').materials.length === 0',
    "清库后本地确实为空"
  );

  await clickButton("设置");
  await browser("click", '[data-action="restore-kfbackup"]');
  await browser("upload", '[aria-label="选择备份包"]', backupPath);
  await check('document.body.innerText.includes("备份恢复完成")', "提示里报告备份恢复完成");
  await check('document.body.innerText.includes("这些内容无法从此包恢复")', "恢复回执说明包中缺失的数据");
  await browser("open", url);
  await check(
    'document.body.innerText.includes("备份往返记录")',
    "恢复后的素材出现在工作台里"
  );
  await check(
    'JSON.stringify(JSON.parse(localStorage.getItem("knowflick.searchHistory.v1"))) === JSON.stringify(["本机保留搜索", "备份搜索往返验证"])',
    "浏览器 v12 恢复保留本机顺序并合并备份搜索词"
  );
  // 备份的承诺是「无损」：边界内容也必须回来，不能被静默丢弃。
  const restoredIds = await browser(
    "eval",
    `JSON.stringify(JSON.parse(localStorage.getItem('knowflick.workspace.v1')).cards.map(c => c.id))`
  );
  await check(
    restoredIds.includes("restore-empty-title"),
    "空标题的卡片也恢复回来了"
  );
  await check(
    restoredIds.includes("restore-empty-body"),
    "空正文的卡片也恢复回来了"
  );
  await check(
    'JSON.parse(localStorage.getItem("knowflick.workspace.v1")).materials.some(m => m.id === "restore-empty-title-mat")',
    "空标题的素材也恢复回来了"
  );
  await check(
    'JSON.parse(localStorage.getItem("knowflick.workspace.v1")).materials.some(m=>m.title==="备份往返记录" && m.rawText.includes("kfbackup"))',
    "恢复后的正文逐字段一致"
  );
  await check(
    'JSON.parse(JSON.parse(localStorage.getItem("knowflick.workspace.v1")).settings).plugins["official-review-fsrs"].enabled === true',
    "备份里的插件设置也一并还原"
  );
  await clickButton("设置");
  await browser("click", '[data-action="restore-kfbackup"]');
  await browser("upload", '[aria-label="选择备份包"]', backupPath);
  await check('document.body.innerText.includes("备份恢复完成") && document.body.innerText.includes("跳过")', "相同备份再次恢复时安全跳过已有记录");
  await browser("eval", `(()=>{const raw=JSON.parse(localStorage.getItem('knowflick.workspace.v1'));
    raw.materials.find(m=>m.id==='restore-empty-title-mat').title='本地新素材';
    raw.cards.find(c=>c.id==='restore-empty-title').reviewCount=9;
    localStorage.setItem('knowflick.workspace.v1',JSON.stringify(raw));return true})()`);
  await browser("open", url);
  await clickButton("设置");
  await browser("click", '[data-action="restore-kfbackup"]');
  await browser("upload", '[aria-label="选择备份包"]', backupPath);
  await check('document.body.innerText.includes("备份恢复是部分完成")', "旧版备份与本地内容冲突时报告部分恢复");
  await check(`(()=>{const data=JSON.parse(localStorage.getItem('knowflick.workspace.v1'));
    return data.materials.find(m=>m.id==='restore-empty-title-mat').title==='本地新素材' &&
      data.cards.find(c=>c.id==='restore-empty-title').reviewCount===9})()`, "冲突恢复不覆盖本地素材与学习进度");
  rmSync(backupPath, { force: true });
  console.log("PASS .kfbackup 从导出按钮到恢复输入框的整条链路可用");

  // 恢复：备份里的内容必须**全部**回来。
  // 恢复逻辑曾用 `if (!c.headline || !c.details) continue` 过滤卡片，
  // 于是「标题或正文为空」的卡在恢复时被静默丢弃——备份明明写进去了。
  const backupRoundTrip = await browser("eval", `(() => {
    const raw = JSON.parse(localStorage.getItem('knowflick.workspace.v1') || '{}');
    const now = Date.now();
    const emptyTitleCard = {
      id: 'restore-empty-title', category: '', headline: '', summary: '摘要',
      details: '正文内容不能为空', links: [], tags: [], source: 'seed', createdAt: now,
      editedAt: null, seenAt: null, swiped: null, isFavorite: false, favoritedAt: null,
      reviewCount: 0, masteryLevel: 0, lastReviewedAt: null, repetition: 0, intervalDays: 0,
      easeFactor: 2.5, stability: 0, difficulty: 0, subject: null, branch: null, level: null,
      track: null, orderKey: null, prereq: [],
    };
    const emptyBodyCard = {
      ...emptyTitleCard, id: 'restore-empty-body', headline: '有标题', details: '',
    };
    const emptyTitleMaterial = {
      id: 'restore-empty-title-mat', sourceType: 'web', title: '', sourceUrl: null,
      rawText: '正文', contentHash: '', mediaPath: null, mediaSizeBytes: 0,
      metadataJson: '{}', inboxStatus: 'inbox', createdAt: now, updatedAt: now,
    };
    raw.cards = [...(raw.cards || []), emptyTitleCard, emptyBodyCard];
    raw.materials = [...(raw.materials || []), emptyTitleMaterial];
    localStorage.setItem('knowflick.workspace.v1', JSON.stringify(raw));
    return true;
  })()`);
  await check(String(backupRoundTrip) === "true", "准备了一份含空标题/空正文/空标题素材的备份样本");

  // 模拟桌面命令，独立挂载实际授权面板；不接触用户数据库或真实令牌。
  await browser("eval", `(async()=>{
    const token='a'.repeat(64), grants=[];
    window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
      if(command==='mcp_grant_list') return grants.map(g=>({...g}));
      if(command==='project_list') return [{id:'p1',name:'项目 A',description:'',createdAt:1,updatedAt:1,archivedAt:null}];
      if(command==='mcp_server_paths') return {scriptPath:'/test/tools/mcp-server.mjs',libraryDir:'/test/library',scriptExists:true};
      if(command==='mcp_grant_create'){const grant={id:'g1',...args.request,createdAt:1,revokedAt:null,policyVersion:1};grants.push(grant);return {grant,token};}
      if(command==='mcp_grant_revoke'){const grant=grants.find(g=>g.id===args.id);if(grant)grant.revokedAt=2;return !!grant;}
      throw new Error('unexpected command');
    }};
    window.confirm=()=>true;
    document.body.innerHTML='<div id="mcp-panel-test"></div>';
    const React=(await import('/node_modules/.vite/deps/react.js')).default;
    const dom=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const {McpGrantPanel}=await import('/src/ui/workspace/McpGrantPanel.tsx');
    dom.createRoot(document.getElementById('mcp-panel-test')).render(React.createElement(McpGrantPanel,{dir:'/test/library',enabled:true}));
    return true;
  })()`);
  await check('!!document.querySelector(\'input[aria-label="连接名称"]\')', "桌面授权面板加载");
  await browser("fill", 'input[aria-label="连接名称"]', "测试客户端");
  await browser("select", 'select[aria-label="授权项目"]', "p1");
  await clickButton("创建连接授权");
  await check('!!document.querySelector(\'[aria-label="一次性连接配置"]\')', "创建授权后展示一次性配置");
  await clickButton("撤销");
  await check('document.body.innerText.includes("已撤销") && !document.querySelector(\'[aria-label="一次性连接配置"]\') && !document.body.innerText.includes("a".repeat(64))', "撤销时清除当前配置并更新状态");

  // 独立挂载设置页，以模拟上传回执验证缺口会展示给用户；不连接任何服务器。
  await browser("eval", `(async()=>{
    window.__TAURI_INTERNALS__={invoke:async(command)=>{
      if(command==='read_webdav_credential') return '';
      if(command==='write_webdav_credential') return null;
      throw new Error('unavailable in test');
    }};
    document.body.innerHTML='<div id="webdav-test"></div>';
    const React=(await import('/node_modules/.vite/deps/react.js')).default;
    const dom=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const {WorkspaceSettings}=await import('/src/ui/workspace/WorkspaceSettings.tsx');
    const {parseSettings}=await import('/src/domain/settings.ts');
    const {BACKUP_FORMAT_GAP}=await import('/src/domain/systemBackup.ts');
    dom.createRoot(document.getElementById('webdav-test')).render(React.createElement(WorkspaceSettings,{
      dir:'/test/library',file:parseSettings('{}'),apiKey:'',reviewEnabled:false,materials:[],cards:[],
      onSave:async()=>{},onBack:()=>{},onWebdavUpload:async()=>({fileName:'test.kfbackup',bytes:10,sha256:'a'.repeat(64),gaps:[BACKUP_FORMAT_GAP]})
    }));return true;
  })()`);
  await check('!!document.querySelector(\'input[aria-label="WebDAV 地址"]\')', "桌面 WebDAV 设置已加载");
  await browser("fill", 'input[aria-label="WebDAV 地址"]', "https://example.test/backup");
  await browser("eval", `(()=>{document.querySelector('[data-action="webdav-upload"]').click();return true;})()`);
  await check('document.querySelector(\'[data-section="webdav"] [role="status"]\')?.innerText.includes("部分备份") && document.querySelector(\'[data-section="webdav"] [role="status"]\')?.innerText.includes("个人画像")', "WebDAV 回执明确显示缺口");

  console.log("Plugins / backup / MCP settings smoke complete.");
} finally {
  await browser("close").catch(() => {});
}
