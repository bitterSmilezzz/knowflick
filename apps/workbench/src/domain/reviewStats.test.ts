import { describe, expect, it } from "vitest";
import { reviewOverview, dueForecast } from "./reviewStats";
import { cardFromJson } from "./card";
import type { KnowledgeCard } from "./card";

const TODAY = "2026-10-19";

function card(id: string, patch: Partial<KnowledgeCard> = {}): KnowledgeCard {
  return {
    ...cardFromJson({ id, headline: `卡片 ${id}`, category: "测试" }),
    seenAt: Date.parse("2026-10-18T09:00:00+08:00"),
    ...patch,
  };
}

describe("reviewStats", () => {
  it("counts never-reviewed and reviewed cards separately", () => {
    const reviewed = card("a", {
      lastReviewedAt: Date.parse("2026-10-18T09:00:00+08:00"),
      intervalDays: 4,
      masteryLevel: 2,
    });
    const fresh = card("b", { seenAt: null, lastReviewedAt: null });
    const overview = reviewOverview([reviewed, fresh], TODAY);
    expect(overview.totalCards).toBe(2);
    expect(overview.reviewedCards).toBe(1);
    expect(overview.neverReviewed).toBe(1);
    expect(overview.averageIntervalDays).toBe(4);
  });

  it("buckets mastery levels into five readable groups", () => {
    const cards = [
      card("l0", { masteryLevel: 0, lastReviewedAt: Date.now() }),
      card("l0b", { masteryLevel: 0, lastReviewedAt: Date.now() }),
      card("l3", { masteryLevel: 3, lastReviewedAt: Date.now() }),
    ];
    const overview = reviewOverview(cards, TODAY);
    expect(overview.masteryBuckets.map((b) => b.count)).toEqual([2, 0, 0, 1, 0]);
    expect(overview.masteryBuckets[0].label).toBe("新建");
    expect(overview.masteryBuckets[4].label).toBe("精通");
  });

  it("reports due today, later schedule and next due day", () => {
    const dueNow = card("due", {
      lastReviewedAt: Date.parse("2026-10-01T09:00:00+08:00"),
      intervalDays: 1,
      masteryLevel: 0,
    });
    const later = card("later", {
      lastReviewedAt: Date.parse("2026-10-18T09:00:00+08:00"),
      intervalDays: 6,
      masteryLevel: 2,
    });
    const overview = reviewOverview([dueNow, later], TODAY);
    expect(overview.dueToday).toBe(1);
    expect(overview.scheduledLater).toBe(1);
    expect(overview.nextDueDay).toBe("2026-10-24");
  });

  it("forecasts seven days of review load", () => {
    const cards = [
      card("today", { seenAt: null, lastReviewedAt: Date.parse("2026-10-18T09:00:00+08:00"), intervalDays: 1, masteryLevel: 0 }),
      card("in3", { seenAt: null, lastReviewedAt: Date.parse("2026-10-16T09:00:00+08:00"), intervalDays: 6, masteryLevel: 2 }),
    ];
    const forecast = dueForecast(cards, TODAY, 7);
    expect(forecast).toHaveLength(7);
    expect(forecast[0].day).toBe(TODAY);
    expect(forecast[0].count).toBe(1);
    expect(forecast.reduce((sum, d) => sum + d.count, 0)).toBe(2);
  });
});
