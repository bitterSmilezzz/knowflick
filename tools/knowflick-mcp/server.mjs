#!/usr/bin/env node
/**
 * KnowFlick 本地知识库 MCP server（stdio，零第三方依赖）。
 *
 * 为什么手写协议而不装 @modelcontextprotocol/sdk：这台机器在中国大陆网络下，
 * npm 安装与依赖供应链都不可靠；stdio 上的 JSON-RPC 只有几个方法，手写反而更稳、可审计。
 *
 * 数据请求需要工作台签发的全库令牌；唯一的写路径是 staged_cards.json，
 * 由用户在 App 的「导入归档数据」里人工确认后才进卡库。
 *
 * 用法：
 *   客户端配置中提供 KNOWFLICK_MCP_TOKEN；--cards 必须指向授权库目录内文件。
 *   --allow-write 同时需要建卡授权，才可调用 kf_stage_card。
 *   node tools/knowflick-mcp/server.mjs --selftest "查询"    # 不启动 stdio，直接跑一遍工具
 */

import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canUse, mcpEnabled, withMcpGrant } from "../mcp-access.mjs";
import {
  DEFAULT_APP_DIR,
  browseMap,
  createSearcher,
  createLibraryReader,
  defaultCardsPath,
  indexTaxonomy,
  learningPath,
  loadLibrary,
  stageCard,
  stats,
} from "./lib.mjs";

const PROTOCOL_FALLBACK = "2025-06-18";
const SUPPORTED_PROTOCOLS = new Set(["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"]);
const SERVER_INFO = { name: "knowflick", title: "KnowFlick 本地知识库", version: "1.0.0" };

const TOOL_DEFS = [
  {
    name: "kf_search",
    description: "在本地知识卡片里按字面 + 中文 N-Gram 检索，返回候选卡片的 id/标题/学科/摘要。找不到合适的再问 kf_browse_map。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索词，中文或英文均可" },
        limit: { type: "number", description: "最多返回几条（默认 8，上限 30）" },
      },
      required: ["query"],
    },
  },
  {
    name: "kf_get_card",
    description: "按 id 取一张卡片的完整内容（标题/摘要/正文/链接/学科/复习状态）。",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "kf_browse_map",
    description: "列出学科 → 分支 → 难度的知识地图与各片进度（总数/已看/已掌握），用来决定下一步学什么。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "kf_learning_path",
    description: "取某学科（可限定分支/难度）的学习路径，按导入顺序排列并标注是否已学、熟练度。",
    inputSchema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "学科 slug，如 english / accounting / ai" },
        branch: { type: "string", description: "可选：分支 slug" },
        level: { type: "number", description: "可选：难度 1..5" },
        includeSeen: { type: "boolean", description: "默认 true；false 时只给没学过的" },
        limit: { type: "number" },
      },
      required: ["subject"],
    },
  },
  {
    name: "kf_stats",
    description: "卡库总览：卡片数、已看、已掌握、收藏、未分级数量与学科分布。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "kf_stage_card",
    description: "把新生成的知识卡片放进**暂存队列**（不直接进卡库）。用户在 App 里确认后才会入库。需要 --allow-write。",
    inputSchema: {
      type: "object",
      properties: {
        headline: { type: "string", description: "一句话主张，≤40 字" },
        summary: { type: "string", description: "正面副标题/要点" },
        details: { type: "string", description: "正文，段落用 \\n\\n 分隔" },
        subject: { type: "string", description: "学科 slug（见 kf_browse_map）" },
        branch: { type: "string", description: "分支 slug，必须属于该学科" },
        level: { type: "number", description: "内容难度 1..5" },
        track: { type: "string", description: "应试标尺名，如 大学英语六级" },
        links: { type: "array", items: { type: "object", properties: { title: { type: "string" }, url: { type: "string" } } } },
      },
      required: ["headline", "summary", "details"],
    },
  },
];

function parseArgs(argv) {
  const options = { appDir: DEFAULT_APP_DIR, cardsFile: null, allowWrite: false, selftest: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cards") options.cardsFile = argv[++i];
    else if (arg === "--app-dir") options.appDir = argv[++i];
    else if (arg === "--allow-write") options.allowWrite = true;
    else if (arg === "--selftest") options.selftest = argv[++i] ?? "知识";
    else if (arg === "--help") {
      process.stdout.write("用法：node server.mjs [--cards <path>] [--app-dir <dir>] [--allow-write] [--selftest [query]]\n");
      process.exit(0);
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return options;
}

function makeHandlers(library) {
  const index = indexTaxonomy(library.taxonomy);
  const search = createSearcher(library.cards);
  const byId = new Map(library.cards.map((card) => [card.id, card]));

  return function call(name, args) {
    switch (name) {
      case "kf_search": {
        const limit = Math.min(30, Math.max(1, args.limit ?? 8));
        return { query: args.query, hits: search(String(args.query ?? ""), limit) };
      }
      case "kf_get_card": {
        const card = byId.get(String(args.id ?? ""));
        if (!card) return { found: false, id: args.id };
        return { found: true, card };
      }
      case "kf_browse_map":
        return { subjects: browseMap(library) };
      case "kf_learning_path":
        return {
          subject: args.subject,
          branch: args.branch ?? null,
          level: args.level ?? null,
          steps: learningPath(library, {
            subject: args.subject,
            branch: args.branch ?? null,
            level: typeof args.level === "number" ? args.level : null,
            includeSeen: args.includeSeen !== false,
            limit: Math.min(200, Math.max(1, args.limit ?? 50)),
          }),
        };
      case "kf_stats":
        return stats(library);
      case "kf_stage_card": {
        if (!library.allowWrite) {
          return { ok: false, issues: ["写回未开启：server 需要以 --allow-write 启动（默认只读，防止 Agent 直接改库）"] };
        }
        return stageCard(library, args ?? {}, index);
      }
      default:
        throw new Error(`未知工具：${name}`);
    }
  };
}

function respond(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function fail(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function handleLine(line, context) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return fail(null, -32700, "Parse error");
  }
  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case "initialize": {
      const requested = params?.protocolVersion ?? PROTOCOL_FALLBACK;
      context.negotiated = SUPPORTED_PROTOCOLS.has(requested) ? requested : PROTOCOL_FALLBACK;
      return respond(id, {
        protocolVersion: context.negotiated,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: "数据访问需要连接令牌；暂存还需建卡权限及 --allow-write，由用户在 App 内确认入库。",
      });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return respond(id, {});
    case "tools/list":
      try {
        return respond(id, context.authorize("tools_list", (grant) => {
          if (grant.scope !== "library") throw denied();
          return { tools: TOOL_DEFS.filter(tool => tool.name === "kf_stage_card"
            ? context.allowWrite && canUse(grant, "legacy_card_stage")
            : canUse(grant, "legacy_card_read")), ttlMs: 0 };
        }));
      } catch (error) { return fail(id, error.code ?? -32603, error.message); }
    case "tools/call": {
      const name = params?.name;
      if (!TOOL_DEFS.some((tool) => tool.name === name)) return fail(id, -32602, `未知工具：${name}`);
      if (name === "kf_stage_card" && !context.allowWrite) {
        return respond(id, { isError: true, content: [{ type: "text", text: "写回未开启：需以 --allow-write 启动 server" }] });
      }
      try {
        const stage = name === "kf_stage_card";
        // 文件暂存不属于 SQLite 事务。先持久记录操作意图，再重新校验、持锁写文件。
        if (stage) context.authorize("legacy_card_stage_attempt", () => null);
        let started = false;
        const payload = context.authorize(stage ? "legacy_card_stage" : "legacy_card_read", () => {
          started = stage;
          try { return context.call(name, params?.arguments ?? {}); }
          catch (error) {
            if (error.code === "KF_STAGE_LOCKED") throw error;
            if (started) throw new Error("暂存未完成，队列可能已更改，请检查暂存队列。");
            throw error;
          }
        }, stage);
        return respond(id, { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError: payload?.ok === false });
      } catch (error) {
        if (error.code === -32001 || error.code === -32000) return fail(id, error.code, error.message);
        return respond(id, { content: [{ type: "text", text: error.message || "工具执行失败，请检查库与授权。" }], isError: true });
      }
    }
    default:
      return isNotification ? null : fail(id, -32601, `方法不支持：${method}`);
  }
}

function denied() {
  const error = new Error("授权无效或无权执行此操作；请在 KnowFlick 设置中检查连接授权。");
  error.code = -32001;
  return error;
}

/** 限定卡片与暂存文件位于凭据所属库目录，拒绝越界符号链接。 */
function verifyFiles(libraryDir, cardsFile, stage) {
  const root = fs.realpathSync(libraryDir);
  const cards = fs.realpathSync(cardsFile);
  if (path.dirname(cards) !== root) throw denied();
  if (stage) {
    const staged = path.join(root, "staged_cards.json");
    try { if (fs.lstatSync(staged).isSymbolicLink()) throw denied(); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

function runSelftest(options) {
  const library = { ...loadLibrary(options), allowWrite: options.allowWrite };
  const call = makeHandlers(library);
  const map = call("kf_browse_map", {});
  const first = map.subjects[0];
  const report = {
    cardsFile: library.cardsPath,
    cards: library.cards.length,
    subjects: map.subjects.map((subject) => `${subject.name}:${subject.cards}`).join(", "),
    searchHits: call("kf_search", { query: options.selftest }).hits.length,
    pathSteps: first?.subject ? call("kf_learning_path", { subject: first.subject, limit: 5 }).steps.length : 0,
    stats: call("kf_stats", {}),
    writeMode: options.allowWrite ? "开启（staged 队列）" : "只读",
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selftest) {
    runSelftest(options);
    return;
  }

  const cardsFile = path.resolve(options.cardsFile ?? defaultCardsPath(options.appDir));
  const libraryDir = path.dirname(cardsFile);
  const readLibrary = createLibraryReader({ ...options, cardsFile });
  let snapshot;
  let call;
  const context = {
    allowWrite: options.allowWrite,
    negotiated: PROTOCOL_FALLBACK,
    authorize(operation, run, stage = false) {
      if (!mcpEnabled(libraryDir)) {
        const error = new Error("MCP 模块已停用或设置不可读取，请在 KnowFlick 中检查设置。");
        error.code = -32000;
        throw error;
      }
      let db;
      let callbackStarted = false;
      try {
        const dbPath = path.join(libraryDir, "knowflick.db");
        if (!fs.existsSync(dbPath)) throw new Error("数据库不存在");
        if (fs.lstatSync(dbPath).isSymbolicLink() || path.dirname(fs.realpathSync(dbPath)) !== fs.realpathSync(libraryDir)) throw denied();
        db = new DatabaseSync(dbPath);
        return withMcpGrant(db, process.env.KNOWFLICK_MCP_TOKEN, operation, grant => {
          if (grant.scope !== "library") throw denied();
          verifyFiles(libraryDir, cardsFile, stage);
          callbackStarted = true;
          return run(grant);
        });
      } catch (error) {
        if (error.code === -32001 || error.code === -32000 || error.code === "KF_STAGE_LOCKED") throw error;
        throw new Error(stage && callbackStarted
          ? "暂存未完成，队列可能已更改，请检查暂存队列。"
          : "请求未完成，请检查知识库、授权与审计设置。");
      } finally { db?.close(); }
    },
    call(name, args) {
      const next = readLibrary();
      if (next !== snapshot) {
        const nextCall = makeHandlers({ ...next, allowWrite: options.allowWrite });
        snapshot = next;
        call = nextCall;
      }
      return call(name, args);
    },
  };
  const output = process.stdout;
  const send = (message) => {
    if (message) output.write(`${JSON.stringify(message)}\n`);
  };

  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let batch;
    try {
      batch = JSON.parse(trimmed);
    } catch {
      send(fail(null, -32700, "Parse error"));
      return;
    }
    if (Array.isArray(batch)) {
      for (const item of batch) send(handleLine(JSON.stringify(item), context));
      return;
    }
    send(handleLine(trimmed, context));
  });
  lines.on("close", () => process.exit(0));
}

try {
  main();
} catch (error) {
  process.stderr.write(`KnowFlick MCP server 启动失败：${error.message}\n`);
  process.exit(1);
}
