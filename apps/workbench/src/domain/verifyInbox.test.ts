import { describe, expect, it } from "vitest";
import { collectVerifyItems, verifyTotals } from "./verifyInbox";

describe("全库待验证汇总（C05）", () => {
  it("跨笔记收集，按标题拼音序 + 行号排序", () => {
    const notes = [
      { id: "b", title: "乙笔记", bodyMd: "乙一 ❓\n乙二 ❓" },
      { id: "a", title: "甲笔记", bodyMd: "甲一 ❓" },
    ];
    const items = collectVerifyItems(notes);
    expect(items.map((i) => i.noteTitle)).toEqual(["甲笔记", "乙笔记", "乙笔记"]);
    expect(items.map((i) => i.text)).toEqual(["甲一", "乙一", "乙二"]);
    expect(items[2].line).toBe(1);
  });

  it("回收站里的笔记不算；归档的照算", () => {
    const notes = [
      { id: "t", title: "已删", bodyMd: "删掉的 ❓", isDeleted: true },
      { id: "k", title: "还在", bodyMd: "还在的 ❓" },
    ];
    expect(collectVerifyItems(notes).map((i) => i.noteId)).toEqual(["k"]);
  });

  it("汇总给出条数与涉及篇数", () => {
    const items = collectVerifyItems([
      { id: "a", title: "甲", bodyMd: "一 ❓\n二 ❓" },
      { id: "b", title: "乙", bodyMd: "三 ❓" },
    ]);
    expect(verifyTotals(items)).toEqual({ items: 3, notes: 2 });
    expect(verifyTotals([])).toEqual({ items: 0, notes: 0 });
  });

  it("没有标题的笔记写「无标题笔记」，不显示空白", () => {
    expect(collectVerifyItems([{ id: "a", title: "", bodyMd: "断言 ❓" }])[0].noteTitle).toBe("无标题笔记");
  });
});
