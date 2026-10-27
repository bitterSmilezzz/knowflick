import { describe, expect, it } from "vitest";
import type { KnowledgeCard } from "./card";
import type { RawMaterial } from "../shell/store";
import type { Goal } from "../shell/store";
import { periodLabel, periodStart, reviewFacts, reviewToMarkdown } from "./reviewFacts";

/** 复盘聚合（R4/D03 底座）：只产事实、缺记录如实报零、达成是显式状态。 */

const DAY = 24 * 60 * 60 * 1000;
/** 固定“现在”：2026-10-25（周日）12:00 本地时间，测试不随钟表漂。 */
const NOW = new Date(2026, 9, 25, 12, 0, 0).getTime();

function material(id: string, at: number): RawMaterial {
  return {
    id, sourceType: "manual", title: `素材 ${id}`, sourceUrl: null, rawText: "正文",
    contentHash: "", mediaPath: null, mediaSizeBytes: 0, metadataJson: "{}",
    inboxStatus: "inbox", createdAt: at, updatedAt: at,
  };
}

function card(id: string, at: number, reviewCount = 0): KnowledgeCard {
  return {
    id, category: "随手笔记", headline: `卡 ${id}`, summary: "摘要", details: "正文",
    links: [], tags: [], source: "imported", createdAt: at, updatedAt: at,
    isFavorite: false, reviewCount, masteryLevel: 0, lastReviewedAt: reviewCount > 0 ? at : null,
    repetition: 0, intervalDays: 0, easeFactor: 2.5, stability: 0, difficulty: 0,
    subject: null, branch: null, level: null, track: null, orderKey: null, prereq: [],
    materialId: null, isDeleted: false, deletedAt: null, seenAt: null, editedAt: null,
    swiped: null, favoritedAt: null,
  } as unknown as KnowledgeCard;
}

function goal(id: string, evidenceCount: number, achieved = false): Goal {
  return {
    id, title: `目标 ${id}`, doneCriteria: "用户写的条件", scope: null,
    createdAt: NOW - 30 * DAY, achievedAt: achieved ? NOW : null, abandonedAt: null,
    reviewNote: "", evidenceCount,
  };
}

describe("复盘事实聚合（R4/D03 底座）", () => {
  it("周期起点对齐：日=当日零点、周=周一零点、月=月初零点", () => {
    // NOW 是周日
    const weekStart = periodStart("week", NOW);
    expect(new Date(weekStart).getDay()).toBe(1);
    expect(weekStart).toBeLessThanOrEqual(NOW);
    const monthStart = periodStart("month", NOW);
    expect(new Date(monthStart).getDate()).toBe(1);
  });

  it("只算周期内的事实；周期外的（哪怕只差一天）不计入", () => {
    const input = {
      materials: [material("in-1", NOW - 1000), material("out", NOW - 40 * DAY)],
      cards: [card("card-in", NOW - 1000, 2)],
      goals: [],
      now: NOW,
    };
    const facts = reviewFacts(input, "month");
    expect(facts.newMaterials.map((m) => m.id)).toEqual(["in-1"]);
    expect(facts.newCards).toHaveLength(1);
    expect(facts.reviewedCardCount).toBe(1);
  });

  it("缺记录如实报零并进 gaps——没有任何「落后/失败」状态", () => {
    const facts = reviewFacts({ materials: [], cards: [], goals: [goal("g1", 0)], now: NOW }, "week");
    expect(facts.newMaterials).toHaveLength(0);
    expect(facts.newCards).toHaveLength(0);
    expect(facts.gaps).toContain("本周期没有新收集的素材");
    expect(facts.gaps).toContain("本周期没有复习动作");
    // 有活跃目标但证据为 0：是「没有记录」，不是失败
    expect(facts.goals[0].evidenceCount).toBe(0);
    expect(facts.goals[0].achieved).toBe(false);
  });

  it("达成是显式状态；活跃目标无证据也会进 goals 清单", () => {
    const facts = reviewFacts({ materials: [], cards: [], goals: [goal("g-done", 3, true), goal("g-active", 0)], now: NOW }, "month");
    expect(facts.goals.find((g) => g.id === "g-done")?.achieved).toBe(true);
    expect(facts.goals.find((g) => g.id === "g-active")?.evidenceCount).toBe(0);
  });

  it("不把累计复习次数或证据数冒充周期内的事件", () => {
    const facts = reviewFacts({ materials: [], cards: [card("old-history", NOW - 1000, 50)], goals: [goal("g1", 0)], now: NOW }, "week");
    expect(facts.reviewedCardCount).toBe(1);
    expect(facts.gaps.join(" ")).not.toContain("本周期没有新增证据");
    const md = reviewToMarkdown(facts);
    expect(md).toContain("无法统计本周期动作次数");
    expect(md).not.toContain("50 次");
  });

  it("Markdown 导出带周期边界与全部事实段；不出现任何评价措辞", () => {
    const facts = reviewFacts(
      { materials: [material("m1", NOW - 1000)], cards: [], goals: [goal("g1", 2)], now: NOW },
      "week",
    );
    const md = reviewToMarkdown(facts);
    expect(md).toContain("# 复盘：");
    expect(md).toContain("新收集素材：1 条");
    expect(md).toContain("目标现状（证据数只是计数，不是进度评分）");
    expect(md).toContain("没有记录的方面");
    // 口径守卫：导出里不得出现系统判定的负面词
    expect(md).not.toMatch(/落后|失败|未达标|拖延/);
  });

  it("标签措辞随周期类型变化", () => {
    expect(periodLabel("day", NOW)).toContain("10月25日");
    expect(periodLabel("month", NOW)).toContain("2026 年 10 月");
  });
});
