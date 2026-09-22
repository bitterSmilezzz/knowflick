#!/usr/bin/env node
/**
 * KnowFlick 本地知识库 MCP server（stdio，零第三方依赖）。
 *
 * 为什么手写协议而不装 @modelcontextprotocol/sdk：这台机器在中国大陆网络下，
 * npm 安装与依赖供应链都不可靠；stdio 上的 JSON-RPC 只有几个方法，手写反而更稳、可审计。
 *
 * 安全边界：**只读** cards.json；唯一的写路径是 staged_cards.json（与 cards.json 同构），
 * 由用户在 App 的「导入归档数据」里人工确认后才进卡库。Agent 永远不会直接改你的库。
 *
 * 用法：
 *   node tools/knowflick-mcp/server.mjs                     # 用默认 App 数据目录
 *   node tools/knowflick-mcp/server.mjs --cards <path>      # 指定 cards.json
 *   node tools/knowflick-mcp/server.mjs --allow-write       # 打开 kf_stage_card
 *   node tools/knowflick-mcp/server.mjs --selftest "查询"    # 不启动 stdio，直接跑一遍工具
 */

import readline from "node:readline";
import {
  DEFAULT_APP_DIR,
  browseMap,
  createSearcher,
  createLibraryReader,
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
        instructions: "只读访问本机 KnowFlick 卡库。写回仅支持 kf_stage_card，且需 --allow-write；结果进暂存队列，由用户在 App 内确认入库。",
      });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return respond(id, {});
    case "tools/list":
      return respond(id, {
        tools: context.library.allowWrite ? TOOL_DEFS : TOOL_DEFS.filter((tool) => tool.name !== "kf_stage_card"),
        ttlMs: 300_000,
      });
    case "tools/call": {
      const name = params?.name;
      if (!TOOL_DEFS.some((tool) => tool.name === name)) return fail(id, -32602, `未知工具：${name}`);
      if (name === "kf_stage_card" && !context.library.allowWrite) {
        return respond(id, { isError: true, content: [{ type: "text", text: "写回未开启：需以 --allow-write 启动 server" }] });
      }
      try {
        const payload = context.call(name, params?.arguments ?? {});
        return respond(id, { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError: payload?.ok === false });
      } catch (error) {
        return respond(id, { content: [{ type: "text", text: `工具执行失败：${error.message}` }], isError: true });
      }
    }
    default:
      return isNotification ? null : fail(id, -32601, `方法不支持：${method}`);
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

  const library = { ...loadLibrary(options), allowWrite: options.allowWrite };
  const readLibrary = createLibraryReader(options);
  let snapshot;
  let call;
  const context = {
    library,
    negotiated: PROTOCOL_FALLBACK,
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
