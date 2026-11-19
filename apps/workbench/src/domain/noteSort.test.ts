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

describe("按截止日期排序（B10）", () => {
  const withBody = (title: string, bodyMd: string, updatedAt = 1, isPinned = false) => ({
    title,
    bodyMd,
    updatedAt,
    createdAt: updatedAt,
    isPinned,
  });

  it("按最近的未完成截止日升序：越早到期越靠前", () => {
    const notes = [
      withBody("晚", "- [ ] 三 📅 2026-12-01"),
      withBody("早", "- [ ] 一 📅 2026-11-20"),
      withBody("中", "- [ ] 二 📅 2026-11-25"),
    ];
    expect(sortNotes(notes, "due").map((n) => n.title)).toEqual(["早", "中", "晚"]);
  });

  it("一篇里有多个截止日时取**最早的那个未完成**", () => {
    const notes = [
      withBody("多件", "- [ ] 甲 📅 2026-12-10\n- [ ] 乙 📅 2026-11-21"),
      withBody("单件", "- [ ] 丙 📅 2026-11-25"),
    ];
    expect(sortNotes(notes, "due").map((n) => n.title)).toEqual(["多件", "单件"]);
  });

  it("已完成的不算：做完的事不该继续占着排序位置", () => {
    const notes = [
      withBody("做完了", "- [x] 早的 📅 2026-11-01\n- [ ] 晚的 📅 2026-12-05"),
      withBody("没做", "- [ ] 中 📅 2026-11-25"),
    ];
    // 若把已完成的 2026-11-01 算进去，「做完了」会排第一——那是错的。
    expect(sortNotes(notes, "due").map((n) => n.title)).toEqual(["没做", "做完了"]);
  });

  it("没有未完成截止日的排最后，它们内部按最近编辑", () => {
    const notes = [
      withBody("没日期旧", "随便写点", 1),
      withBody("有日期", "- [ ] 甲 📅 2026-11-30", 2),
      withBody("没日期新", "也随便写", 9),
    ];
    expect(sortNotes(notes, "due").map((n) => n.title)).toEqual(["有日期", "没日期新", "没日期旧"]);
  });

  it("置顶仍然最前，不被截止日期推翻", () => {
    const notes = [
      withBody("早", "- [ ] 甲 📅 2026-11-20", 1),
      withBody("置顶的", "- [ ] 乙 📅 2026-12-31", 1, true),
    ];
    expect(sortNotes(notes, "due").map((n) => n.title)).toEqual(["置顶的", "早"]);
  });

  it("标题重复时也不串位（身份不是数组下标）", () => {
    const notes = [
      withBody("同名", "- [ ] 甲 📅 2026-12-01", 1),
      withBody("同名", "- [ ] 乙 📅 2026-11-20", 2),
    ];
    const sorted = sortNotes(notes, "due");
    expect(sorted.map((n) => n.updatedAt)).toEqual([2, 1]);
  });
});
