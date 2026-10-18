import { describe, expect, it } from "vitest";
import { cardFromJson } from "./card";
import { classifyQuery, searchCards } from "./search";

describe("search", () => {
  it("classifies query types", () => {
    expect(classifyQuery("量子纠缠")).toBe("chinese");
    expect(classifyQuery("LRU")).toBe("english");
    expect(classifyQuery("zhongzixing")).toBe("pinyin_full");
    expect(classifyQuery("zzx")).toBe("initials");
  });

  it("finds cards by headline and filters source", () => {
    const cards = [
      cardFromJson({
        id: "1",
        category: "会计",
        headline: "新租赁准则下承租人不再区分经营融资租赁",
        summary: "表外租机队终于上了资产负债表。",
        details: "依据CAS 21准则",
        source: "imported",
        createdAt: 1000,
      }),
      cardFromJson({
        id: "2",
        category: "物理",
        headline: "量子纠缠的非定域性挑战爱因斯坦定域实在论",
        summary: "贝尔不等式",
        details: "EPR悖论",
        source: "ai",
        createdAt: 2000,
      }),
      cardFromJson({
        id: "3",
        category: "计算机",
        headline: "时间复杂度O(1)的LRU缓存基于双向链表与哈希表",
        summary: "最近最少使用",
        details: "哈希表定位",
        source: "seed",
        isFavorite: true,
        createdAt: 3000,
      }),
    ];
    expect(searchCards("租赁", cards)[0]?.card.id).toBe("1");
    expect(searchCards("xzl", cards)[0]?.card.category).toBe("会计");
    expect(searchCards("zulin", cards)[0]?.card.category).toBe("会计");
    expect(searchCards("量子", cards, { source: "ai" })).toHaveLength(1);
    expect(searchCards("LRU", cards, { source: "favorites" })[0]?.card.id).toBe("3");
    expect(searchCards("EPR", cards)[0]?.matchedField).toBe("details");
  });
});
