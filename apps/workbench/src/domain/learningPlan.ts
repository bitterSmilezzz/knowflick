import type { KnowledgeCard } from "./card";
import { addDays, dueCards, localDay, reviewDay, todayStamp } from "./review";

export interface MasteryDistribution {
  masteredCount: number;
  hesitantCount: number;
  needsReviewCount: number;
  totalCards: number;
  testedCards: number;
  retentionRate: number;
  totalReviews: number;
}

export interface UpcomingDayStat {
  day: string;
  count: number;
  isToday: boolean;
}

export interface LearningPlanSnapshot {
  today: string;
  completedToday: number;
  mastered: number;
  masteryDistribution: MasteryDistribution;
  due: KnowledgeCard[];
  upcomingSchedule: (days: number) => UpcomingDayStat[];
  upcomingCards: (limit: number) => Array<{ card: KnowledgeCard; day: string }>;
}

function scheduledPairs(cards: KnowledgeCard[]): Array<{ card: KnowledgeCard; day: string }> {
  return cards
    .flatMap((card) => {
      const day = reviewDay(card);
      return day ? [{ card, day }] : [];
    })
    .sort((a, b) => a.day.localeCompare(b.day) || a.card.id.localeCompare(b.card.id));
}

export function masteryDistribution(cards: KnowledgeCard[]): MasteryDistribution {
  const masteredCount = cards.filter((card) => card.masteryLevel >= 2).length;
  const hesitantCount = cards.filter((card) => card.masteryLevel === 1).length;
  const totalCards = cards.length;
  const needsReviewCount = Math.max(0, totalCards - masteredCount - hesitantCount);
  const testedCards = cards.filter((card) => card.reviewCount > 0 || card.masteryLevel > 0).length;
  const retentionRate = testedCards === 0
    ? 0
    : Math.min(100, Math.max(0, Math.round(((masteredCount * 1.0 + hesitantCount * 0.5) / testedCards) * 100)));
  const totalReviews = cards.reduce((sum, card) => sum + card.reviewCount, 0);
  return {
    masteredCount,
    hesitantCount,
    needsReviewCount,
    totalCards,
    testedCards,
    retentionRate,
    totalReviews,
  };
}

export function createLearningPlan(cards: KnowledgeCard[], today = todayStamp()): LearningPlanSnapshot {
  const scheduled = scheduledPairs(cards);
  const due = dueCards(cards, today);
  const scheduleCounts = new Map<string, number>();
  for (const { day } of scheduled) {
    scheduleCounts.set(day, (scheduleCounts.get(day) ?? 0) + 1);
  }
  return {
    today,
    completedToday: cards.filter((card) =>
      [card.seenAt, card.lastReviewedAt].some((instant) => instant !== null && localDay(instant) === today),
    ).length,
    mastered: cards.filter((card) => card.masteryLevel >= 2).length,
    masteryDistribution: masteryDistribution(cards),
    due,
    upcomingSchedule(days: number) {
      if (days <= 0) return [];
      return Array.from({ length: days }, (_, offset) => {
        const day = addDays(today, offset);
        const count = offset === 0 ? due.length : (scheduleCounts.get(day) ?? 0);
        return { day, count, isToday: offset === 0 };
      });
    },
    upcomingCards(limit: number) {
      if (limit <= 0) return [];
      return scheduled.slice(0, limit).map(({ card, day }) => ({ card, day }));
    },
  };
}
