import { describe, expect, it } from "vitest";
import { insertLink, insertTable } from "./markdownBlocks";

describe("表格与链接插入（B01）", () => {
  it("表格：表头 + 分隔行 + 空行，每行列数一致", () => {
    const out = insertTable({ text: "", start: 0, end: 0 }, ["项目", "状态"], 2);
    const lines = out.text.trim().split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe("| 项目 | 状态 |");
    expect(lines[1]).toBe("| --- | --- |");
    // 列数不齐的表格在渲染器里会错位——插入时就必须一致
    expect(lines.slice(2).every((l) => l.split("|").length === lines[0].split("|").length)).toBe(true);
  });

  it("链接：没选文字时用 URL 当文字；URL 里的右括号要转义", () => {
    const out = insertLink({ text: "", start: 0, end: 0 }, "https://example.com/a(b)");
    // 右括号会截断 Markdown 链接，要转义；左括号不用
    expect(out.text).toContain("[https://example.com/a(b)](https://example.com/a(b%29)");
    const withText = insertLink({ text: "", start: 0, end: 0 }, "https://example.com", "看这里");
    expect(withText.text).toContain("[看这里](https://example.com)");
  });

  it("空 URL 不做任何改动", () => {
    const state = { text: "正文", start: 2, end: 2 };
    expect(insertLink(state, "   ")).toEqual(state);
  });

  it("插在正文中间时前后留空行，不粘在行中间", () => {
    const out = insertLink({ text: "前面\n后面", start: 3, end: 3 }, "https://example.com");
    expect(out.text.startsWith("前面\n\n")).toBe(true);
    expect(out.text.endsWith("\n\n后面")).toBe(true);
  });

  it("选中文字时替换掉它（链接文字用选区内容）", () => {
    // 「官网」两字的区间是 2..4（中文按码元计）
    const out = insertLink({ text: "去 官网 看看", start: 2, end: 4 }, "https://example.com");
    expect(out.text).toContain("[官网](https://example.com)");
    expect(out.text).not.toContain("去 官网");
  });
});
