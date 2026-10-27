import type { KnowledgeCard, CardSource, SwipeDirection } from "./card";
import { cardFromJson } from "./card";
import { normalizeHeadline as headlineKey } from "./ingest";

export interface ArchiveRestoreResult {
  added: number;
  restored: number;
  ignored: number;
}

export interface ArchivePreview {
  filename: string;
  totalCards: number;
  readCards: number;
  favoritedCards: number;
  categoriesSummary: Record<string, number>;
  parsedCards: KnowledgeCard[];
  settingsJson: string | null;
  isZipArchive: boolean;
}

export type RestoreStrategy = "merge" | "overwrite";

export function buildArchivePreview(
  filename: string,
  cards: KnowledgeCard[],
  settingsJson: string | null,
  isZipArchive: boolean,
): ArchivePreview {
  const categoriesSummary: Record<string, number> = {};
  for (const card of cards) {
    const key = card.category || "未分类";
    categoriesSummary[key] = (categoriesSummary[key] ?? 0) + 1;
  }
  return {
    filename,
    totalCards: cards.length,
    readCards: cards.filter((card) => card.seenAt !== null).length,
    favoritedCards: cards.filter((card) => card.isFavorite).length,
    categoriesSummary,
    parsedCards: cards,
    settingsJson,
    isZipArchive,
  };
}

export function applyArchiveRestore(
  existing: KnowledgeCard[],
  preview: ArchivePreview,
  strategy: RestoreStrategy,
): { cards: KnowledgeCard[]; result: ArchiveRestoreResult } {
  if (strategy === "overwrite") {
    return {
      cards: preview.parsedCards,
      result: { added: preview.parsedCards.length, restored: 0, ignored: 0 },
    };
  }
  return restoreArchive(existing, preview.parsedCards);
}

/** 导入侧宽松解码：裸数组或 v2 信封，单卡坏则跳过。 */
export function decodeListSalvaging(text: string): KnowledgeCard[] {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return [];
  }
  const array = Array.isArray(root)
    ? root
    : root !== null && typeof root === "object" && Array.isArray((root as { cards?: unknown }).cards)
      ? (root as { cards: unknown[] }).cards
      : null;
  if (!array) return [];
  const cards: KnowledgeCard[] = [];
  for (const item of array) {
    try {
      cards.push(cardFromJson(item));
    } catch {
      continue;
    }
  }
  return cards;
}

/** 对称字段级合并，与 Kotlin `CardStore.mergeCard` 一致。 */
export function mergeCard(a: KnowledgeCard, b: KnowledgeCard): KnowledgeCard {
  const mergedId = a.id === b.id
    ? a.id
    : a.createdAt < b.createdAt
      ? a.id
      : b.createdAt < a.createdAt
        ? b.id
        : a.id <= b.id
          ? a.id
          : b.id;
  const createdAt = Math.min(a.createdAt, b.createdAt);
  const primary = a.createdAt >= b.createdAt ? a : b;
  const secondary = a.createdAt >= b.createdAt ? b : a;
  const category = primary.category.trim() ? primary.category : secondary.category;
  const headline = primary.headline.trim() ? primary.headline : secondary.headline;
  const summary = primary.summary.trim() ? primary.summary : secondary.summary;
  const aEditedAt = a.editedAt;
  const bEditedAt = b.editedAt;
  let details: string;
  if (aEditedAt !== null && bEditedAt !== null && aEditedAt !== bEditedAt) {
    details = (aEditedAt > bEditedAt ? a : b).details;
  } else if (!primary.details.trim()) {
    details = secondary.details;
  } else if (primary.details.length >= secondary.details.length) {
    details = primary.details;
  } else {
    details = secondary.details;
  }
  const mergedEditedAt = aEditedAt !== null && bEditedAt !== null
    ? Math.max(aEditedAt, bEditedAt)
    : aEditedAt ?? bEditedAt;
  const links = primary.links.length > 0 ? primary.links : secondary.links;
  const source: CardSource = primary.source === "seed" && secondary.source !== "seed"
    ? secondary.source
    : primary.source;

  let seenAt: number | null;
  let swiped: SwipeDirection | null;
  const sA = a.seenAt;
  const sB = b.seenAt;
  if (sA !== null && sB !== null) {
    if (sA >= sB) {
      seenAt = sA;
      swiped = a.swiped ?? b.swiped;
    } else {
      seenAt = sB;
      swiped = b.swiped ?? a.swiped;
    }
  } else if (sA !== null) {
    seenAt = sA;
    swiped = a.swiped;
  } else if (sB !== null) {
    seenAt = sB;
    swiped = b.swiped;
  } else {
    seenAt = null;
    swiped = a.swiped ?? b.swiped;
  }

  const isFavorite = a.isFavorite || b.isFavorite;
  const aFav = a.favoritedAt;
  const bFav = b.favoritedAt;
  const favoritedAt = aFav !== null && bFav !== null
    ? Math.max(aFav, bFav)
    : aFav ?? bFav ?? (isFavorite ? seenAt : null);

  const reviewCount = Math.max(a.reviewCount, b.reviewCount);
  const rA = a.lastReviewedAt;
  const rB = b.lastReviewedAt;
  let masteryLevel: number;
  let lastReviewedAt: number | null;
  let repetition: number;
  let intervalDays: number;
  let easeFactor: number;
  let stability: number;
  let difficulty: number;
  if (rA !== null && rB !== null) {
    if (rA > rB) {
      masteryLevel = a.masteryLevel;
      lastReviewedAt = rA;
      repetition = a.repetition;
      intervalDays = a.intervalDays;
      easeFactor = a.easeFactor;
      stability = a.stability > 0 ? a.stability : b.stability;
      difficulty = a.difficulty > 0 ? a.difficulty : b.difficulty;
    } else if (rB > rA) {
      masteryLevel = b.masteryLevel;
      lastReviewedAt = rB;
      repetition = b.repetition;
      intervalDays = b.intervalDays;
      easeFactor = b.easeFactor;
      stability = b.stability > 0 ? b.stability : a.stability;
      difficulty = b.difficulty > 0 ? b.difficulty : a.difficulty;
    } else {
      masteryLevel = Math.max(a.masteryLevel, b.masteryLevel);
      lastReviewedAt = rA;
      repetition = Math.max(a.repetition, b.repetition);
      intervalDays = Math.max(a.intervalDays, b.intervalDays);
      easeFactor = Math.max(a.easeFactor, b.easeFactor);
      stability = Math.max(a.stability, b.stability);
      difficulty = Math.max(a.difficulty, b.difficulty);
    }
  } else if (rA !== null) {
    masteryLevel = a.masteryLevel;
    lastReviewedAt = rA;
    repetition = a.repetition;
    intervalDays = a.intervalDays;
    easeFactor = a.easeFactor;
    stability = a.stability;
    difficulty = a.difficulty;
  } else if (rB !== null) {
    masteryLevel = b.masteryLevel;
    lastReviewedAt = rB;
    repetition = b.repetition;
    intervalDays = b.intervalDays;
    easeFactor = b.easeFactor;
    stability = b.stability;
    difficulty = b.difficulty;
  } else {
    masteryLevel = Math.max(a.masteryLevel, b.masteryLevel);
    lastReviewedAt = null;
    repetition = Math.max(a.repetition, b.repetition);
    intervalDays = Math.max(a.intervalDays, b.intervalDays);
    easeFactor = Math.max(a.easeFactor, b.easeFactor);
    stability = Math.max(a.stability, b.stability);
    difficulty = Math.max(a.difficulty, b.difficulty);
  }

  return {
    id: mergedId,
    category,
    headline,
    summary,
    details,
    links,
    source,
    createdAt,
    editedAt: mergedEditedAt,
    seenAt,
    swiped,
    isFavorite,
    favoritedAt,
    reviewCount,
    masteryLevel,
    lastReviewedAt,
    repetition,
    intervalDays,
    easeFactor,
    stability,
    difficulty,
    subject: primary.subject ?? secondary.subject,
    branch: primary.branch ?? secondary.branch,
    level: primary.level ?? secondary.level,
    track: primary.track ?? secondary.track,
    orderKey: primary.orderKey ?? secondary.orderKey,
    prereq: primary.prereq.length > 0 ? primary.prereq : secondary.prereq,
  };
}

export function restoreArchive(
  existing: KnowledgeCard[],
  incoming: KnowledgeCard[],
  insertNewAtTop = true,
): { cards: KnowledgeCard[]; result: ArchiveRestoreResult } {
  const working = [...existing];
  const addedIds = new Set<string>();
  let restored = 0;
  let ignored = 0;
  const indexById = new Map<string, number>();
  const indexByHeadline = new Map<string, number>();
  working.forEach((card, index) => {
    if (!indexById.has(card.id)) indexById.set(card.id, index);
    const key = headlineKey(card.headline);
    if (key && !indexByHeadline.has(key)) indexByHeadline.set(key, index);
  });

  for (const raw of incoming) {
    const headlineKeyValue = headlineKey(raw.headline);
    if (!headlineKeyValue) {
      ignored += 1;
      continue;
    }
    const matchIndex = indexById.get(raw.id) ?? indexByHeadline.get(headlineKeyValue);
    if (matchIndex !== undefined) {
      const local = working[matchIndex]!;
      working[matchIndex] = { ...mergeCard(local, raw), id: local.id };
      restored += 1;
    } else {
      let safeId = raw.id.trim();
      while (!safeId || indexById.has(safeId)) {
        safeId = crypto.randomUUID().toUpperCase();
      }
      const added = { ...raw, id: safeId };
      const newIndex = working.length;
      working.push(added);
      addedIds.add(safeId);
      indexById.set(safeId, newIndex);
      if (!indexByHeadline.has(headlineKeyValue)) indexByHeadline.set(headlineKeyValue, newIndex);
    }
  }

  const cards = insertNewAtTop && addedIds.size > 0
    ? [...working.filter((card) => addedIds.has(card.id)), ...working.filter((card) => !addedIds.has(card.id))]
    : working;
  return {
    cards,
    result: { added: addedIds.size, restored, ignored },
  };
}
