import { describe, expect, it } from "vitest";
import { highlightText, extractSnippet } from "./HighlightText";
import React from "react";

describe("HighlightText", () => {
  it("returns raw text when query is empty", () => {
    expect(highlightText("这是原始文本", "")).toBe("这是原始文本");
    expect(highlightText("这是原始文本", "   ")).toBe("这是原始文本");
  });

  it("splits text and highlights matching tokens with mark tags", () => {
    const res = highlightText("第二大脑与向量检索", "大脑 检索");
    expect(Array.isArray(res)).toBe(true);
    const nodes = res as React.ReactElement[];
    expect(
      nodes.some(
        (n) => React.isValidElement(n) && (n.props as { children?: string }).children === "大脑"
      )
    ).toBe(true);
    expect(
      nodes.some(
        (n) => React.isValidElement(n) && (n.props as { children?: string }).children === "检索"
      )
    ).toBe(true);
  });

  it("extracts contextual snippet centered on query match", () => {
    const longText =
      "前言背景内容非常长非常长非常长非常长非常长非常长非常长。关键命中的知识点：第二大脑核心架构设计。后续延伸内容同样非常长非常长非常长。";
    const snippet = extractSnippet(longText, "核心架构", 30);
    expect(snippet).toContain("核心架构");
    expect(snippet.length).toBeLessThanOrEqual(35);
  });
});
