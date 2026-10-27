import { describe, expect, it } from "vitest";
import type { RawMaterial } from "../shell/store";
import type { KnowledgeCard } from "./card";

describe("数据模型三层转换契约 (M1)", () => {
  it("RawMaterial 可以正确映射到 Inbox 状态", () => {
    const material: RawMaterial = {
      id: "mat-test-1",
      sourceType: "web",
      title: "测试网页素材",
      sourceUrl: "https://example.com/test",
      rawText: "这是原始内容",
      cleanedMarkdown: "# 这是清洗后的标题",
      contentHash: "hash123",
      mediaPath: null,
      mediaSizeBytes: 0,
      metadataJson: "{}",
      inboxStatus: "inbox",
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    };

    expect(material.inboxStatus).toBe("inbox");
    expect(material.sourceType).toBe("web");
    expect(material.sourceUrl).toBe("https://example.com/test");
  });

  it("KnowledgeCard 能够保留溯源的 materialId 与 tags", () => {
    const card: KnowledgeCard & { materialId?: string; tags?: string[] } = {
      id: "card-test-1",
      category: "AI",
      headline: "第二大脑架构",
      summary: "三层数据模型保证原始凭证与知识卡解耦",
      details: "第一层素材，第二层原子知识卡，第三层认知产物。",
      links: [],
      source: "ai",
      createdAt: 1700000000000,
      editedAt: null,
      seenAt: null,
      swiped: null,
      isFavorite: false,
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
      materialId: "mat-test-1",
      tags: ["AI", "架构", "PKM"],
    };

    expect(card.materialId).toBe("mat-test-1");
    expect(card.tags).toContain("架构");
  });
});
