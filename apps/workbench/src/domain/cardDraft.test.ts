import { describe, expect, it } from "vitest";
import { toCardDraftInput } from "./cardDraft";
import type { KnowledgeCard } from "./card";

const card: KnowledgeCard = {
  id: "CARD-1", category: "架构", headline: "标题", summary: "摘要", details: "正文".repeat(50),
  links: [{ title: "搜索：A", url: "https://www.bing.com/search?q=A" }], tags: ["标签"],
  source: "ai", createdAt: 1, editedAt: null, seenAt: null, swiped: null, isFavorite: false,
  favoritedAt: null, reviewCount: 0, masteryLevel: 0, lastReviewedAt: null, repetition: 0,
  intervalDays: 1, easeFactor: 2.5, stability: 0, difficulty: 0, subject: null, branch: null,
  level: null, track: null, orderKey: null, prereq: [],
};

describe("AI 提炼卡片转新建输入", () => {
  it("保留内容与出处，版本 0 表示新建", () => {
    const draft = toCardDraftInput(card, "material-1");
    expect(draft.id).toBe("CARD-1");
    expect(draft.version).toBe(0);
    expect(draft.materialId).toBe("material-1");
    expect(draft.source).toBe("ai");
    expect(draft.content).toEqual({ category: "架构", headline: "标题", summary: "摘要", details: card.details, tags: ["标签"] });
    expect(draft.links).toEqual(card.links);
  });
});
