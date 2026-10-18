import type { KnowledgeCard, SwipeDirection } from "./card";
import { pinyinMatchShortText } from "./pinyin";

export type SearchSourceFilter = "all" | "imported" | "ai" | "favorites" | "seen" | "unseen";
export type SearchMatchedField = "headline" | "category" | "summary" | "details" | "link" | "browse";

export interface SearchResultItem {
  card: KnowledgeCard;
  score: number;
  matchedField: SearchMatchedField;
  matchedExcerpt: string;
  isFavorite: boolean;
}

export type QueryType = "chinese" | "english" | "initials" | "pinyin_full";

export function classifyQuery(query: string): QueryType {
  const trimmed = query.trim();
  if (!trimmed) return "english";
  if (/[\u4e00-\u9fff]/.test(trimmed)) return "chinese";
  if (/[A-Z]/.test(trimmed)) return "english";
  const letters = trimmed.toLowerCase().replace(/[^a-z]/g, "");
  if (letters.length < 2) return "english";
  return /[aeiouv]/.test(letters) ? "pinyin_full" : "initials";
}

function textMatch(fieldLower: string, queryLower: string): number {
  if (fieldLower === queryLower) return 120;
  if (fieldLower.includes(queryLower)) return 80;
  return 0;
}

export function extractSnippet(text: string, query: string, maxLen = 68): string {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
  const start = Math.max(0, index - 18);
  const end = Math.min(text.length, index + query.length + 32);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).replace(/\n/g, " ").trim()}${suffix}`;
}

export function searchCards(
  query: string,
  cards: KnowledgeCard[],
  options: {
    category?: string | null;
    source?: SearchSourceFilter;
    intent?: SwipeDirection | null;
    favorites?: Set<string>;
  } = {},
): SearchResultItem[] {
  const trimmed = query.trim().toLowerCase();
  const category = options.category ?? null;
  const source = options.source ?? "all";
  const intent = options.intent ?? null;
  const favorites = options.favorites ?? new Set<string>();

  const filtered = cards.filter((card) => {
    if (category && category !== "全部" && card.category !== category) return false;
    if (intent && card.swiped !== intent) return false;
    switch (source) {
      case "imported": return card.source === "imported";
      case "ai": return card.source === "ai";
      case "favorites": return card.isFavorite || favorites.has(card.id);
      case "seen": return card.seenAt !== null;
      case "unseen": return card.seenAt === null;
      default: return true;
    }
  });
  if (!trimmed) return [];

  const queryType = classifyQuery(query.trim());
  const pinyinQuery = trimmed.replace(/\s/g, "");
  const results: SearchResultItem[] = [];
  for (const card of filtered) {
    const headlineLower = card.headline.toLowerCase();
    const summaryLower = card.summary.toLowerCase();
    const categoryLower = card.category.toLowerCase();
    const linksText = card.links.map((link) => `${link.title} ${link.url}`).join(" ").toLowerCase();
    let totalScore = 0;
    let matchedField: SearchMatchedField | null = null;
    let excerpt = card.headline;

    const headlineScore = textMatch(headlineLower, trimmed);
    if (headlineScore > 0) {
      totalScore += headlineScore;
      matchedField = "headline";
    } else if (queryType === "pinyin_full" || queryType === "initials") {
      const pinyinScore = pinyinMatchShortText(
        card.headline,
        pinyinQuery,
        queryType === "pinyin_full" ? "pinyin_full" : "initials",
      );
      if (pinyinScore > 0) {
        totalScore += pinyinScore;
        matchedField = "headline";
      }
    }

    const categoryScore = textMatch(categoryLower, trimmed);
    if (categoryScore > 0) {
      totalScore += categoryLower === trimmed ? 70 : 50;
      if (!matchedField) {
        matchedField = "category";
        excerpt = `学科分类：${card.category}`;
      }
    } else if ((queryType === "pinyin_full" || queryType === "initials") && !matchedField) {
      const pinyinScore = pinyinMatchShortText(
        card.category,
        pinyinQuery,
        queryType === "pinyin_full" ? "pinyin_full" : "initials",
      );
      if (pinyinScore > 0) {
        totalScore += Math.max(1, Math.floor(pinyinScore * 0.6));
        matchedField = "category";
        excerpt = `学科分类：${card.category}`;
      }
    }

    if (summaryLower.includes(trimmed)) {
      totalScore += 35;
      if (!matchedField) {
        matchedField = "summary";
        excerpt = card.summary;
      }
    }

    if (card.details.toLowerCase().includes(trimmed)) {
      totalScore += 20;
      if (!matchedField) {
        matchedField = "details";
        excerpt = extractSnippet(card.details, trimmed);
      }
    }

    if (linksText.includes(trimmed)) {
      totalScore += 10;
      if (!matchedField) {
        matchedField = "link";
        const matched = card.links.find((link) => link.title.toLowerCase().includes(trimmed) || link.url.toLowerCase().includes(trimmed));
        excerpt = matched ? `权威文献：${matched.title}` : card.summary;
      }
    }

    if (totalScore <= 0 || !matchedField) continue;
    const isFavorite = card.isFavorite || favorites.has(card.id);
    if (isFavorite) totalScore += 15;
    results.push({ card, score: totalScore, matchedField, matchedExcerpt: excerpt, isFavorite });
  }
  return results.sort((a, b) => b.score - a.score || b.card.createdAt - a.card.createdAt);
}
