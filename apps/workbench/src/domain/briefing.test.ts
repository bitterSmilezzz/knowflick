import { describe, expect, it } from "vitest";
import { generateCognitiveBriefing } from "./briefing";
import type { KnowledgeCard } from "./card";

// Windows CI runner 明显更慢：这条在 macOS 上数百毫秒、在 Windows 上超过 5 秒
// 默认上限（实测 7.4 秒）。这不是被测逻辑的问题，慢的是 runner——给足超时，
// 否则 release 工作流会因超时红掉。
describe("周期性认知简报算法测试 (固定三板块)", { timeout: 30_000 }, () => {
  const now = 1700000000000;
  const dayMs = 86400 * 1000;

  const mockCards: KnowledgeCard[] = [
    {
      id: "card-new-1",
      category: "AI",
      headline: "OpenViking 架构解析",
      summary: "目录级 sidecar 与虚拟文件系统",
      details: "详细内容...",
      links: [],
      source: "imported",
      createdAt: now - dayMs * 2, // 2天前，新收
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
    },
    {
      id: "card-old-1",
      category: "架构",
      headline: "SQLite WAL 机制深入",
      summary: "写前日志提升高并发读写性能",
      details: "详细机制...",
      links: [],
      source: "imported",
      createdAt: now - dayMs * 30, // 30天前，旧内容
      editedAt: null,
      seenAt: null,
      swiped: null,
      isFavorite: true, // 收藏
      favoritedAt: now - dayMs * 29,
      reviewCount: 1,
      masteryLevel: 1,
      lastReviewedAt: now - dayMs * 20,
      repetition: 1,
      intervalDays: 3,
      easeFactor: 2.5,
      stability: 0,
      difficulty: 0,
      subject: null,
      branch: null,
      level: null,
      track: null,
      orderKey: null,
      prereq: [],
    },
  ];

  it("正确生成固定三模块简报", () => {
    const briefing = generateCognitiveBriefing(mockCards, now, 7);

    expect(briefing.sections.length).toBe(3);
    expect(briefing.newCapturedCount).toBe(1);

    // 第一模块：新收内容聚类
    expect(briefing.sections[0].title).toBe("一、近期新收内容聚类");
    expect(briefing.sections[0].items[0].title).toContain("AI");

    // 第二模块：核心关注趋势
    expect(briefing.sections[1].title).toBe("二、核心关注趋势演变");
    expect(briefing.sections[1].items.length).toBeGreaterThan(0);

    // 第三模块：值得回看的旧内容
    expect(briefing.sections[2].title).toBe("三、温故知新：值得回看的旧内容");
    expect(briefing.sections[2].items[0].title).toBe("SQLite WAL 机制深入");

    // Markdown 字符串结构校验
    expect(briefing.markdown).toContain("# 认知简报");
    expect(briefing.markdown).toContain("OpenViking 架构解析");
    expect(briefing.markdown).toContain("SQLite WAL 机制深入");
  });
});
