import { describe, expect, it } from "vitest";
import { sortNotes } from "./noteSort";

function note(title: string, updatedAt: number, createdAt = updatedAt, isPinned = false) {
  return { title, updatedAt, createdAt, isPinned };
}

describe("笔记排序（B03）", () => {
  const notes = [note("乙", 3, 1), note("甲", 2, 3), note("丙", 1, 2)];

  it("最近编辑：按更新时间倒序", () => {
    expect(sortNotes(notes, "recent").map((n) => n.title)).toEqual(["乙", "甲", "丙"]);
  });

  it("创建时间：按创建时间倒序，不看编辑时间", () => {
    expect(sortNotes(notes, "created").map((n) => n.title)).toEqual(["甲", "丙", "乙"]);
  });

  it("标题：按拼音序，且置顶的永远在最前", () => {
    expect(sortNotes(notes, "title").map((n) => n.title)).toEqual(["丙", "甲", "乙"]);
    const withPinned = [...notes, note("丁", 0, 0, true)];
    expect(sortNotes(withPinned, "title").map((n) => n.title)).toEqual(["丁", "丙", "甲", "乙"]);
    expect(sortNotes(withPinned, "recent").map((n) => n.title)).toEqual(["丁", "乙", "甲", "丙"]);
  });

  it("不改动传入的数组", () => {
    const input = [note("乙", 1), note("甲", 2)];
    sortNotes(input, "title");
    expect(input.map((n) => n.title)).toEqual(["乙", "甲"]);
  });
});
