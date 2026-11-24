import { describe, expect, it } from "vitest";
import { cardFromJson } from "./card";
import { createLearningPlan } from "./learningPlan";

const TODAY = "2026-09-12";

function atDay(daysAgo: number): number {
  const [year, month, date] = TODAY.split("-").map(Number);
  const value = new Date(year, (month ?? 1) - 1, date ?? 1);
  value.setDate(value.getDate() - daysAgo);
  value.setHours(12, 0, 0, 0);
  return value.getTime();
}

function card(headline: string, seenAt: number | null = null, reviewedAt: number | null = null, masteryLevel = 0) {
  return cardFromJson({
    id: headline,
    headline,
    category: "学习",
    summary: "摘要",
    details: "正文",
    seenAt: seenAt ?? undefined,
    lastReviewedAt: reviewedAt ?? undefined,
    masteryLevel,
  });
}

describe("learningPlan", () => {
  it("first review is due the day after reading", () => {
    const subject = card("首次复习", atDay(2));
    expect(createLearningPlan([], TODAY).due).toHaveLength(0);
    expect(createLearningPlan([subject], TODAY).due).toHaveLength(1);
  });

  it("grades cards with mastery intervals", () => {
    const dueNow = { ...card("到期", atDay(2), atDay(3), 1) };
    const notDue = { ...card("未到期", atDay(2), atDay(1), 2) };
    const plan = createLearningPlan([dueNow, notDue], TODAY);
    expect(plan.due.map((c) => c.id)).toEqual(["到期"]);
  });

  it("computes mastery distribution metrics", () => {
    const cards = [
      { ...card("卡1", atDay(3), atDay(1), 2), reviewCount: 3 },
      { ...card("卡2", atDay(2), atDay(1), 1), reviewCount: 2 },
      { ...card("卡3", atDay(1), atDay(1), 0), reviewCount: 1 },
      card("未测卡", atDay(1)),
    ];
    const dist = createLearningPlan(cards, TODAY).masteryDistribution;
    expect(dist.masteredCount).toBe(1);
    expect(dist.hesitantCount).toBe(1);
    expect(dist.needsReviewCount).toBe(2);
    expect(dist.testedCards).toBe(3);
    expect(dist.retentionRate).toBe(50);
    expect(dist.totalReviews).toBe(6);
  });

  it("builds upcoming schedule and preview cards", () => {
    const c1 = { ...card("今日到期"), lastReviewedAt: atDay(1), masteryLevel: 0 };
    const c2 = { ...card("后天到期"), lastReviewedAt: atDay(1), masteryLevel: 1 };
    const c3 = { ...card("明天到期"), lastReviewedAt: atDay(0), masteryLevel: 0 };
    const plan = createLearningPlan([c1, c2, c3], TODAY);
    const schedule = plan.upcomingSchedule(7);
    expect(schedule).toHaveLength(7);
    expect(schedule[0]?.count).toBe(1);
    expect(schedule[1]?.count).toBe(1);
    expect(schedule[2]?.count).toBe(1);
    const upcoming = plan.upcomingCards(2);
    expect(upcoming[0]?.card.id).toBe("今日到期");
    expect(upcoming[1]?.card.id).toBe("明天到期");
  });
});
