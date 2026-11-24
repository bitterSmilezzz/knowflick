import type { KnowledgeCard } from "./card";
import { dueCards, reviewDay, todayStamp } from "./review";

export interface MasteryBucket {
  label: string;
  min: number;
  max: number;
  count: number;
}

export interface ReviewOverview {
  totalCards: number;
  reviewedCards: number;
  dueToday: number;
  scheduledLater: number;
  neverReviewed: number;
  favoriteCards: number;
  masteryBuckets: MasteryBucket[];
  averageIntervalDays: number;
  nextDueDay: string | null;
}

const BUCKET_DEFS: Array<{ label: string; min: number; max: number }> = [
  { label: "新建", min: 0, max: 0 },
  { label: "初识", min: 1, max: 1 },
  { label: "熟悉", min: 2, max: 2 },
  { label: "掌握", min: 3, max: 3 },
  { label: "精通", min: 4, max: Number.MAX_SAFE_INTEGER },
];

/**
 * 复习总览统计：用于「温故知新」模块的掌握度面板。
 *
 * 与 `stats.ts` 的划卡统计并列而非替代——那个记录浏览行为（seenAt/swiped），
 * 这里记录间隔重复状态（lastReviewedAt/intervalDays/masteryLevel）。
 */
export function reviewOverview(cards: KnowledgeCard[], today = todayStamp()): ReviewOverview {
  const reviewed = cards.filter((card) => card.lastReviewedAt !== null);
  const due = dueCards(cards, today);
  const dueIds = new Set(due.map((card) => card.id));

  const futureDays = cards
    .flatMap((card) => {
      const day = reviewDay(card);
      return day && day > today && !dueIds.has(card.id) ? [day] : [];
    })
    .sort();

  const intervalTotal = reviewed.reduce((sum, card) => sum + (card.intervalDays || 0), 0);

  return {
    totalCards: cards.length,
    reviewedCards: reviewed.length,
    dueToday: due.length,
    scheduledLater: futureDays.length,
    neverReviewed: cards.length - reviewed.length,
    favoriteCards: cards.filter((card) => card.isFavorite).length,
    masteryBuckets: BUCKET_DEFS.map((def) => ({
      ...def,
      count: cards.filter((card) => card.masteryLevel >= def.min && card.masteryLevel <= def.max).length,
    })),
    averageIntervalDays: reviewed.length === 0 ? 0 : Math.round((intervalTotal / reviewed.length) * 10) / 10,
    nextDueDay: futureDays[0] ?? null,
  };
}

/**
 * 未来 7 天的到期负荷预测，用于判断复习节奏是否过载。
 */
export function dueForecast(cards: KnowledgeCard[], today = todayStamp(), days = 7): Array<{ day: string; count: number }> {
  const byDay = new Map<string, number>();
  for (const card of cards) {
    const day = reviewDay(card);
    if (!day) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const out: Array<{ day: string; count: number }> = [];
  const [y, m, d] = today.split("-").map(Number);
  for (let offset = 0; offset < days; offset += 1) {
    const value = new Date(y, (m ?? 1) - 1, d ?? 1);
    value.setDate(value.getDate() + offset);
    const key = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    out.push({ day: key, count: byDay.get(key) ?? 0 });
  }
  return out;
}
