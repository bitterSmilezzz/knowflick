import { describe, expect, it } from "vitest";
import { snippetFor } from "./noteSearchSnippet";

describe("搜索结果片段（R1）", () => {
  it("切出命中词与前后上下文，命中词保留原文大小写", () => {
    const body = "开头一段废话。\n\n这里有 ABC 成本核算的说明，后面还有别的。";
    const s = snippetFor(body, "abc", 10);
    expect(s).not.toBeNull();
    expect(s!.match).toBe("ABC");
    expect(s!.before.endsWith("这里有 ")).toBe(true);
    expect(s!.after.startsWith(" 成本核算")).toBe(true);
  });

  it("截断时加省略号；命中在开头则前面不加", () => {
    const body = `${'长'.repeat(200)}命中${'长'.repeat(200)}`;
    const s = snippetFor(body, "命中", 5)!;
    expect(s.before).toBe("…长长长长长");
    expect(s.after.endsWith("…")).toBe(true);
    const atStart = snippetFor("命中在最前面", "命中", 5)!;
    expect(atStart.before).toBe("");
  });

  it("没有命中或查询为空时返回 null", () => {
    expect(snippetFor("正文", "找不到", 10)).toBeNull();
    expect(snippetFor("正文", "   ", 10)).toBeNull();
  });

  it("把换行压成空格：片段是给人看的一行", () => {
    const s = snippetFor("第一行\n第二行命中处\n第三行", "命中", 20)!;
    expect(s.before.includes("\n")).toBe(false);
    expect(s.before).toContain("第二行");
  });
});
