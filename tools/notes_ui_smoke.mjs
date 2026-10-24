#!/usr/bin/env node
/** 笔记本体回归：手写与语音是「笔记软件」的基本盘，必须能记、能落库。 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
const exec = promisify(execFile);
const session = "knowflick-notes-smoke";
const url = process.env.KNOWFLICK_UI_URL || "http://localhost:1420";
// 假麦克风：让「真的按下录音键」这条路径能在没有硬件与麦克风权限的机器上跑
// （CI 的 runner 与普通开发机都没有麦克风）。Chrome 的
// --use-fake-device-for-media-stream 提供一个合成音频输入。
const BROWSER_ARGS = "--use-fake-device-for-media-stream,--use-fake-ui-for-media-stream,--autoplay-policy=no-user-gesture-required";
const b = async (...args) => (await exec("agent-browser", ["--session", session, "--args", BROWSER_ARGS, ...args], { timeout: 25000 })).stdout.trim();
const ev = async code => { const r = JSON.parse(await b("eval", `JSON.stringify(${code})`)); return typeof r === "string" ? JSON.parse(r) : r; };
let count = 0;
async function check(expression, label) {
  for (let n = 0; n < 40; n++) {
    if (await ev(expression)) { count++; console.log(`PASS ${label}`); return true; }
    await new Promise(r => setTimeout(r, 100));
  }
  assert.fail(label);
  return false;
}
const stroke = async (points) => b("eval", `(()=>{const c=document.querySelector('.ink-canvas');const r=c.getBoundingClientRect();
  const fire=(t,x,y)=>c.dispatchEvent(new PointerEvent(t,{clientX:r.left+x,clientY:r.top+y,pointerId:1,bubbles:true,buttons:t==='pointerup'?0:1}));
  fire('pointerdown',${points[0][0]},${points[0][1]});
  ${points.slice(1).map(([x, y]) => `fire('pointermove',${x},${y});`).join("")}
  fire('pointerup',${points.at(-1)[0]},${points.at(-1)[1]});
  return true})()`);

try {
  await b("set", "viewport", "1040", "760");
  await b("open", url);
  await b("eval", "localStorage.clear();sessionStorage.clear();true");
  await b("open", url);
  await check("!!document.querySelector('.ws')", "工作台就绪");

  // 三种记法并列在记录入口下
  // 记录入口并列多种记法：手写、语音、转写、笔记转卡。
  // 这里查「包含」而不是相等——以后再加一种记法，不该让这条断言失效。
  const captureLabels = await ev("[...document.querySelectorAll('.ws-capture-mode')].map(e=>e.getAttribute('aria-label')).join(',')");
  for (const label of ["手写笔记", "语音笔记", "导入音频转写", "笔记转知识卡"]) {
    assert.ok(captureLabels.includes(label), `记录入口应包含「${label}」，实际：${captureLabels}`);
  }
  count++;
  console.log("PASS 记录入口并列手写/语音/转写/笔记转卡");

  // 「转写」在 ASR 插件没开时不可用——但**必须可被发现**。
  // 禁用按钮不接收焦点、不派发鼠标事件：键盘用户 Tab 不到、鼠标点了没反应，
  // 连 title 都看不到——界面上就多出一个没人知道为什么灰掉的入口。
  await check(
    "(()=>{const el=document.querySelector('.ws-capture-mode[aria-label=\"导入音频转写\"]');if(!el)return false;el.focus();return document.activeElement===el})()",
    "不可用的「转写」入口仍能被键盘聚焦"
  );
  await check(
    "document.querySelector('.ws-capture-mode[aria-label=\"导入音频转写\"]').getAttribute('aria-disabled')==='true'",
    "「转写」入口在插件未启用时标为不可用"
  );
  await b("eval", "(()=>{document.querySelector('.ws-capture-mode[aria-label=\"导入音频转写\"]').click();return true})()");
  await new Promise((r) => setTimeout(r, 400));
  await check(
    "document.body.innerText.includes('插件未启用') && document.body.innerText.includes('功能模块与官方插件')",
    "激活不可用的「转写」入口会说明原因与下一步"
  );
  // 不可用也要**看起来**不可用：浏览器只给 :disabled 默认灰化，aria-disabled 没有。
  // 不补样式的话，「转写」和旁边可用的「手写 / 语音」长得一模一样（实测颜色相同）。
  await check(
    "(()=>{const d=document.querySelector('.ws-capture-mode[aria-label=\"导入音频转写\"]');const e=document.querySelector('.ws-capture-mode[aria-label=\"手写笔记\"]');if(!d||!e)return false;return parseFloat(getComputedStyle(d).opacity) < parseFloat(getComputedStyle(e).opacity)})()",
    "不可用的「转写」入口看起来也不可用（比可用的淡）"
  );

  // 手写
  await b("click", '[aria-label="手写笔记"]');
  await check("!!document.querySelector('.ink-canvas')", "手写板打开");
  await check("document.querySelector('.ink-canvas').getAttribute('aria-label').includes('0 笔')", "空画布显示 0 笔");
  await check("[...document.querySelectorAll('.ink-swatch')].length===3", "提供三档笔色");
  await check("[...document.querySelectorAll('.ink-width')].length===3", "提供三档笔宽");
  await stroke([[60, 80], [120, 110], [180, 90], [240, 130]]);
  await stroke([[80, 200], [160, 220], [260, 190]]);
  await check("document.querySelector('.ink-canvas').getAttribute('aria-label').includes('2 笔')", "画两笔后计数正确");
  await b("eval", "(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='撤销').click();return true})()");
  await check("document.querySelector('.ink-canvas').getAttribute('aria-label').includes('1 笔')", "撤销按笔回退");
  await stroke([[90, 150], [200, 170], [300, 150]]);
  await check("document.querySelector('.ink-canvas').getAttribute('aria-label').includes('2 笔')", "撤销后可继续书写");

  // 「清空」把所有笔迹一次抹掉，**不可撤销**（撤销只退一笔）。
  // 所以第一下只能进入确认态，笔迹必须还在。
  await b("eval", "(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='清空').click();return true})()");
  await check("document.querySelector('.ink-canvas').getAttribute('aria-label').includes('2 笔')", "清空前要二次确认（笔迹还在）");
  await check("[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='确认')", "清空第一次点击进入确认态");
  await b("eval", "(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='确认').click();return true})()");
  await check("document.querySelector('.ink-canvas').getAttribute('aria-label').includes('0 笔')", "再点一次才真的清空");
  // 清空之后重新写两笔——后面的保存步骤要保存的是有内容的笔记。
  await stroke([[70, 90], [150, 120], [230, 95]]);
  await stroke([[90, 190], [180, 215], [270, 185]]);
  await check("document.querySelector('.ink-canvas').getAttribute('aria-label').includes('2 笔')", "清空后可以重新书写");

  // 保存 → 落进收件箱，且笔迹写进素材
  await b("eval", "(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.includes('保存手写笔记')).click();return true})()");
  // 回执走 .ws-feedback（aria-live 区），不是底部状态栏。
  // 提示条 4 秒后自动消失（Workspace 里 notice 的定时器）。**不能**用外层
  // check() 轮询抓它：每次轮询要起一次 agent-browser（CI 上 250ms~1s），
  // 40 次轮询的采样间隔可能整个错过 4 秒窗口——CI 上因此红过两次
  // （977d132 与 cf9e8e9）。改为**页面内**轮询：一次 eval 在浏览器里盯
  // 6 秒（覆盖提示条完整寿命），抓到与否都带回现场文本。
  // 不能把 async IIFE 直接交给 ev——JSON.stringify(Promise) 是 "{}"（本文件
  // 语音段落的既有教训）。先把轮询结果写进 window 标志，再轮读标志。
  await b("eval", `(() => {
    window.__inkReceipt = { done: false, found: false, sample: "" };
    (async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 6000) {
        if (document.body.innerText.includes("手写笔记已存入收件箱")) {
          window.__inkReceipt = { done: true, found: true, sample: "" };
          return;
        }
        await new Promise((r) => setTimeout(r, 80));
      }
      window.__inkReceipt = { done: true, found: false, sample: document.body.innerText.slice(0, 200) };
    })();
    return true;
  })()`);
  const receipt = await check("window.__inkReceipt?.done && window.__inkReceipt?.found", "保存后有明确回执");
  if (!receipt) {
    const detail = await ev("JSON.stringify(window.__inkReceipt)");
    console.error(`现场：${detail}`);
  }
  await check("!document.querySelector('.ink-canvas')", "保存后关闭手写板");
  await check("(()=>{const raw=JSON.parse(localStorage.getItem('knowflick.workspace.v1'));return raw.materials.some(m=>m.sourceType==='ink')})()", "手写笔记落成素材");
  await check("(()=>{const raw=JSON.parse(localStorage.getItem('knowflick.workspace.v1'));const m=raw.materials.find(x=>x.sourceType==='ink');const meta=JSON.parse(m.metadataJson);return meta.ink.strokes.length===2})()", "笔迹随素材保存");
  await check("(()=>{const raw=JSON.parse(localStorage.getItem('knowflick.workspace.v1'));const m=raw.materials.find(x=>x.sourceType==='ink');return m.title.includes('手写笔记')&&m.title.includes('2 笔')})()", "手写笔记标题可辨认");
  // 重绘：保存后阅读区要**真的画出笔迹**，不是摆个空画布。
  // 只验「素材里有 strokes」不够——笔迹可能在读回时没画出来，用户看到的是空白。
  // 判据用**像素**：canvas 上必须有非透明像素。
  await check("(()=>{const c=document.querySelector('.ws-reader canvas');if(!c)return false;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=3;i<d.length;i+=4){if(d[i]!==0)return true}return false})()", "保存后阅读区真的重绘出笔迹（有非透明像素）");

  // 空画布不允许保存
  await b("click", '[aria-label="手写笔记"]');
  await check("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('保存手写笔记')).disabled===false", "空画布按钮可点但会校验");
  await b("eval", "(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.includes('保存手写笔记')).click();return true})()");
  await check("document.body.innerText.includes('还没有落笔')", "空画布保存给出可读原因");
  await b("eval", "(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='取消').click();return true})()");

  // 语音
  await b("click", '[aria-label="语音笔记"]');
  await check("!!document.querySelector('.voice-recorder')", "语音面板打开");
  await check("document.querySelector('.voice-status').textContent.includes('准备录音')", "语音面板初始为准备录音");
  await check("document.body.innerText.includes('不上传音频')", "录音说明本地处理");
  await check("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('保存语音笔记')).disabled===true", "没有录音时不能保存");
  await b("eval", "(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='取消').click();return true})()");
  await check("!document.querySelector('.voice-recorder')", "语音面板可取消");

  // 真的按下录音键：这条路径此前**从未跑过**（验收清单里长期空白的一条）。
  // 用 Chrome 的假麦克风（--use-fake-device-for-media-stream）——不需要真硬件，
  // 也不需要麦克风权限，CI 与本机都能跑。
  await b("click", '[aria-label="语音笔记"]');
  await check("!!document.querySelector('.voice-recorder')", "再次打开语音面板");
  await b("eval", "(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.includes('开始录音')).click();return true})()");
  await check(
    "document.querySelector('.voice-status')?.dataset.state === 'recording'",
    "按下后进入录音状态",
  );
  await new Promise((r) => setTimeout(r, 1200));
  await check(
    "/[1-9]\\d* 秒/.test(document.querySelector('.voice-status .ws-hint')?.textContent ?? '')",
    "录音计时实际前进（不是一直 0 秒）",
  );
  await b("eval", "(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.includes('停止录音')).click();return true})()");
  await check(
    "document.querySelector('.voice-status')?.dataset.state === 'ready'",
    "停止后进入可保存状态",
  );
  await check("!!document.querySelector('.voice-audio')", "录到的音频可回放");
  // 光有播放控件不够——还要确认录到的**字节真的是音频**。
  // 空 blob 也会渲染出 <audio>，用户点播放却什么也没有；
  // 一段非零但损坏的字节同样如此。所以用浏览器自己的解码器去读它：
  // 能解出时长与采样率，才说明录到的确实是一段音频。
  //
  // 注意：不能把 async IIFE 交给 check——`JSON.stringify(Promise)` 得到 "{}"，
  // 那会**恒真**。所以先把结果写进 window 标志，再读它。
  await b("eval", `(() => {
    window.__voiceAudio = null;
    const a = document.querySelector('.voice-audio');
    if (!a) return true;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    fetch(a.src)
      .then(res => res.arrayBuffer())
      .then(async buf => {
        const bytes = buf.byteLength;
        const decoded = await ctx.decodeAudioData(buf);
        window.__voiceAudio = { bytes, duration: decoded.duration, rate: decoded.sampleRate };
      })
      .catch(err => { window.__voiceAudio = { error: String(err && err.name || err) }; })
      .finally(() => ctx.close().catch(() => {}));
    return true;
  })()`);
  await check(
    "!!window.__voiceAudio && window.__voiceAudio.duration > 0 && window.__voiceAudio.bytes > 0 && window.__voiceAudio.rate > 0",
    "录到的字节能被解码成音频（有真实时长与采样率）",
  );
  await check(
    "[...document.querySelectorAll('button')].find(e=>e.textContent.includes('保存语音笔记')).disabled===false",
    "录到声音后可以保存",
  );
  // 真的保存：浏览器体验**不保存录音**（产品设计，界面会说明并让用户去桌面端），
  // 所以这里验的是「给出可执行的下一步」而不是落库——落库要真桌面端才有意义。
  await b("eval", "(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.includes('保存语音笔记')).click();return true})()");
  await new Promise((r) => setTimeout(r, 1200));
  await check(
    "/桌面客户端/.test(document.querySelector('.voice-error')?.textContent ?? '')",
    "浏览器里保存录音时说明要去桌面端（不是静默失败）",
  );
  // 但只说「去桌面客户端」是**断链**：用户被告知要去，却没地方去。
  // 必须给一条可点的路——否则这句话等于把人堵死。
  await check(
    "[...document.querySelectorAll('.voice-error button')].some(b => b.textContent.includes('下载桌面客户端'))",
    "提示之后就有可点的下载入口（不是只说一句桌面客户端）",
  );
  await check(
    "[...document.querySelectorAll('.voice-error a, .voice-error button')].length > 0",
    "下载入口是真实可点的元素",
  );

  console.log(`Notes UI smoke: ${count} checks passed.`);
} finally { await b("close").catch(() => {}); }
