import { describe, expect, it } from "vitest";
import type { KnowledgeCard, SwipeDirection } from "./card";
import { computeStats } from "./stats";

const TODAY = "2026-09-12";

function atDay(daysAgo: number, hour = 12): number {
  const [year, month, date] = TODAY.split("-").map(Number);
  const value = new Date(year, (month ?? 1) - 1, date ?? 1);
  value.setDate(value.getDate() - daysAgo);
  value.setHours(hour, 0, 0, 0);
  return value.getTime();
}

function card(
  headline: string,
  seenAt: number | null = null,
  swiped: SwipeDirection | null = null,
  category = "物理",
): KnowledgeCard {
  return {
    id: headline,
    category,
    headline,
    summary: "摘要",
    details: "正文",
    links: [],
    source: "imported",
    createdAt: 0,
    editedAt: null,
    seenAt,
    swiped,
    isFavorite: swiped === "right",
    favoritedAt: null,
    reviewCount: 0,
    masteryLevel: 0,
    lastReviewedAt: null,
    repetition: 0,
    intervalDays: 0,
    easeFactor: 2.5,
    stability: 0,
    difficulty: 0,
    subject: null,
    branch: null,
    level: null,
    track: null,
    orderKey: null,
    prereq: [],
  };
}

describe("stats", () => {
  it("empty data produces zero stats", () => {
    const stats = computeStats([], TODAY);
    expect(stats.seenCount).toBe(0);
    expect(stats.likeRate).toBe(0);
    expect(stats.streakDays).toBe(0);
    expect(stats.categories).toEqual([]);
  });

  it("intent counts follow swipe semantics", () => {
    const stats = computeStats(
      [
        card("a", atDay(0), "right"),
        card("b", atDay(0), "left"),
        card("c", atDay(0), "skip"),
        card("d", atDay(0), "skip"),
      ],
      TODAY,
    );
    expect(stats.seenCount).toBe(4);
    expect(stats.likedCount).toBe(1);
    expect(stats.skipCount).toBe(2);
    expect(stats.likeRate).toBeCloseTo(0.25, 9);
  });

  it("unfavorite does not affect intent counts", () => {
    const base = card("a", atDay(0), "right");
    const stats = computeStats([{ ...base, isFavorite: false, favoritedAt: null }], TODAY);
    expect(stats.likedCount).toBe(1);
  });

  it("streak counts with today gap tolerance", () => {
    const yesterday = card("a", atDay(1));
    const dayBefore = card("b", atDay(2));
    expect(computeStats([yesterday, dayBefore], TODAY).streakDays).toBe(2);
    expect(computeStats([card("c", atDay(4))], TODAY).streakDays).toBe(0);
  });

  it("daily counts cover seven days oldest to newest", () => {
    const stats = computeStats(
      [card("today", atDay(0)), card("today2", atDay(0)), card("twoDaysAgo", atDay(2))],
      TODAY,
    );
    expect(stats.daily).toHaveLength(7);
    expect(stats.daily.at(-1)?.day).toBe(TODAY);
    expect(stats.daily.at(-1)?.count).toBe(2);
    expect(stats.daily[4]?.count).toBe(1);
    expect(stats.daily[0]?.count).toBe(0);
  });

  it("category rows sorted by seen then name", () => {
    const stats = computeStats(
      [
        card("a", atDay(0), "right", "历史"),
        card("b", atDay(0), null, "历史"),
        card("c", atDay(0), null, "物理"),
      ],
      TODAY,
    );
    expect(stats.categories.map((row) => row.category)).toEqual(["历史", "物理"]);
    expect(stats.categories[0]?.seen).toBe(2);
    expect(stats.categories[0]?.liked).toBe(1);
  });
});
