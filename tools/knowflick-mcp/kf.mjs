#!/usr/bin/env node
/**
 * KnowFlick 本地知识库命令行（零依赖）。
 *
 * 与 `server.mjs`（stdio MCP）共用 `lib.mjs` 这一层逻辑，所以 CLI 与 MCP 看到的
 * 内容、排序与学科口径**必然一致**——不出现「Agent 用 MCP 查到的和人手查到的不同」。
 *
 * 安全边界与 MCP 相同：
 * - 只读 `cards.json`；
 * - `stage` 只追加到 `staged_cards.json`（与 cards.json 同构），由 App 的
 *   「导入归档数据」人工确认后才进正式卡库。Agent 改不动用户的学习记录。
 *
 * 默认输出「给模型读」的紧凑文本；`--json` 才给原始结构。
 */

import fs from "node:fs";
import {
  DEFAULT_APP_DIR,
  browseMap,
  createSearcher,
  deriveTaxonomy,
  indexTaxonomy,
  learningPath,
  loadLibrary,
  stageCard,
  stats,
  subjectName,
} from "./lib.mjs";

const SNIPPET_CHARS = 96;
const DETAILS_CHARS = 1200;
const VALUE_FLAGS = new Set(["limit", "branch", "level", "cards", "app-dir", "card"]);

const USAGE = `KnowFlick 本地知识库 CLI（只读卡库；stage 只进暂存队列）

用法：node tools/knowflick-mcp/kf.mjs <命令> [参数] [选项]

命令
  search <关键词>          检索卡片（--limit N，默认 8，最多 30）
  get <id 或 标题片段>      取一张卡全文（--full 不截断正文）
  map                      学科 → 分支 → 难度 的分布与进度
  path <学科>              按 orderKey 取学习路径（--branch/--level/--unseen/--limit）
  stats                    卡库总量与掌握情况
  stage --card '<卡片 JSON>'  暂存一张待确认卡片（只写 staged_cards.json）
  staged                   查看暂存队列

选项
  --limit N      结果条数
  --full         get 时不截断正文
  --branch B     path 的分支 slug
  --level 1..5   path 的难度
  --unseen       path 只要没看过的
  --cards PATH   指定 cards.json
  --app-dir DIR  指定应用数据目录
  --json         输出原始 JSON
  --help         看这个帮助
`;

const clip = (text, max) => {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  return value.length <= max ? value : `${value.slice(0, max)}…`;
};

function parseArgv(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--full" || token === "--unseen" || token === "--json") {
      flags[token.slice(2)] = true;
    } else if (token === "--help") {
      flags.help = true;
    } else if (token.startsWith("--")) {
      const name = token.slice(2);
      if (!VALUE_FLAGS.has(name)) throw new Error(`未知选项：${token}`);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${token} 缺少取值`);
      flags[name] = value;
      i += 1;
    } else {
      positionals.push(token);
    }
  }
  // 命令是第一个非选项 token：`kf.mjs --app-dir X stage ...` 与 `kf.mjs stage ... --app-dir X` 都得能用
  return { command: positionals.shift() ?? (flags.help ? "help" : "usage"), flags, positionals };
}

function readStaged(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function run(parsed, library, index) {
  const limit = Math.min(30, Math.max(1, Number(parsed.flags.limit ?? 8) || 8));
  const emit = (humanText, jsonData) => ({
    text: parsed.flags.json ? JSON.stringify(jsonData, null, 2) : humanText,
  });

  switch (parsed.command) {
    case "search": {
      const query = parsed.positionals.join(" ");
      if (!query) throw new Error("search 需要关键词，例如：kf.mjs search 复利");
      const hits = createSearcher(library.cards)(query, limit);
      if (!hits.length) {
        return emit(`没有命中「${query}」。试试更短的关键词，或先跑 map 看看库里有什么。`, { query, hits: [] });
      }
      const lines = hits.map((hit) =>
        `${hit.id}  [${hit.category}]  ${hit.headline}\n         ${clip(hit.summary, SNIPPET_CHARS)}  (score ${hit.score})`,
      );
      return emit(`检索「${query}」→ ${hits.length} 条（用 get <id> 看全文）\n\n${lines.join("\n")}`, { query, hits });
    }

    case "get": {
      const key = parsed.positionals.join(" ");
      if (!key) throw new Error("get 需要 id 或标题片段");
      const card = library.cards.find((c) => c.id === key) ?? library.cards.find((c) => String(c.headline).includes(key));
      if (!card) return emit(`找不到卡片「${key}」。`, { found: false, key });
      const taxonomy = deriveTaxonomy(card, index);
      const level = Number.isInteger(taxonomy.level) ? ` L${taxonomy.level}` : "";
      const subject = `${subjectName(index, taxonomy.subject)}${taxonomy.branch ? `/${taxonomy.branch}` : ""}${level}`;
      const body = parsed.flags.full ? String(card.details ?? "") : clip(String(card.details ?? ""), DETAILS_CHARS);
      const links = (card.links ?? []).map((link) => `    · ${link.title} — ${link.url}`);
      const text = [
        card.headline,
        `id: ${card.id}`,
        `分类: ${card.category}    学科: ${subject}`,
        `状态: ${card.seenAt ? `已浏览 ${card.seenAt}` : "未浏览"} · 收藏 ${card.isFavorite ? "是" : "否"} · 熟练度 ${card.masteryLevel ?? 0} · 复习 ${card.reviewCount ?? 0} 次`,
        `摘要: ${card.summary}`,
        `正文${parsed.flags.full ? "" : `（前 ${DETAILS_CHARS} 字，--full 看全部）`}:`,
        body,
        links.length ? `链接:\n${links.join("\n")}` : "链接: 无",
      ].join("\n");
      return emit(text, { found: true, card });
    }

    case "map": {
      const subjects = browseMap(library);
      const lines = subjects.map((entry) => {
        const branches = entry.branches
          .map((branch) => {
            const levels = branch.levels.map((item) => `L${item.level ?? "—"}×${item.count}`).join(" ");
            return `    · ${branch.name} ${branch.cards} 张（已看 ${branch.seen}）${levels ? ` [${levels}]` : ""}`;
          })
          .join("\n");
        return `${entry.name}（${entry.subject ?? "未分级"}）${entry.cards} 张 · 已看 ${entry.seen} · 已掌握 ${entry.mastered}\n${branches}`;
      });
      return emit(`知识库地图\n\n${lines.join("\n\n")}`, { subjects });
    }

    case "path": {
      const subject = parsed.positionals[0];
      if (!subject) throw new Error("path 需要学科 slug，例如：kf.mjs path accounting --branch financial-reporting");
      const steps = learningPath(library, {
        subject,
        branch: parsed.flags.branch ?? null,
        level: parsed.flags.level ? Number(parsed.flags.level) : null,
        includeSeen: !parsed.flags.unseen,
        limit: Math.min(200, Math.max(1, Number(parsed.flags.limit ?? 50) || 50)),
      });
      if (!steps.length) {
        return emit(`学科「${subject}」没有符合条件的卡片（先跑 map 看可用学科与分支）。`, { subject, steps: [] });
      }
      const lines = steps.map((step, i) =>
        `${String(i + 1).padStart(3, " ")}  ${step.headline}  [${step.levelName ?? "未分级"}${step.seen ? "" : " · 未看"}]\n         ${step.id}`,
      );
      return emit(`学习路径 ${subject}${parsed.flags.branch ? `/${parsed.flags.branch}` : ""} → ${steps.length} 步（按 orderKey 推进）\n\n${lines.join("\n")}`, { subject, steps });
    }

    case "stats": {
      const snapshot = stats(library);
      const lines = snapshot.bySubject.map((row) =>
        `  ${row.name}  ${row.cards} 张  已看 ${row.seen}  已掌握 ${row.mastered}`,
      );
      return emit(
        [`卡库 ${snapshot.cards} 张：已浏览 ${snapshot.seen} · 收藏 ${snapshot.favorites} · 复习过 ${snapshot.reviewed} · 已掌握 ${snapshot.mastered} · 未分级 ${snapshot.ungraded}`, ...lines].join("\n"),
        snapshot,
      );
    }

    case "staged": {
      const queue = readStaged(library.stagedPath);
      if (!queue.length) {
        return emit(`暂存队列为空：${library.stagedPath}`, { stagedPath: library.stagedPath, queue: [] });
      }
      const lines = queue.map((card, i) => `${i + 1}. ${card.headline}  [${card.category}]`);
      return emit(
        `暂存队列 ${queue.length} 张（要在 App「知识库 → 导入归档数据」里确认后才会进卡库）\n${lines.join("\n")}\n文件：${library.stagedPath}`,
        { stagedPath: library.stagedPath, queue },
      );
    }

    case "stage": {
      let input = null;
      try {
        input = JSON.parse(parsed.flags.card ?? "");
      } catch {
        throw new Error("stage 需要合法 JSON：kf.mjs stage --card '{\"headline\":\"…\",\"summary\":\"…\",\"details\":\"…\",\"subject\":\"accounting\"}'");
      }
      const result = stageCard(library, input, index);
      if (!result.ok) {
        return emit(`暂存被拒绝：${result.issues.join("；")}`, result);
      }
      return emit(
        `已暂存第 ${result.position} 张「${result.headline}」→ ${result.stagedPath}\n下一步：在 App 的「知识库 → 导入归档数据」里人工确认，才会进正式卡库。`,
        result,
      );
    }

    default:
      return { text: USAGE };
  }
}

try {
  const parsed = parseArgv(process.argv.slice(2));
  if (parsed.flags.help || ["help", "usage"].includes(parsed.command)) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  const library = loadLibrary({
    appDir: parsed.flags["app-dir"] ?? DEFAULT_APP_DIR,
    cardsFile: parsed.flags.cards ?? null,
  });
  process.stdout.write(`${run(parsed, library, indexTaxonomy(library.taxonomy)).text}\n`);
} catch (error) {
  process.stdout.write(`${error.message}\n`);
  process.exit(1);
}
