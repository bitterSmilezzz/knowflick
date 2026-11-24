import type { KnowledgeCard } from "./card";
import { localDay } from "./review";

export interface DailyCount {
  day: string;
  count: number;
}

export interface CategoryStat {
  category: string;
  seen: number;
  liked: number;
}

export interface LearningStats {
  seenCount: number;
  likedCount: number;
  skipCount: number;
  streakDays: number;
  likeRate: number;
  daily: DailyCount[];
  categories: CategoryStat[];
}

export function computeStats(cards: KnowledgeCard[], today: string): LearningStats {
  const seen = cards.filter((card) => card.seenAt !== null);
  const likedCount = seen.filter((card) => card.swiped === "right").length;
  const skipCount = seen.filter((card) => card.swiped === "skip").length;
  const days = new Set(seen.map((card) => localDay(card.seenAt as number)));
  let cursor = today;
  if (!days.has(cursor)) cursor = shift(cursor, -1);
  let streakDays = 0;
  while (days.has(cursor)) {
    streakDays += 1;
    cursor = shift(cursor, -1);
  }
  const daily: DailyCount[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = shift(today, -offset);
    daily.push({ day, count: seen.filter((card) => localDay(card.seenAt as number) === day).length });
  }
  return {
    seenCount: seen.length,
    likedCount,
    skipCount,
    streakDays,
    likeRate: seen.length === 0 ? 0 : likedCount / seen.length,
    daily,
    categories: categoryStats(seen),
  };
}

function categoryStats(seen: KnowledgeCard[]): CategoryStat[] {
  const buckets = new Map<string, CategoryStat>();
  for (const card of seen) {
    const current = buckets.get(card.category) ?? { category: card.category, seen: 0, liked: 0 };
    current.seen += 1;
    if (card.swiped === "right") current.liked += 1;
    buckets.set(card.category, current);
  }
  return [...buckets.values()].sort((a, b) => b.seen - a.seen || a.category.localeCompare(b.category));
}

function shift(day: string, delta: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(year, (month ?? 1) - 1, date ?? 1);
  value.setDate(value.getDate() + delta);
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${m}-${d}`;
}
