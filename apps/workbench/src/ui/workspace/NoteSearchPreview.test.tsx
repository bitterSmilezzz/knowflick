import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NoteSearchPreview } from "./NoteSearchPreview";

describe("NoteSearchPreview", () => {
  it("不搜索时显示正文开头", () => {
    const body = "这是一篇很长的笔记正文，开头应当显示出来。";
    expect(renderToStaticMarkup(<NoteSearchPreview body={body} query="" />)).toContain("这是一篇很长的笔记正文");
  });

  it("搜索命中时高亮命中词，并带上上下文", () => {
    const body = `${'前缀'.repeat(30)}成本核算${'后缀'.repeat(30)}`;
    const html = renderToStaticMarkup(<NoteSearchPreview body={body} query="成本" />);
    // 只高亮查询词本身：命中的「成本」被包起来，后面的「核算」留在正文里
    expect(html).toContain("<mark class=\"nv-snippet-hit\">成本</mark>核算");
    expect(html).toContain("…");
  });

  it("搜索没命中时回落到正文开头（不是空白）", () => {
    const html = renderToStaticMarkup(<NoteSearchPreview body="完全无关的正文" query="找不到" />);
    expect(html).toContain("完全无关的正文");
    expect(html).not.toContain("<mark");
  });

  it("空笔记也显示占位文字", () => {
    expect(renderToStaticMarkup(<NoteSearchPreview body="" query="" />)).toContain("空笔记");
  });
});
