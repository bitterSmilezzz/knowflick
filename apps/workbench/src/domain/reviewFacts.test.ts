import { describe, expect, it } from "vitest";
import type { KnowledgeCard } from "./card";
import type { RawMaterial } from "../shell/store";
import type { Goal } from "../shell/store";
import type { Note } from "./note";
import { periodLabel, periodStart, projectFactMembership, reviewFacts, reviewToMarkdown } from "./reviewFacts";
import type { ReviewHistorySnapshot } from "./reviewHistory";

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

function note(id: string, createdAt: number, updatedAt = createdAt, isDeleted = false): Note {
  return {
    id, title: `笔记 ${id}`, bodyMd: "正文", notebook: null, tags: [],
    isPinned: false, isFavorite: false, archivedAt: null, sourceMaterialId: null,
    currentRevision: 1, createdAt, updatedAt, isDeleted, deletedAt: isDeleted ? updatedAt : null,
    excludeFromProfile: false,
  };
}

function history(coverageStartedAt: number, events: ReviewHistorySnapshot["events"]): ReviewHistorySnapshot {
  return { version: 1, coverageStartedAt, events };
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
    expect(facts.reviewHistoryAvailable).toBe(false);
    expect(facts.gaps).not.toContain("本周期没有逐次复习事件");
    expect(facts.gaps).toContain("逐次复习历史不可用，无法确认本周期动作次数");
    expect(reviewToMarkdown(facts)).toContain("历史不可用，无法确认本周期次数");
    expect(reviewToMarkdown(facts)).not.toContain("逐次复习事件：0 次");
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
    expect(md).toContain("历史不可用，无法确认本周期次数");
    expect(md).not.toContain("50 次");
  });

  it("只把覆盖起点之后的逐次事件作为完整周期次数", () => {
    const from = periodStart("week", NOW);
    const events = [{
      id: "00000000-0000-4000-8000-000000000001", cardId: "reviewed", reviewedAt: NOW - 1000,
      rating: "good" as const, algorithm: "fsrs" as const, projectIds: [], projectAttributionComplete: true,
    }];
    const complete = reviewFacts({ materials: [], cards: [], goals: [], now: NOW, reviewHistory: history(from, events) }, "week");
    expect(complete.reviewHistoryComplete).toBe(true);
    expect(complete.reviewEvents).toHaveLength(1);
    expect(reviewToMarkdown(complete)).toContain("1 次（周期历史完整）");
    const partial = reviewFacts({ materials: [], cards: [], goals: [], now: NOW, reviewHistory: history(from + 1, events) }, "week");
    expect(partial.reviewHistoryComplete).toBe(false);
    expect(reviewToMarkdown(partial)).toContain("仅为已记录数");
  });

  it("项目范围只计入评分时归属该项目的事件，并保留归属缺口", () => {
    const projectId = "00000000-0000-4000-8000-000000000001";
    const events = [
      { id: "00000000-0000-4000-8000-000000000002", cardId: "a", reviewedAt: NOW - 1000, rating: "good" as const, algorithm: "fsrs" as const, projectIds: [projectId], projectAttributionComplete: true },
      { id: "00000000-0000-4000-8000-000000000003", cardId: "b", reviewedAt: NOW - 900, rating: "hard" as const, algorithm: "fsrs" as const, projectIds: [], projectAttributionComplete: false },
    ];
    const facts = reviewFacts({ materials: [], cards: [], goals: [], now: NOW, projectScope: [projectId], reviewHistory: history(periodStart("week", NOW), events) }, "week");
    expect(facts.reviewEvents.map((event) => event.cardId)).toEqual(["a"]);
    expect(facts.projectReviewHistoryComplete).toBe(false);
  });

  it("项目事实通过成员笔记、来源素材和卡片来源链筛选，并支持共享笔记", () => {
    const projectId = "00000000-0000-4000-8000-000000000001";
    const otherProjectId = "00000000-0000-4000-8000-000000000004";
    const membership = projectFactMembership(
      [projectId],
      [
        { id: "n1", sourceMaterialId: "m1", isDeleted: false },
        { id: "n2", sourceMaterialId: "m2", isDeleted: false },
        { id: "n3", sourceMaterialId: "m3", isDeleted: false },
        { id: "n4", sourceMaterialId: "m4", isDeleted: true },
      ],
      [
        { id: "c1", materialId: "m1" },
        { id: "c2", materialId: "m2" },
        { id: "c3", materialId: "m3" },
        { id: "c4", materialId: null },
      ],
      new Map([
        ["n1", [projectId]],
        ["n2", [otherProjectId]],
        ["n3", [projectId, otherProjectId]],
        ["n4", [projectId]],
      ]),
    );
    expect([...membership.noteIds].sort()).toEqual(["n1", "n3"]);
    expect([...membership.materialIds].sort()).toEqual(["m1", "m3"]);
    expect([...membership.cardIds].sort()).toEqual(["c1", "c3"]);
  });

  it("项目复盘同时筛选素材、卡片、目标和逐次事件", () => {
    const projectId = "00000000-0000-4000-8000-000000000001";
    const otherProjectId = "00000000-0000-4000-8000-000000000004";
    const from = periodStart("week", NOW);
    const facts = reviewFacts({
      materials: [material("m1", NOW - 1000), material("m2", NOW - 900)],
      notes: [
        note("new-note", NOW - 1000, NOW - 900),
        note("updated-note", NOW - 10 * DAY, NOW - 800),
        note("other-note", NOW - 700),
        note("deleted-note", NOW - 600, NOW - 500, true),
      ],
      cards: [
        { ...card("c1", NOW - 800, 1), materialId: "m1" },
        { ...card("c2", NOW - 700, 1), materialId: "m2" },
      ],
      goals: [goal("g1", 1), { ...goal("g2", 2), scope: otherProjectId }, { ...goal("g3", 0), scope: projectId }],
      goalEvidence: [],
      projectScope: [projectId],
      projectNoteIds: new Set(["new-note", "updated-note", "deleted-note"]),
      projectMaterialIds: new Set(["m1"]),
      projectCardIds: new Set(["c1"]),
      reviewHistory: history(from, [
        { id: "00000000-0000-4000-8000-000000000002", cardId: "c1", reviewedAt: NOW - 1000, rating: "good", algorithm: "fsrs", projectIds: [projectId], projectAttributionComplete: true },
        { id: "00000000-0000-4000-8000-000000000003", cardId: "c2", reviewedAt: NOW - 900, rating: "hard", algorithm: "fsrs", projectIds: [otherProjectId], projectAttributionComplete: true },
      ]),
      now: NOW,
    }, "week");
    expect(facts.newMaterials.map((row) => row.id)).toEqual(["m1"]);
    expect(facts.newNotes.map((row) => [row.id, row.activity])).toEqual([
      ["updated-note", "updated"],
      ["new-note", "created"],
    ]);
    expect(facts.noteFactsAvailable).toBe(true);
    expect(facts.newCards.map((row) => row.id)).toEqual(["c1"]);
    expect(facts.reviewedCardCount).toBe(1);
    expect(facts.reviewEvents.map((event) => event.cardId)).toEqual(["c1"]);
    expect(facts.goals.map((row) => row.id)).toEqual(["g3"]);
    expect(facts.projectFactsAvailable).toBe(true);
    expect(reviewToMarkdown(facts)).toContain("更新《笔记 updated-note》");
    expect(reviewToMarkdown(facts)).toContain("笔记 ID：new-note");
  });

  it("项目归属未就绪时不把全库内容或零条伪装成项目事实", () => {
    const projectId = "00000000-0000-4000-8000-000000000001";
    const facts = reviewFacts({
      materials: [material("global", NOW - 1000)],
      notes: null,
      cards: [card("global-card", NOW - 1000)],
      goals: [],
      projectScope: [projectId],
      projectNoteIds: null,
      projectMaterialIds: null,
      projectCardIds: null,
      now: NOW,
    }, "week");
    expect(facts.projectFactsAvailable).toBe(false);
    expect(facts.noteFactsAvailable).toBe(false);
    expect(facts.newMaterials).toEqual([]);
    expect(facts.newCards).toEqual([]);
    expect(facts.reviewedCardCount).toBeNull();
    expect(facts.gaps).toContain("项目归属索引不可用，无法确认所选项目的素材与知识卡记录");
    expect(facts.gaps).not.toContain("本周期没有新收集的素材");
    expect(reviewToMarkdown(facts)).toContain("归属数据不可用，未计算数量");
    expect(reviewToMarkdown(facts)).not.toContain("新收集素材：0 条");
  });

  it("周期证据按关联时间和目标归属过滤；未读取与零条不同", () => {
    const from = periodStart("week", NOW);
    const rows = [
      { goalId: "g1", evidenceId: "start", kind: "note" as const, linkedAt: from, title: "周初笔记" },
      { goalId: "g1", evidenceId: "end", kind: "material" as const, linkedAt: NOW, title: null },
      { goalId: "g1", evidenceId: "old", kind: "note" as const, linkedAt: from - 1, title: "旧笔记" },
      { goalId: "g2", evidenceId: "other", kind: "note" as const, linkedAt: NOW, title: "另一目标" },
    ];
    const base = { materials: [], cards: [], goals: [goal("g1", 8), goal("g2", 1)], now: NOW };
    const facts = reviewFacts({ ...base, goalEvidence: rows }, "week");
    expect(facts.goals[0].periodEvidence?.map((e) => e.evidenceId)).toEqual(["end", "start"]);
    expect(facts.goals[1].periodEvidence?.map((e) => e.evidenceId)).toEqual(["other"]);
    const md = reviewToMarkdown(facts);
    expect(md).toContain("原件已删除或不可用");
    expect(md).toContain("笔记 ID：start");
    expect(reviewFacts(base, "week").goals[0].periodEvidence).toBeNull();
    expect(reviewToMarkdown(reviewFacts(base, "week"))).toContain("本周期证据明细未读取");
    expect(reviewFacts({ ...base, goalEvidence: [] }, "week").goals[0].periodEvidence).toEqual([]);
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
