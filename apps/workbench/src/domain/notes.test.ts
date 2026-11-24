import { describe, expect, it } from "vitest";
import { parseNotesFile } from "./notes";

/**
 * 「把攒下的笔记直接变成可复习的知识卡」——笔记软件最该有的能力。
 * 解析器早就写好了却没有入口，这一组用例先把它的行为钉住。
 *
 * 切分规则（有意为之）：按**最浅**的标题层级切。一篇 `# 标题` 带若干 `## 小节`
 * 的笔记，整篇是一张卡；只有当最浅层就是 `##` 时才按小节拆开。
 * 这样「一篇文章一个观点」与「一篇笔记多条结论」两种写法都能自然表达。
 */
describe("笔记文件转知识卡", () => {
  it("按最浅标题层级切分：# 下面有多个 ## 时，整篇一张卡", () => {
    const markdown = [
      "# 读书笔记",
      "",
      "## 复购率比拉新重要",
      "",
      "获取成本远高于维护成本。",
      "",
      "## 小团队更要自动化",
      "",
      "人手少时手工流程的浪费被放大。",
    ].join("\n");
    const cards = parseNotesFile(markdown, "读书笔记.md");
    expect(cards.length).toBe(1);
    // 最浅的一级标题成为卡标题；其余小节作为正文保留
    expect(cards[0].headline).toContain("读书笔记");
    expect(cards[0].details).toContain("小团队更要自动化");
    expect(cards[0].details).toContain("人手少时手工流程的浪费被放大");
  });

  it("最浅层是 ## 时按小节拆成多张卡", () => {
    const markdown = [
      "## 复购率比拉新重要",
      "",
      "获取成本远高于维护成本。",
      "",
      "## 小团队更要自动化",
      "",
      "人手少时手工流程的浪费被放大。",
    ].join("\n");
    const cards = parseNotesFile(markdown, "结论.md");
    expect(cards.length).toBe(2);
    expect(cards[0].headline).toContain("复购率");
    expect(cards[0].details).toContain("获取成本");
    expect(cards[1].headline).toContain("自动化");
  });

  it("文件级 frontmatter 的分类与标签会传给拆出来的每一张卡", () => {
    const markdown = [
      "---",
      "category: 商业",
      "tags: [增长, 留存]",
      "---",
      "",
      "## 一条结论",
      "",
      "正文内容。",
      "",
      "## 另一条结论",
      "",
      "更多正文。",
    ].join("\n");
    const cards = parseNotesFile(markdown, "note.md");
    expect(cards.length).toBe(2);
    // 修之前只有第一张卡拿得到分类，其余全丢——同一篇笔记拆出来的卡应当同类。
    expect(cards[0].category).toBe("商业");
    expect(cards[1].category).toBe("商业");
    expect(cards[0].tags).toContain("增长");
    expect(cards[1].tags).toContain("留存");
  });

  it("JSON 数组也能转", () => {
    const json = JSON.stringify([
      { headline: "卡片一", summary: "摘要", details: "正文", category: "技术" },
      { headline: "卡片二", summary: "摘要", details: "正文" },
    ]);
    const cards = parseNotesFile(json, "cards.json");
    expect(cards.length).toBe(2);
    expect(cards[0].headline).toBe("卡片一");
    expect(cards[0].category).toBe("技术");
  });

  it("空文件不产出卡片，也不抛错", () => {
    expect(parseNotesFile("", "empty.md")).toEqual([]);
    expect(parseNotesFile("   \n  ", "empty.md")).toEqual([]);
  });

  it("每张卡都有可复习的标题与正文", () => {
    const markdown = "## 只有标题没有正文\n\n";
    const cards = parseNotesFile(markdown, "x.md");
    // 原来这里是个 for 循环里的 toBeGreaterThan(0)：**数组为空时循环零次、
    // 断言直接通过**——什么都没解析出来也算「通过」。先断言确实有卡。
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.headline.trim().length).toBeGreaterThan(0);
      expect(card.details.trim().length).toBeGreaterThan(0);
    }
  });

  it("标题有但正文空时，正文回落到标题（不留空壳卡）", () => {
    const markdown = "## 只有标题\n\n";
    const cards = parseNotesFile(markdown, "x.md");
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.details.trim().length).toBeGreaterThan(0);
      expect(card.summary.trim().length).toBeGreaterThan(0);
    }
  });
});
