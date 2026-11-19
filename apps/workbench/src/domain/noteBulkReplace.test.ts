import { describe, expect, it } from "vitest";
import { bulkReplaceTotals, planBulkReplace } from "./noteBulkReplace";

const notes = [
  { id: "a", title: "甲", bodyMd: "知识库要建好，知识库也要能搜" },
  { id: "b", title: "乙", bodyMd: "与主题无关" },
  { id: "c", title: "", bodyMd: "再说知识库" },
  { id: "d", title: "已删", bodyMd: "知识库", isDeleted: true },
];

describe("跨笔记批量替换（B01）", () => {
  it("只返回真的有改动的笔记，并给出篇数与处数", () => {
    const hits = planBulkReplace(notes, "知识库", "库");
    expect(hits.map((h) => h.id)).toEqual(["a", "c"]);
    expect(hits[0].count).toBe(2);
    expect(hits[0].body).toBe("库要建好，库也要能搜");
    expect(hits[1].title).toBe("无标题笔记");
    expect(bulkReplaceTotals(hits)).toEqual({ notes: 2, matches: 3 });
  });

  it("回收站里的笔记不参与替换", () => {
    const hits = planBulkReplace(notes, "知识库", "库");
    expect(hits.some((h) => h.id === "d")).toBe(false);
  });

  it("空查询或没命中都返回空数组（界面据此说「没改动」）", () => {
    expect(planBulkReplace(notes, "  ", "x")).toEqual([]);
    expect(planBulkReplace(notes, "不存在的词", "x")).toEqual([]);
  });

  it("大小写不敏感：搜 Note 能改掉 note", () => {
    const hits = planBulkReplace([{ id: "a", title: "甲", bodyMd: "a note here" }], "Note", "卡片");
    expect(hits[0].body).toBe("a 卡片 here");
  });
});
