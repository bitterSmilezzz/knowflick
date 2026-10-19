import { describe, expect, it } from "vitest";
import { cardFromJson } from "./card";
import { parseMarkdownNotes } from "./notes";
import { addCards, cardsFromModelText, estimateTokenCount, smartSliceText } from "./ingest";

describe("notes and ingest", () => {
  it("estimates token count correctly for mixed text", () => {
    const text = "这是测试文本，包含中文和 English words.";
    const result = estimateTokenCount(text);
    expect(result.tokens).toBeGreaterThan(5);
    expect(result.summary).toContain("tokens");
  });

  it("slices long text along Markdown section headings", () => {
    const long = `# 第一章\n\n${"A".repeat(2500)}\n\n# 第二章\n\n${"B".repeat(2500)}`;
    const slices = smartSliceText(long, 3000);
    expect(slices.length).toBe(2);
    expect(slices[0]).toContain("第一章");
    expect(slices[1]).toContain("第二章");
  });

  it("deduplicates imports by normalized headline", () => {
    const existing = [cardFromJson({ id: "1", headline: "沉没成本不是成本", category: "经济" })];
    const incoming = [
      cardFromJson({ id: "2", headline: "沉没成本，不是成本！", category: "经济" }),
      cardFromJson({ id: "3", headline: "全新的知识", category: "经济" }),
    ];
    const result = addCards(existing, incoming);
    expect(result.added).toBe(1);
    expect(result.cards).toHaveLength(2);
    expect(result.cards[0]?.headline).toBe("全新的知识");
  });

  it("splits markdown on a divider and keeps numeric headlines", () => {
    const cards = parseMarkdownNotes("# 3.14 是圆周率\n\n摘要\n\n---\n\n# 幸存者偏差\n\n> 看不见的飞机没有回来");
    expect(cards.map((card) => card.headline)).toEqual(["3.14 是圆周率", "幸存者偏差"]);
    expect(cards[1]?.summary).toContain("看不见的飞机");
  });

  it("drops short AI details and keeps the rest", () => {
    const long = "原理".repeat(50);
    const cards = cardsFromModelText(JSON.stringify([
      { category: "物理", headline: "短", summary: "s", details: "太短", searchKeywords: [], sources: [] },
      { category: "物理", headline: "够长", summary: "摘要", details: long, searchKeywords: ["熵"], sources: ["维基百科"] },
    ]));
    expect(cards).toHaveLength(1);
    expect(cards[0]?.links[0]?.url).toContain("bing.com");
  });
});
