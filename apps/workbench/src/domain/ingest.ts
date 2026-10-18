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

export function requiresKey(baseURL: string): boolean {
  const host = new URL(baseURL).hostname;
  return host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
}

const TRANSFORM_SYSTEM = "你是一位博学敏锐的知识架构师。你的任务是将用户提供的非结构化笔记、长文或书摘，提炼提纯为 1 到 5 张结构精炼、具有深刻洞察力的 KnowFlick 知识卡片，必须且仅输出标准 JSON 数组。";

export function transformPrompt(note: string): string {
  return `你是一位知识提炼专家。请将用户提供的以下笔记或文章内容，深度解构并提炼为 1 到 5 张高品质的「KnowFlick 知识闪卡」。

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
${note.slice(0, 4000)}`;
}

export function cardsFromModelText(text: string, now = Date.now()): KnowledgeCard[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("AI 没有返回卡片数组");
  const parsed = JSON.parse(match[0]) as unknown;
  if (!Array.isArray(parsed)) throw new Error("AI 没有返回卡片数组");
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
    if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") throw new Error("只有本机地址可以用 HTTP");
  } else if (url.protocol !== "https:") {
    throw new Error("只接受 http 或 https 链接");
  }
  return url;
}

export { TRANSFORM_SYSTEM };
