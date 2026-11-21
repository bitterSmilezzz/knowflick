import type { KnowledgeCard, ScienceLink } from "./card";

export function normalizeHeadline(text: string): string {
  return text.toLowerCase().replace(/[\s，。！？「」]/g, "");
}

export function addCards(existing: KnowledgeCard[], incoming: KnowledgeCard[], insertAtTop = true): { cards: KnowledgeCard[]; added: number } {
  const seen = new Set(existing.map((card) => normalizeHeadline(card.headline)));
  const fresh = incoming.filter((card) => {
    const key = normalizeHeadline(card.headline);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    cards: insertAtTop ? [...fresh, ...existing] : [...existing, ...fresh],
    added: fresh.length,
  };
}

export interface AiPayload {
  category: string;
  headline: string;
  summary: string;
  details: string;
  searchKeywords: string[];
  sources: string[];
}

export function completionURL(baseURL: string): string {
  const url = new URL(baseURL.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("请输入有效的 HTTP(S) API Base URL");
  let path = url.pathname.replace(/\/+$/, "");
  if (!path.endsWith("/chat/completions")) path += path ? "/chat/completions" : "/v1/chat/completions";
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * 本机回环判定：127.0.0.1 / localhost / IPv6 回环。
 *
 * 口径与安卓端 `LoopbackHost`、桌面壳 `is_loopback_host` 一致（ADR-0002 §3：
 * 同一份 settings.json 在两端行为相同）。
 *
 * IPv6 回环不能只比字符串：`::1`、`[::1]`、`0:0:0:0:0:0:0:1` 指同一个地址。
 * WHATWG URL 的 hostname 保留方括号；WHATWG 也会把 `::ffff:127.0.0.1` 归一化成
 * `[::ffff:7f00:1]`，那种**不算**回环（Rust 端 `Ipv6Addr::is_loopback` 同样不认）。
 */
export function isLoopbackHost(rawHost: string): boolean {
  const host = rawHost.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (!host.includes(":")) return false;
  // 只接受 IPv6 字面量的字符集：别的交给 URL 解析器会被当主机名去解析。
  if (!/^[0-9a-f:.]+$/.test(host)) return false;

  // 按八组解析（不用 :: 压缩语法）：`0:0:0:0:0:0:0:1` 没有 `::`，
  // 只按压缩写法判断会漏掉它。
  const compressed = host.includes("::");
  let groups: string[];
  if (compressed) {
    const [head, tail] = host.split("::");
    const headParts = head ? head.split(":") : [];
    const tailParts = tail ? tail.split(":") : [];
    const missing = 8 - headParts.length - tailParts.length;
    if (missing < 0) return false;
    groups = [...headParts, ...Array(missing).fill("0"), ...tailParts];
  } else {
    groups = host.split(":");
  }
  if (groups.length !== 8) return false;
  if (!groups.every((part) => /^[0-9a-f]{1,4}$/.test(part))) return false;
  // 恰好 ::1：前七组全零、末组为 1。
  return groups.slice(0, 7).every((part) => part === "0") && groups[7] === "1";
}

export function requiresKey(baseURL: string): boolean {
  const host = new URL(baseURL).hostname;
  // WHATWG URL.hostname keeps brackets around IPv6 literals (including ::1).
  return !isLoopbackHost(host);
}

export function estimateTokenCount(text: string): { tokens: number; summary: string } {
  const chars = text.length;
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = chars - chineseChars;
  const tokens = Math.ceil(chineseChars / 1.5 + otherChars / 4);
  return {
    tokens,
    summary: `约 ${tokens.toLocaleString()} tokens (${chars.toLocaleString()} 字符)`,
  };
}

export function smartSliceText(text: string, maxChunkLength = 4000): string[] {
  if (text.length <= maxChunkLength) return [text];

  const chunks: string[] = [];
  const sections = text.split(/(?=\n#{1,3}\s+)/);

  let currentChunk = "";
  for (const sec of sections) {
    if (currentChunk.length + sec.length <= maxChunkLength) {
      currentChunk += sec;
    } else {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      if (sec.length > maxChunkLength) {
        const paragraphs = sec.split(/\n{2,}/);
        let sub = "";
        for (const p of paragraphs) {
          if (sub.length + p.length <= maxChunkLength) {
            sub += (sub ? "\n\n" : "") + p;
          } else {
            if (sub.trim()) chunks.push(sub.trim());
            sub = p.slice(0, maxChunkLength);
          }
        }
        if (sub.trim()) currentChunk = sub;
        else currentChunk = "";
      } else {
        currentChunk = sec;
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [text.slice(0, maxChunkLength)];
}

const TRANSFORM_SYSTEM = "你是一位博学敏锐的知识架构师。你的任务是将用户提供的非结构化笔记、长文或书摘，提炼提纯为 1 到 5 张结构精炼、具有深刻洞察力的 KnowFlick 知识卡片，必须且仅输出标准 JSON 数组。";

export function transformPrompt(note: string): string {
  const isLong = note.length > 3000;
  const longNoteGuidance = isLong
    ? "\n【长文智能切片提示】\n原文篇幅较长，请根据文章段落脉络与逻辑主线，分别提炼 3 到 5 张自包含、相互独立的原子知识卡，覆盖核心论证与结论。\n"
    : "";

  return `你是一位知识提炼专家。请将用户提供的以下笔记或文章内容，深度解构并提炼为 1 到 5 张高品质的「KnowFlick 知识闪卡」。${longNoteGuidance}
【提炼设计准则】
1. 必须提炼为符合以下 JSON 结构的卡片数组，仅输出 JSON，不要任何多余解释；
2. category: 精准学科分类（如：物理、计算机、心理学、经济学、生物学、历史、哲学、医学等）；
3. headline: 一句话反常识/颠覆认知/核心命题标题（例如：「过拟合：模型把背题当成了学会」），不超过 30 字；
4. summary: 卡片正面摘要，提炼核心论点，不超过 60 字；
5. details: 卡片深度机理解剖（200-500字，用通俗生动语言讲解背后深层原理或机制）；
6. searchKeywords: 2-3 个核心学术关键词（如 ["热力学第三定律", "绝对零度"]）；
7. sources: 1-2 个推荐参考权威来源（如 ["维基百科", "Nature"]）。

【输出 JSON 示例】
[
  {
    "category": "物理",
    "headline": "绝对零度永远无法真正达到",
    "summary": "-273.15°C之下没有静止，粒子仍有零点能量。",
    "details": "根据量子力学不确定性原理与热力学第三定律...",
    "searchKeywords": ["热力学第三定律", "绝对零度"],
    "sources": ["维基百科"]
  }
]

【用户笔记原文】
${note.slice(0, 5000)}`;
}

/**
 * 从模型输出里挑出那个真正的卡片数组。
 *
 * 不能简单用 `\[[\s\S]*\]` 贪婪匹配：真实模型常在正文里带**引用编号**
 * （「根据 [1] 的研究，以下是卡片：[{...}]」），贪婪匹配会从 `[1]` 开始截，
 * JSON.parse 直接失败——而模型其实返回了合法卡片，用户却收到「没有返回卡片数组」。
 *
 * 也不能「从后往前取第一个能解析的数组」：卡片里常有嵌套数组
 * （`searchKeywords: ["a","b"]`），那样会命中内层那个字符串数组。
 *
 * 做法：枚举所有能解析成数组的候选，**按「元素是对象的个数」挑最好的**。
 * `[1]`、`["a","b"]` 这类元素不是对象的候选自然落选。
 */
function extractCardArray(text: string): unknown[] | null {
  const starts: number[] = [];
  for (let i = 0; i < text.length; i += 1) if (text[i] === "[") starts.push(i);

  let best: unknown[] | null = null;
  let bestScore = 0;
  // 找到过任何合法数组（哪怕元素不是对象）——用来区分两种失败：
  // 「模型没给数组」与「给了数组但没有可用的卡」。后者的提示更有用。
  let longestEmpty: unknown[] | null = null;
  for (const start of starts) {
    for (let end = text.length - 1; end > start; end -= 1) {
      if (text[end] !== "]") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
      } catch {
        continue;
      }
      if (!Array.isArray(parsed)) continue;
      if (!longestEmpty || parsed.length > longestEmpty.length) longestEmpty = parsed;
      const score = parsed.filter((item) => item !== null && typeof item === "object" && !Array.isArray(item)).length;
      if (score > bestScore) {
        best = parsed;
        bestScore = score;
      }
      break; // 同一个起点只取最长的那个合法数组
    }
  }
  if (bestScore > 0) return best;
  // 空数组（或只有标量的数组）：交回调用方给「没有可用的新卡片」这类提示，
  // 而不是误报成「模型没返回数组」。
  return longestEmpty;
}

export function cardsFromModelText(text: string, now = Date.now()): KnowledgeCard[] {
  const parsed = extractCardArray(text);
  if (!parsed) throw new Error("AI 没有返回卡片数组");
  const seen = new Set<string>();
  const cards: KnowledgeCard[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const headline = typeof row.headline === "string" ? row.headline.trim() : "";
    const details = typeof row.details === "string" ? row.details.trim() : "";
    const summary = typeof row.summary === "string" ? row.summary.trim() : "";
    if (details.length < 80) continue;
    const key = normalizeHeadline(headline);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const keywords = Array.isArray(row.searchKeywords) ? row.searchKeywords.filter((word): word is string => typeof word === "string") : [];
    const sources = Array.isArray(row.sources) ? row.sources.filter((word): word is string => typeof word === "string") : [];
    cards.push({
      id: crypto.randomUUID().toUpperCase(),
      category: typeof row.category === "string" && row.category.trim() ? row.category.trim() : "随手笔记",
      headline,
      summary: summary || headline,
      details,
      links: searchLinks(keywords, sources),
      source: "ai",
      createdAt: now,
      editedAt: null,
      seenAt: null,
      swiped: null,
      isFavorite: false,
      favoritedAt: null,
      reviewCount: 0,
      masteryLevel: 0,
      lastReviewedAt: null,
      repetition: 0,
      intervalDays: 1,
      easeFactor: 2.5,
      stability: 0,
      difficulty: 0,
      subject: null,
      branch: null,
      level: null,
      track: null,
      orderKey: null,
      prereq: [],
    });
  }
  if (cards.length === 0) throw new Error("AI 返回的内容没有可用的新卡片（重复或内容过短）");
  return cards;
}

function searchLinks(keywords: string[], sources: string[]): ScienceLink[] {
  const source = sources[0] ?? "";
  return keywords.slice(0, 3).map((keyword) => {
    const query = source ? `${keyword} ${source}` : keyword;
    return {
      title: source ? `搜索：${query}` : `搜索：${keyword}`,
      url: `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
    };
  });
}

export function assertFetchableUrl(raw: string): URL {
  const url = new URL(raw.trim());
  if (url.username || url.password) throw new Error("链接里不能带账号密码");
  if (url.protocol === "http:") {
    const host = url.hostname;
    if (!isLoopbackHost(host)) throw new Error("只有本机地址可以用 HTTP");
  } else if (url.protocol !== "https:") {
    throw new Error("只接受 http 或 https 链接");
  }
  return url;
}

export { TRANSFORM_SYSTEM };
