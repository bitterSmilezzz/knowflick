import { describe, expect, it } from "vitest";
import { parseMarkdownNotes } from "./notes";

const dividerFixture = `
---
category: 心理学
title: 峰终定律：大脑只记住高潮和结局
---
> 过程的漫长被压缩，峰值与结束时刻决定整体体验。
丹尼尔·卡尼曼提出的认知偏差。

---
## 幸存者偏差：看不见的弹孔最致命
**领域**：[[统计学]]
> 只统计幸存下来的样本，会得出完全颠倒的因果推论。
沃德力排众议建议加强没有弹孔的机翼引擎。
[沃德统计学故事](https://example.com/ward)
`.trim();

describe("note markdown parser", () => {
  it("extracts dividers, category, summary, and links like Kotlin", () => {
    const cards = parseMarkdownNotes(dividerFixture);
    expect(cards).toHaveLength(2);
    expect(cards[0]?.category).toBe("心理学");
    expect(cards[0]?.headline).toContain("峰终定律");
    expect(cards[0]?.summary).toContain("过程的漫长被压缩");
    expect(cards[0]?.source).toBe("imported");
    expect(cards[1]?.category).toBe("统计学");
    expect(cards[1]?.headline).toContain("幸存者偏差");
    expect(cards[1]?.links).toHaveLength(1);
    expect(cards[1]?.links[0]?.title).toBe("沃德统计学故事");
  });

  it("falls back to first line for plain notes", () => {
    const text = `
为什么飞机的窗户都是圆角的？
方形窗户在机舱加压时四角会产生巨大应力集中。
慧星客机空难后，工程师发现尖锐转角是金属疲劳断裂的温床。
`.trim();
    const cards = parseMarkdownNotes(text, "工程学");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.category).toBe("工程学");
    expect(cards[0]?.headline).toContain("为什么飞机的窗户都是圆角的");
    expect(cards[0]?.details).toContain("慧星客机空难");
  });

  it("keeps numeric headlines unless they are ordering prefixes", () => {
    expect(parseMarkdownNotes("# 3.14 是圆周率\n> 圆周率是无理数。\n祖冲之把它算到小数点后七位。")[0]?.headline).toBe("3.14 是圆周率");
    expect(parseMarkdownNotes("# 2024. 年度总结\n> 一年的关键结论。\n正文内容。")[0]?.headline).toBe("2024. 年度总结");
    expect(parseMarkdownNotes("# 1.5 倍增长\n> 复利效应。\n正文内容。")[0]?.headline).toBe("1.5 倍增长");
    expect(parseMarkdownNotes("# 1. 沉没成本不是成本\n> 摘要。\n正文内容。")[0]?.headline).toBe("沉没成本不是成本");
  });
});
