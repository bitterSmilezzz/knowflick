import { cardFromJson, type KnowledgeCard } from "./card";
import { applyReview, buildQuiz, calculateSm2, dueCards, previewIntervals, reviewDay, reviewQueue } from "./review";
import { describe, expect, it } from "vitest";

const NOW = 1_700_000_100_000;

function card(partial: Record<string, unknown> = {}): KnowledgeCard {
  return cardFromJson({ id: "c1", headline: "题", category: "物理", createdAt: 1_700_000_000_000, ...partial });
}

describe("SM-2", () => {
  it("matches Kotlin first-repetition intervals", () => {
    const fresh = card();
    expect(calculateSm2(fresh, "again", NOW)).toMatchObject({ repetition: 0, intervalDays: 1, masteryLevel: 0 });
    expect(calculateSm2(fresh, "hard", NOW)).toMatchObject({ repetition: 1, intervalDays: 1, masteryLevel: 1 });
    expect(calculateSm2(fresh, "good", NOW)).toMatchObject({ repetition: 1, intervalDays: 1, masteryLevel: 2 });
    expect(calculateSm2(fresh, "easy", NOW)).toMatchObject({ repetition: 1, intervalDays: 2, masteryLevel: 2 });
  });

  it("matches Kotlin second and third repetition growth", () => {
    const afterFirst = card({ repetition: 1, intervalDays: 1, easeFactor: 2.5 });
    expect(calculateSm2(afterFirst, "hard", NOW).intervalDays).toBe(3);
    expect(calculateSm2(afterFirst, "good", NOW).intervalDays).toBe(6);
    expect(calculateSm2(afterFirst, "easy", NOW).intervalDays).toBe(8);
    const afterSecond = card({ repetition: 2, intervalDays: 6, easeFactor: 2.5 });
    expect(calculateSm2(afterSecond, "good", NOW).intervalDays).toBe(15);
    expect(calculateSm2(afterSecond, "again", NOW)).toMatchObject({ repetition: 0, intervalDays: 1, masteryLevel: 0 });
    expect(calculateSm2(afterSecond, "again", NOW).easeFactor).toBeLessThan(2.5);
  });

  it("clamps ease factor between 1.3 and 3.0", () => {
    let low = card({ easeFactor: 1.35 });
    for (let i = 0; i < 5; i += 1) low = { ...low, easeFactor: calculateSm2(low, "again", NOW).easeFactor };
    expect(low.easeFactor).toBe(1.3);
    let high = card({ easeFactor: 2.95 });
    for (let i = 0; i < 5; i += 1) high = { ...high, easeFactor: calculateSm2(high, "easy", NOW).easeFactor };
    expect(high.easeFactor).toBe(3);
  });

  it("previews next intervals after the first review", () => {
    const afterFirst = card({ repetition: 1, intervalDays: 1, easeFactor: 2.5 });
    expect(previewIntervals(afterFirst, "sm2", NOW)).toEqual({ again: 1, hard: 3, good: 6, easy: 8 });
  });

  it("resets a forgotten card to one day and raises the first easy interval", () => {
    const fresh = card();
    const again = calculateSm2(fresh, "again", NOW);
    expect(again.intervalDays).toBe(1);
    expect(again.repetition).toBe(0);
    const easy = calculateSm2(fresh, "easy", NOW);
    expect(easy.intervalDays).toBe(2);
    expect(easy.masteryLevel).toBe(2);
    const applied = applyReview(fresh, again);
    expect(applied.reviewCount).toBe(1);
    expect(applied.lastReviewedAt).toBe(NOW);
  });

  it("schedules a seen-but-unreviewed card for the next day", () => {
    const seen = card({ seenAt: Date.parse("2026-10-12T10:00:00") });
    expect(reviewDay(seen)).toBe("2026-10-13");
    const due = dueCards([seen], "2026-10-13");
    expect(due.map((item) => item.id)).toEqual(["c1"]);
    expect(dueCards([seen], "2026-10-12")).toEqual([]);
  });

  it("builds a quiz with due cards ahead of unseen ones", () => {
    const seen = card({ id: "due", seenAt: Date.parse("2026-10-12T10:00:00") });
    const fresh = card({ id: "new" });
    expect(buildQuiz([fresh, seen], "2026-10-13", 10).map((item) => item.id)).toEqual(["due", "new"]);
  });
});

describe("复习队列（到期 + 新卡）", () => {
  it("从未看过的新卡不算到期，但会进入复习队列", () => {
    const fresh = card({ id: "new" });
    expect(dueCards([fresh], "2026-10-20")).toEqual([]);
    expect(reviewQueue([fresh], "2026-10-20").map((item) => item.id)).toEqual(["new"]);
  });

  it("到期的卡排在新卡之前", () => {
    const due = card({ id: "due", seenAt: Date.parse("2026-10-12T10:00:00") });
    const fresh = card({ id: "new" });
    expect(reviewQueue([fresh, due], "2026-10-13").map((item) => item.id)).toEqual(["due", "new"]);
  });

  it("已复习且未到期的卡不会重复出现", () => {
    const later = card({ id: "later", lastReviewedAt: Date.parse("2026-10-19T10:00:00"), intervalDays: 30, reviewCount: 2 });
    expect(reviewQueue([later], "2026-10-20")).toEqual([]);
  });

  it("队列受上限约束，不会一次塞几百张", () => {
    const many = Array.from({ length: 40 }, (_, i) => card({ id: `n${i}` }));
    expect(reviewQueue(many, "2026-10-20", 20)).toHaveLength(20);
  });
});
