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

  // 下面几条针对**真实模型的实际输出习惯**。系统提示要求「仅输出 JSON 数组」，
  // 但真实模型常带解释、引用编号、markdown 围栏——用贪婪匹配取第一个 `[`
  // 到最后一个 `]` 会截错，用户收到「没有返回卡片数组」而模型其实给了卡。
  it("正文带引用编号 [1] 时，仍要取到后面的卡片数组", () => {
    const text = `根据 [1] 的研究，以下是提炼结果：\n${JSON.stringify([{ headline: "带引用", details: longDetails }])}`;
    const cards = cardsFromModelText(text);
    expect(cards).toHaveLength(1);
    expect(cards[0].headline).toBe("带引用");
  });

  it("正文带 [图1] 与 [2] 这类混合引用时也能取到", () => {
    const text = `参考 [图1] 与 [2] 的结论\n${JSON.stringify([{ headline: "混合引用", details: longDetails }])}`;
    expect(cardsFromModelText(text)).toHaveLength(1);
  });

  it("markdown 围栏包裹时能取到", () => {
    const text = "```json\n" + JSON.stringify([{ headline: "围栏", details: longDetails }]) + "\n```";
    expect(cardsFromModelText(text)).toHaveLength(1);
  });

  it("卡片内的嵌套数组（searchKeywords）不会被误当成卡片数组", () => {
    // 「从后往前取第一个能解析的数组」会命中内层的 ["复购","留存"]，
    // 那样解出来的是字符串数组，一张卡都认不出来。
    const text = JSON.stringify([{ headline: "带嵌套", details: longDetails, searchKeywords: ["复购", "留存"] }]);
    const cards = cardsFromModelText(text);
    expect(cards).toHaveLength(1);
    expect(cards[0].headline).toBe("带嵌套");
  });

  it("空数组与「没有数组」要给不同的提示", () => {
    // 空数组是「模型给了数组但没有可用的卡」，不是「模型没给数组」——
    // 两者的用户下一步动作不一样。
    expect(() => cardsFromModelText("[]")).toThrow("没有可用的新卡片");
    expect(() => cardsFromModelText("没有任何 JSON")).toThrow("AI 没有返回卡片数组");
  });
});
