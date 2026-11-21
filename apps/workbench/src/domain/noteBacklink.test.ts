import { describe, expect, it } from "vitest";
import { findBacklinks } from "./noteBacklink";
import { applyNoteReference } from "./noteReference";

const source = { id: "target", title: "被引用的那篇", bodyMd: "这是被引用的正文。", kind: "note" as const };

function noteWithReference(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title,
    bodyMd: applyNoteReference("开头一段。\n", source, "只引用最后一句结论"),
    ...extra,
  };
}

describe("反向链接（B04）", () => {
  it("找出引用当前笔记的笔记，并给出引用处附近的片段", () => {
    const notes = [
      { id: "target", title: "被引用的那篇", bodyMd: "自己的正文" },
      noteWithReference("a", "甲"),
      { id: "b", title: "乙", bodyMd: "只是提到了 target 这个词，没有链接" },
    ];
    const backlinks = findBacklinks(notes, "target");
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].noteId).toBe("a");
    expect(backlinks[0].title).toBe("甲");
    expect(backlinks[0].snippet).toContain("只引用最后一句结论");
    expect(backlinks[0].archived).toBe(false);
  });

  it("自己引用自己不算反向链接；回收站的引用不算，归档的算", () => {
    const selfRef = { id: "target", title: "自引用", bodyMd: applyNoteReference("", source, "片段") };
    const trashed = noteWithReference("deleted", "已删", { isDeleted: true });
    const archived = noteWithReference("archived", "已归档", { archivedAt: 1 });
    const backlinks = findBacklinks([selfRef, trashed, archived], "target");
    expect(backlinks.map((b) => b.noteId)).toEqual(["archived"]);
    expect(backlinks[0].archived).toBe(true);
  });

  it("按标题排序，结果稳定", () => {
    const notes = [
      noteWithReference("c", "丙"),
      noteWithReference("a", "甲"),
      noteWithReference("b", "乙"),
    ];
    // zh-CN 排序是拼音序：丙 bǐng < 甲 jiǎ < 乙 yǐ
    expect(findBacklinks(notes, "target").map((b) => b.title)).toEqual(["丙", "甲", "乙"]);
  });
});
