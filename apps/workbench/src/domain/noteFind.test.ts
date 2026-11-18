import { describe, expect, it } from "vitest";
import { countNoteText, findMatches, replaceAllMatches } from "./noteFind";

describe("笔记正文查找与字数（B01）", () => {
  it("字数按非空白字符算，段落按空行分块", () => {
    expect(countNoteText("")).toEqual({ chars: 0, paragraphs: 0 });
    // 中文没有词边界：按字符数才对得上直觉，空格与换行不算字。
    expect(countNoteText("北极星计划 备忘\n第二行")).toEqual({ chars: 10, paragraphs: 1 });
    expect(countNoteText("第一段\n\n第二段\n\n\n")).toEqual({ chars: 6, paragraphs: 2 });
    // 只有空行/空白不算段落
    expect(countNoteText("   \n\n  ")).toEqual({ chars: 0, paragraphs: 0 });
  });

  it("查找大小写不敏感，空查询不匹配任何位置", () => {
    expect(findMatches("Note note NOTE", "note")).toEqual([0, 5, 10]);
    expect(findMatches("北极星计划", "北极星")).toEqual([0]);
    expect(findMatches("北极星计划", "火星")).toEqual([]);
    expect(findMatches("任意文本", "")).toEqual([]);
    // 不重叠：aaa 里找 aa 只有一处（从 2 开始就到结尾了）
    expect(findMatches("aaa", "aa")).toEqual([0]);
  });

  it("全部替换返回新文本与次数；0 次时原文不动", () => {
    expect(replaceAllMatches("北极星计划与北极星项目", "北极星", "启明")).toEqual({
      text: "启明计划与启明项目",
      count: 2,
    });
    const unchanged = replaceAllMatches("没有命中的正文", "火星", "启明");
    expect(unchanged.count).toBe(0);
    expect(unchanged.text).toBe("没有命中的正文");
    // 替换文本里含原查询词也不会无限增长：只替换原有的命中位置。
    expect(replaceAllMatches("a-a", "a", "a-b")).toEqual({ text: "a-b-a-b", count: 2 });
  });
});
