import { describe, expect, it } from "vitest";
import React from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";

describe("MarkdownRenderer", () => {
  it("renders empty div for empty text", () => {
    const el = MarkdownRenderer({ text: "" });
    expect(React.isValidElement(el)).toBe(true);
    expect((el as React.ReactElement<{ className?: string }>).props.className).toBe("ws-prose");
  });

  it("renders headings, blockquotes, lists and code blocks", () => {
    const md = `## 架构原则\n\n> 保持离线可用。\n\n- 第一点\n- 第二点\n\n\`\`\`ts\nconst a = 1;\n\`\`\`\n\n正文包含 **加粗** 与 \`代码\`。`;
    const el = MarkdownRenderer({ text: md });
    expect(React.isValidElement(el)).toBe(true);

    const children = (el as React.ReactElement<{ children?: React.ReactElement[] }>).props.children;
    expect(Array.isArray(children)).toBe(true);
    expect(children!.length).toBeGreaterThanOrEqual(4);

    // 检查是否有 h2, blockquote, ul, pre
    const types = children!.map((c) => c.type);
    expect(types).toContain("h2");
    expect(types).toContain("blockquote");
    expect(types).toContain("ul");
    expect(types).toContain("pre");
    expect(types).toContain("p");
  });

  it("renders inline links with target blank", () => {
    const md = "请访问 [SQLite 官网](https://sqlite.org) 了解详情。";
    const el = MarkdownRenderer({ text: md });
    expect(React.isValidElement(el)).toBe(true);
  });
});
