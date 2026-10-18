import type { KnowledgeCard } from "./card";
import { arrange } from "./cardArrange";
import { themeKeyForCard } from "./cardTheme";

export function deckFilterSignature(enableAI: boolean, preferredCategories: string[]): string {
  return `${enableAI ? "1" : "0"}|${preferredCategories.join("\u0001")}`;
}

export function eligibleDeck(cards: KnowledgeCard[], enableAI: boolean, preferredCategories: string[]): KnowledgeCard[] {
  const unseen = cards.filter((card) => card.seenAt === null);
  const sourced = enableAI ? unseen : unseen.filter((card) => card.source !== "ai");
  if (preferredCategories.length === 0) return sourced;
  const preferred = sourced.filter((card) => preferredCategories.includes(card.category));
  return preferred.length > 0 ? preferred : sourced;
}

export function buildDeckIds(pool: KnowledgeCard[], avoidTopKey: string | null = null): string[] {
  return arrange(pool, 5, avoidTopKey, themeKeyForCard).map((card) => card.id);
}

export function deckFromIds(cards: KnowledgeCard[], ids: string[]): KnowledgeCard[] {
  const map = new Map(cards.map((card) => [card.id, card]));
  return ids.map((id) => map.get(id)).filter((card): card is KnowledgeCard => card !== undefined);
}

/** 全局搜索「加入卡堆顶」：与 `CardStore.promoteToDeckTop` 同语义（仅调序，不改 seenAt）。 */
export function promoteDeckIds(ids: string[], cardId: string): string[] {
  if (ids[0] === cardId) return ids;
  return [cardId, ...ids.filter((id) => id !== cardId)];
}

/** 划走顶卡或入堆后，尽量保留既有顺序。`pinnedIds` 保留搜索置顶的卡（可含已浏览卡）。 */
export function refreshDeckIds(
  previous: string[],
  pool: KnowledgeCard[],
  avoidTopKey: string | null,
  pinnedIds: ReadonlySet<string> = new Set(),
): string[] {
  const eligible = new Set(pool.map((card) => card.id));
  const pruned = previous.filter((id) => eligible.has(id) || pinnedIds.has(id));
  if (previous.length === 0) return buildDeckIds(pool, avoidTopKey);
  if (pruned.length === previous.length - 1 && previous[0] && !eligible.has(previous[0])) {
    return pruned;
  }
  const have = new Set(pruned);
  const newcomers = pool.filter((card) => !have.has(card.id));
  if (pruned.length > 0 && newcomers.length > 0 && newcomers.length <= 10) {
    const anchor = pool.find((card) => card.id === pruned[pruned.length - 1]);
    const tail = arrange(newcomers, 5, anchor ? themeKeyForCard(anchor) : avoidTopKey, themeKeyForCard).map((card) => card.id);
    return [...pruned, ...tail];
  }
  if (pruned.length === previous.length && newcomers.length === 0) return previous;
  return buildDeckIds(pool, avoidTopKey);
}
