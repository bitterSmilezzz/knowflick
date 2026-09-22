/**
 * KnowFlick MCP server 测试：`node --test tools/knowflick-mcp/`
 *
 * 覆盖两层：纯逻辑（检索/地图/路径/暂存校验）与真正的 stdio JSON-RPC 往返
 * （spawn 起 server，走 initialize → tools/list → tools/call，确认协议形状可用）。
 */

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { rpcClient } from "./test-client.mjs";
import { fileURLToPath } from "node:url";

import { browseMap, createLibraryReader, createSearcher, indexTaxonomy, learningPath, loadLibrary, stageCard, stats } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TAXONOMY = path.join(HERE, "..", "..", "shared", "assets", "taxonomy_map.json");

const CARDS = [
  {
    id: "C1", category: "中级会计", subject: "accounting", branch: "assets", level: 2, track: "中级会计",
    orderKey: "accounting/assets/0001", headline: "存货跌价准备按成本与可变现净值孰低计量",
    summary: "成本高于可变现净值时计提跌价准备", details: "存货跌价准备的计提以成本与可变现净值孰低为基础。\n\n转回时以原计提金额为限。",
    links: [], source: "seed", createdAt: "2026-01-01T00:00:00Z", seenAt: "2026-02-01T00:00:00Z", masteryLevel: 2, reviewCount: 3,
  },
  {
    id: "C2", category: "中级会计", subject: "accounting", branch: "assets", level: 3, track: "中级会计",
    orderKey: "accounting/assets/0002", headline: "双倍余额递减法前几年不考虑净残值",
    summary: "到期年份才改用直线法并考虑残值", details: "双倍余额递减法按账面净值乘固定折旧率，最后两年改直线法。",
    links: [], source: "seed", createdAt: "2026-01-02T00:00:00Z",
  },
  {
    id: "C3", category: "英语", subject: "english", branch: "grammar", level: 4, track: "大学英语六级",
    orderKey: "english/grammar/0001", headline: "定语从句中 which 与 that 的取舍",
    summary: "非限制性定语从句只能用 which", details: "逗号后的非限制性从句不能用 that 引导。",
    links: [{ title: "语法笔记", url: "https://example.com" }], source: "seed", createdAt: "2026-01-03T00:00:00Z",
  },
  {
    id: "C4", category: "物理", headline: "中子星靠中子简并压力对抗引力坍缩",
    summary: "钱德拉塞卡极限约 1.4 倍太阳质量", details: "超过极限会继续坍缩成黑洞。",
    links: [], source: "seed", createdAt: "2026-01-04T00:00:00Z",
  },
];

function fixtureLibrary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kf-mcp-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cardsFile = path.join(dir, "cards.json");
  fs.writeFileSync(cardsFile, JSON.stringify(CARDS));
  return { ...loadLibrary({ cardsFile, taxonomyFile: TAXONOMY }), allowWrite: true };
}

test("检索：中文 N-Gram 命中正确卡片并给出摘要", (t) => {
  const library = fixtureLibrary(t);
  const search = createSearcher(library.cards);
  const hits = search("存货跌价准备 可变现净值");
  assert.ok(hits.length > 0);
  assert.equal(hits[0].id, "C1");
  assert.ok(hits[0].snippet.includes("可变现净值"));
  assert.deepEqual(search("   ").map((hit) => hit.id), [], "空白查询不应返回结果");
  assert.ok(search("中子星简并压力").some((hit) => hit.id === "C4"));
});

test("检索：相同字段中稀有词的权重高于常见词", () => {
  const cards = ["rare", "common", "common", "common"].map((headline, i) => ({
    id: String(i), headline, summary: "", details: "", category: "",
  }));
  const hits = createSearcher(cards)("rare common");
  assert.equal(hits[0].headline, "rare");
  assert.ok(hits[0].score > hits[1].score);
});

test("检索：不跨标点、空格或英文拼接中文词", () => {
  for (const headline of ["成本，收益", "成本 收益", "成本 versus 收益"]) {
    const search = createSearcher([{ id: "split", headline, summary: "", details: "", category: "" }]);
    assert.deepEqual(search("本收"), []);
    assert.equal(search("成本")[0].id, "split");
  }
});

test("暂存：原始输入先校验，拒绝非法类型和被 truthy 判断漏掉的难度", (t) => {
  const library = fixtureLibrary(t);
  const before = fs.readFileSync(library.cardsPath, "utf8");
  const valid = { headline: "新卡", summary: "摘要", details: "正文" };
  assert.equal(stageCard(library, valid).ok, true);
  const stagedBefore = fs.readFileSync(library.stagedPath, "utf8");
  const invalid = [null, [], "text", ...[0, false, "", null, "2", 1.5, 6].map((level) => ({ ...valid, level })),
    { ...valid, headline: {} }, { ...valid, details: 42 }, { ...valid, category: [] },
    { ...valid, links: [{ title: 1, url: "https://example.com" }] }];
  for (const input of invalid) {
    const result = stageCard(library, input);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.ok(result.issues.length > 0);
  }
  assert.equal(fs.readFileSync(library.stagedPath, "utf8"), stagedBefore);
  assert.equal(fs.readFileSync(library.cardsPath, "utf8"), before);
});

test("CLI：无卡库时仍可看帮助", (t) => {
  const library = fixtureLibrary(t);
  const missing = path.join(path.dirname(library.cardsPath), "missing.json");
  for (const args of [[], ["--help"], ["help"], ["search", "--help"]]) {
    const output = execFileSync(process.execPath, [path.join(HERE, "kf.mjs"), ...args, "--cards", missing], { encoding: "utf8" });
    assert.match(output, /用法：/);
  }
});

test("CLI：旧分类卡片详情使用地图同一学科派生规则", (t) => {
  const library = fixtureLibrary(t);
  fs.writeFileSync(library.cardsPath, JSON.stringify([{ ...CARDS[0], subject: undefined, branch: undefined, track: undefined }]));
  const derived = browseMap(loadLibrary({ cardsFile: library.cardsPath, taxonomyFile: TAXONOMY }))[0];
  const output = execFileSync(process.execPath, [path.join(HERE, "kf.mjs"), "get", "C1", "--cards", library.cardsPath], { encoding: "utf8" });
  assert.ok(output.includes(`学科: ${derived.name}`));
});

test("资源：仓库路径含空格与中文时仍可加载默认学科契约", async (t) => {
  const library = fixtureLibrary(t);
  const root = path.join(path.dirname(library.cardsPath), "知识库 with spaces");
  const moduleDir = path.join(root, "tools", "knowflick-mcp");
  const assets = path.join(root, "shared", "assets");
  fs.mkdirSync(moduleDir, { recursive: true });
  fs.mkdirSync(assets, { recursive: true });
  fs.copyFileSync(path.join(HERE, "lib.mjs"), path.join(moduleDir, "lib.mjs"));
  fs.copyFileSync(TAXONOMY, path.join(assets, "taxonomy_map.json"));
  const { pathToFileURL } = await import("node:url");
  const copied = await import(pathToFileURL(path.join(moduleDir, "lib.mjs")).href);
  assert.deepEqual(copied.loadLibrary({ cardsFile: library.cardsPath }).taxonomy, library.taxonomy);
});

test("地图：按学科分组、未分级排最后、进度可算", (t) => {
  const library = fixtureLibrary(t);
  const map = browseMap(library);
  assert.deepEqual(map.map((row) => row.subject), ["accounting", "english", null]);
  const accounting = map[0];
  assert.equal(accounting.cards, 2);
  assert.equal(accounting.seen, 1);
  assert.equal(accounting.mastered, 1);
  assert.equal(accounting.branches[0].name, "资产");
  assert.equal(accounting.branches[0].levels[0].level, 2);
  assert.equal(map[2].name, "未分级");
});

test("路径：按 orderKey 推进，includeSeen=false 能跳过已学", (t) => {
  const library = fixtureLibrary(t);
  const full = learningPath(library, { subject: "accounting", branch: "assets" });
  assert.deepEqual(full.map((step) => step.id), ["C1", "C2"]);
  assert.equal(full[0].position, 1);
  assert.equal(full[0].seen, true);
  const remaining = learningPath(library, { subject: "accounting", branch: "assets", includeSeen: false });
  assert.deepEqual(remaining.map((step) => step.id), ["C2"], "已学过的不应再排进路径");
  assert.deepEqual(learningPath(library, { subject: "nope" }), []);
});

test("统计：未分级数量与学科分布", (t) => {
  const library = fixtureLibrary(t);
  const summary = stats(library);
  assert.equal(summary.cards, 4);
  assert.equal(summary.ungraded, 1);
  assert.equal(summary.bySubject[0].cards, 2);
  // name 必须是学科中文名，不是 slug（曾把 "accounting" 直接当名字返回）
  assert.equal(summary.bySubject[0].subject, "accounting");
  assert.equal(summary.bySubject[0].name, "会计");
  assert.equal(summary.bySubject.at(-1).name, "未分级");
  assert.equal(summary.bySubject.at(-1).subject, null);
});

test("暂存：非法学科/难度被拦，合法卡进队列且去重", (t) => {
  const library = fixtureLibrary(t);
  const index = indexTaxonomy(library.taxonomy);

  const bad = stageCard(library, { headline: "x", summary: "y", details: "z", subject: "english", branch: "nope", level: 9 }, index);
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.some((issue) => issue.includes("分支")));
  assert.ok(bad.issues.some((issue) => issue.includes("level")));

  const good = stageCard(library, {
    headline: "收入确认五步法", summary: "合同为基础", details: "识别合同→识别履约义务→确定交易价格→分摊→确认收入",
    subject: "accounting", branch: "revenue", level: 3, track: "中级会计",
  }, index);
  assert.equal(good.ok, true);
  assert.equal(good.position, 1);

  const duplicate = stageCard(library, { headline: "收入确认五步法", summary: "重复", details: "重复内容", subject: "accounting" }, index);
  assert.equal(duplicate.ok, false, "同标题不应重复入队");

  // 暂存文件必须与 cards.json 同构，App 的「导入归档数据」才能直接吃它
  const queue = JSON.parse(fs.readFileSync(library.stagedPath, "utf8"));
  assert.equal(queue.length, 1);
  assert.equal(queue[0].source, "ai");
  assert.equal(queue[0].subject, "accounting");
});

test("协议：stdio 上 initialize / tools/list / tools/call 往返可用", async (t) => {
  const library = fixtureLibrary(t);
  const child = spawn(process.execPath, [path.join(HERE, "server.mjs"), "--cards", library.cardsPath, "--allow-write"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => child.kill());

  const request = rpcClient(child);

  const init = await request({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.equal(init.result.serverInfo.name, "knowflick");
  assert.ok(init.result.capabilities.tools);

  const listed = await request({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const names = listed.result.tools.map((tool) => tool.name);
  assert.ok(names.includes("kf_search") && names.includes("kf_stage_card"), "开写模式应暴露暂存工具");
  assert.ok(listed.result.tools.every((tool) => tool.inputSchema?.type === "object"));

  const called = await request({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "kf_search", arguments: { query: "定语从句 which that" } } });
  assert.equal(called.result.isError, false);
  const payload = JSON.parse(called.result.content[0].text);
  assert.equal(payload.hits[0].id, "C3");

  const unknown = await request({ jsonrpc: "2.0", id: 4, method: "resources/list", params: {} });
  assert.equal(unknown.error.code, -32601, "未实现的方法要按 JSON-RPC 报错");

  const brokenTool = await request({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "kf_nope", arguments: {} } });
  assert.equal(brokenTool.error.code, -32602);
  child.stdin.end();
});

test("协议：默认只读，不暴露写工具", async (t) => {
  const library = fixtureLibrary(t);
  const child = spawn(process.execPath, [path.join(HERE, "server.mjs"), "--cards", library.cardsPath], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill());

  const request = rpcClient(child);
  await request({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
  const listed = await request({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.ok(!listed.result.tools.some((tool) => tool.name === "kf_stage_card"), "未加 --allow-write 时不应暴露写工具");
  child.stdin.end();
});

test("CLI 与 MCP 同一结果：Skill 里那句「两条路查到的必须一致」是真的", async (t) => {
  const library = fixtureLibrary(t);
  const query = "定语从句 which that";

  const cli = JSON.parse(
    execFileSync(process.execPath, [path.join(HERE, "kf.mjs"), "search", query, "--json", "--cards", library.cardsPath], { encoding: "utf8" }),
  );

  const child = spawn(process.execPath, [path.join(HERE, "server.mjs"), "--cards", library.cardsPath], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill());
  const request = rpcClient(child);
  await request({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
  const called = await request({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "kf_search", arguments: { query } } });
  child.stdin.end();

  const mcp = JSON.parse(called.result.content[0].text);
  // 顺序也断言：同一层逻辑不该出现「同样几条、顺序不同」
  assert.deepEqual(cli.hits.map((hit) => hit.id), mcp.hits.map((hit) => hit.id));
  assert.deepEqual(cli.hits.map((hit) => hit.score), mcp.hits.map((hit) => hit.score));

  const cliMap = JSON.parse(
    execFileSync(process.execPath, [path.join(HERE, "kf.mjs"), "map", "--json", "--cards", library.cardsPath], { encoding: "utf8" }),
  );
  assert.deepEqual(cliMap.subjects.map((row) => row.subject), browseMap(library).map((row) => row.subject), "学科顺序也要一致");
});

test("CLI：暂存是唯一写口，非法学科被拦且绝不碰 cards.json", (t) => {
  const library = fixtureLibrary(t);
  const before = fs.readFileSync(library.cardsPath, "utf8");

  const rejected = execFileSync(
    process.execPath,
    [path.join(HERE, "kf.mjs"), "stage", "--cards", library.cardsPath, "--card", JSON.stringify({ headline: "坏卡", summary: "s", details: "d", subject: "no-such-subject" })],
    { encoding: "utf8" },
  );
  assert.match(rejected, /暂存被拒绝/);
  assert.equal(fs.existsSync(library.stagedPath), false, "被拒的卡不该进队列");

  const accepted = execFileSync(
    process.execPath,
    [path.join(HERE, "kf.mjs"), "stage", "--cards", library.cardsPath, "--card", JSON.stringify({ headline: "CLI 暂存卡", summary: "s", details: "d", subject: "accounting", level: 2 })],
    { encoding: "utf8" },
  );
  assert.match(accepted, /已暂存第 1 张/);
  assert.match(accepted, /导入归档数据/, "必须把「还要人工确认」这一步告诉调用方");
  assert.equal(fs.readFileSync(library.cardsPath, "utf8"), before, "cards.json 一个字节都不许变");
  assert.equal(JSON.parse(fs.readFileSync(library.stagedPath, "utf8"))[0].headline, "CLI 暂存卡");
});

test("快照：未变化复用，等长原子替换与契约更新使缓存失效", (t) => {
  const library = fixtureLibrary(t);
  const taxonomyFile = path.join(path.dirname(library.cardsPath), "taxonomy.json");
  fs.copyFileSync(TAXONOMY, taxonomyFile);
  const read = createLibraryReader({ cardsFile: library.cardsPath, taxonomyFile });
  const first = read();
  assert.equal(read(), first);
  const replaced = JSON.stringify(CARDS).replace('"C1"', '"D1"');
  const temp = `${library.cardsPath}.replacement`;
  fs.writeFileSync(temp, replaced);
  const oldStat = fs.statSync(library.cardsPath);
  fs.utimesSync(temp, oldStat.atime, oldStat.mtime);
  fs.renameSync(temp, library.cardsPath);
  const second = read();
  assert.notEqual(second, first);
  assert.equal(second.cards[0].id, "D1");
  const taxonomy = JSON.parse(fs.readFileSync(taxonomyFile, "utf8"));
  taxonomy.levels[1] = "新的入门名称";
  fs.writeFileSync(taxonomyFile, JSON.stringify(taxonomy));
  assert.equal(read().taxonomy.levels[1], "新的入门名称");
});

test("长连接：增删改刷新所有读取工具，坏文件报错，修复后自动恢复", async (t) => {
  const library = fixtureLibrary(t);
  const child = spawn(process.execPath, [path.join(HERE, "server.mjs"), "--cards", library.cardsPath, "--allow-write"]);
  t.after(() => child.kill());
  const request = rpcClient(child);
  let id = 0;
  const call = (name, args = {}) => request({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } });
  const value = async (name, args) => {
    const response = await call(name, args);
    assert.equal(response.result.isError, false);
    return JSON.parse(response.result.content[0].text);
  };
  assert.equal((await value("kf_stats")).cards, 4);
  const updated = [{ ...CARDS[0], id: "NEW", headline: "实时刷新标记", seenAt: null }];
  fs.writeFileSync(`${library.cardsPath}.new`, JSON.stringify(updated));
  fs.renameSync(`${library.cardsPath}.new`, library.cardsPath);
  assert.equal((await value("kf_stats")).cards, 1);
  assert.equal((await value("kf_get_card", { id: "C1" })).found, false);
  assert.equal((await value("kf_get_card", { id: "NEW" })).card.headline, "实时刷新标记");
  assert.equal((await value("kf_search", { query: "实时刷新" })).hits[0].id, "NEW");
  assert.equal((await value("kf_browse_map")).subjects[0].cards, 1);
  assert.equal((await value("kf_learning_path", { subject: "accounting", includeSeen: false })).steps[0].id, "NEW");
  fs.writeFileSync(library.cardsPath, "[");
  assert.equal((await call("kf_stats")).result.isError, true);
  fs.unlinkSync(library.cardsPath);
  assert.equal((await call("kf_stats")).result.isError, true);
  fs.writeFileSync(library.cardsPath, JSON.stringify(CARDS));
  assert.equal((await value("kf_stats")).cards, 4);
  assert.equal((await call("kf_stage_card", { headline: "坏卡", summary: "s", details: "d", level: 0 })).result.isError, true);
});

test("暂存：多进程共享写入口不丢卡，重复标题只接受一次", async (t) => {
  const library = fixtureLibrary(t);
  const before = fs.readFileSync(library.cardsPath, "utf8");
  // 子进程先各自启动，再以同一轮请求触发写入，覆盖锁竞争。
  const code = `import readline from 'node:readline';
    import {loadLibrary,stageCard} from ${JSON.stringify(new URL('./lib.mjs', import.meta.url).href)};
    const library=loadLibrary({cardsFile:process.argv[1]});
    readline.createInterface({input:process.stdin}).on('line',line=>{
      const request=JSON.parse(line);
      const result=request.method==='ready'?{}:stageCard(library,request.params);
      process.stdout.write(JSON.stringify({id:request.id,result})+'\\n');
    });`;
  const clients = Array.from({ length: 8 }, () => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code, library.cardsPath]);
    t.after(() => child.kill());
    return rpcClient(child, 10000);
  });
  await Promise.all(clients.map((request) => request({ id: 1, method: "ready" })));
  const results = await Promise.all(clients.map((request, i) => request({ id: 2, method: "stage", params: { headline: `并发卡片 ${i}`, summary: "s", details: "d" } })));
  assert.ok(results.every((response) => response.result.ok));
  const duplicate = await Promise.all(clients.map((request) => request({ id: 3, method: "stage", params: { headline: "同一标题", summary: "s", details: "d" } })));
  assert.equal(duplicate.filter((response) => response.result.ok).length, 1);
  const queue = JSON.parse(fs.readFileSync(library.stagedPath, "utf8"));
  assert.equal(queue.length, 9);
  assert.equal(new Set(queue.map((card) => card.headline)).size, 9);
  assert.equal(fs.readFileSync(library.cardsPath, "utf8"), before);
  assert.deepEqual(fs.readdirSync(path.dirname(library.stagedPath)).sort(), ["cards.json", "staged_cards.json"]);
});

test("暂存：替换失败保留旧文件并清理临时文件与锁", (t) => {
  const library = fixtureLibrary(t);
  const input = { headline: "已有卡", summary: "s", details: "d" };
  stageCard(library, input);
  const before = fs.readFileSync(library.stagedPath, "utf8");
  const rename = t.mock.method(fs, "renameSync", () => { throw new Error("模拟替换失败"); });
  assert.throws(() => stageCard(library, { ...input, headline: "新卡" }), /模拟替换失败/);
  assert.equal(fs.readFileSync(library.stagedPath, "utf8"), before);
  assert.deepEqual(fs.readdirSync(path.dirname(library.stagedPath)).sort(), ["cards.json", "staged_cards.json"]);
  rename.mock.restore();
  assert.equal(stageCard(library, { ...input, headline: "重试" }).ok, true);
});

test("暂存：损坏的队列不会被覆盖，失败后释放锁", (t) => {
  const library = fixtureLibrary(t);
  fs.writeFileSync(library.stagedPath, "[");
  assert.throws(() => stageCard(library, { headline: "新卡", summary: "s", details: "d" }));
  assert.equal(fs.readFileSync(library.stagedPath, "utf8"), "[");
  assert.equal(fs.existsSync(`${library.stagedPath}.lock`), false);
});

test("暂存：已有锁超时后报错，不抢锁或更改队列", (t) => {
  const library = fixtureLibrary(t);
  fs.writeFileSync(`${library.stagedPath}.lock`, "existing lock");
  assert.throws(() => stageCard(library, { headline: "新卡", summary: "s", details: "d" }), /暂存队列正被占用/);
  assert.equal(fs.readFileSync(`${library.stagedPath}.lock`, "utf8"), "existing lock");
  assert.equal(fs.existsSync(library.stagedPath), false);
});

test("测试客户端：响应拆片、乱序与同块多行均按 id 匹配", async (t) => {
  const code = `let count=0;process.stdin.on('data',chunk=>{count+=String(chunk).split('\\n').length-1;if(count===2){process.stdout.write('{"id":2,"res');setTimeout(()=>process.stdout.write('ult":"二"}\\n{"id":1,"result":"一"}\\n'),10);}});`;
  const child = spawn(process.execPath, ["-e", code]);
  t.after(() => child.kill());
  const request = rpcClient(child);
  const responses = await Promise.all([request({ id: 1, method: "first" }), request({ id: 2, method: "second" })]);
  assert.deepEqual(responses.map((r) => r.result), ["一", "二"]);
});

test("测试客户端：无响应和进程提前退出都能结束等待", async (t) => {
  const silent = spawn(process.execPath, ["-e", "process.stdin.resume()"]);
  t.after(() => silent.kill());
  await assert.rejects(rpcClient(silent, 200)({ id: 1, method: "silent" }), /请求超时/);
  const exiting = spawn(process.execPath, ["-e", "process.stdin.once('data',()=>process.exit(7))"]);
  t.after(() => exiting.kill());
  await assert.rejects(rpcClient(exiting)({ id: 1, method: "exit" }), /子进程已退出 \(7\)/);
});
