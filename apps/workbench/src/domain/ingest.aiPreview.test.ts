import { describe, expect, it } from "vitest";
import { cardsFromModelText } from "./ingest";

/**
 * AI 提炼的浏览器路径回归。
 *
 * 背景：`completeChat` 原先直接 invoke，浏览器模式一调就抛；aiTransform 又在最前面
 * `if (!inShell()) throw`，等于把「不配桌面端就用不了 AI 提炼」写死了。
 * 现在浏览器模式走 fetch 直连，这里锁住这条路径的解析与提示行为。
 */
describe("AI 提炼：模型输出解析与校验", () => {
  const longDetails =
    "RAG 的切块是精度与上下文的权衡：块过大稀释语义相似度，过小则丢失必要的上下文与指代关系。实践中 200 到 500 token 是常见起点，但更应顺着文档的自然结构切分，让每个块自身讲得完整，避免把一句话从中间截断。";

  it("解析标准卡片数组", () => {
    const text = JSON.stringify([
      { headline: "切块大小决定召回粒度", category: "计算机", summary: "块太大丢精度", details: longDetails, tags: ["RAG"] },
    ]);
    const cards = cardsFromModelText(text);
    expect(cards).toHaveLength(1);
    expect(cards[0].headline).toBe("切块大小决定召回粒度");
    expect(cards[0].category).toBe("计算机");
    expect(cards[0].source).toBe("ai");
  });

  it("容忍前后有解释文字的 JSON（取第一个数组）", () => {
    const text = `好的，以下是提炼结果：\n${JSON.stringify([
      { headline: "标题甲", summary: "摘要", details: longDetails },
    ])}\n以上。`;
    expect(cardsFromModelText(text)).toHaveLength(1);
  });

  it("丢弃 details 过短的条目，但保留同批里的有效条目", () => {
    const text = JSON.stringify([
      { headline: "太短的", summary: "s", details: "太短了" },
      { headline: "够长的", summary: "s", details: longDetails },
    ]);
    const cards = cardsFromModelText(text);
    expect(cards).toHaveLength(1);
    expect(cards[0].headline).toBe("够长的");
  });

  it("同一标题只保留第一条（去重）", () => {
    const text = JSON.stringify([
      { headline: "同一个标题", summary: "a", details: longDetails },
      { headline: "同一个标题", summary: "b", details: longDetails + "补充" },
    ]);
    expect(cardsFromModelText(text)).toHaveLength(1);
  });

  it("没有数组时报可读错误", () => {
    expect(() => cardsFromModelText("没有任何 JSON 数组")).toThrow("AI 没有返回卡片数组");
    expect(() => cardsFromModelText('{"headline":"不是数组"}')).toThrow("AI 没有返回卡片数组");
  });

  it("缺 category 时落到随手笔记，缺 summary 时用标题兜底", () => {
    const text = JSON.stringify([{ headline: "只有标题和正文", details: longDetails }]);
    const card = cardsFromModelText(text)[0];
    expect(card.category).toBe("随手笔记");
    expect(card.summary).toBe("只有标题和正文");
  });
});
