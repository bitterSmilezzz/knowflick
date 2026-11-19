import { describe, expect, it } from "vitest";
import { bulkUndoTotals, planBulkUndo } from "./noteBulkUndo";

describe("批量替换的一键撤销（B01）", () => {
  it("把每篇写回替换前的正文", () => {
    const notes = [{ id: "a", bodyMd: "库要建好" }];
    const plans = planBulkUndo(notes, [{ id: "a", previousBody: "知识库要建好" }]);
    expect(plans).toEqual([{ id: "a", body: "知识库要建好" }]);
  });

  it("替换后自己改回来的（已与快照一致）不进计划——不再多写一条修订", () => {
    const notes = [{ id: "a", bodyMd: "知识库要建好" }];
    expect(planBulkUndo(notes, [{ id: "a", previousBody: "知识库要建好" }])).toEqual([]);
  });

  it("替换后被删掉的笔记不进计划——撤销不该把回收站里的笔记拉回列表", () => {
    const notes = [{ id: "a", bodyMd: "库", isDeleted: true }];
    expect(planBulkUndo(notes, [{ id: "a", previousBody: "知识库" }])).toEqual([]);
    // 笔记整个不存在（别处删了）也一样跳过
    expect(planBulkUndo([], [{ id: "b", previousBody: "x" }])).toEqual([]);
  });

  it("摘要说清能撤几篇、跳过几篇", () => {
    const entries = [
      { id: "a", previousBody: "旧" },
      { id: "b", previousBody: "旧" },
    ];
    const plans = planBulkUndo([{ id: "a", bodyMd: "新" }, { id: "b", bodyMd: "旧" }], entries);
    expect(bulkUndoTotals(entries, plans)).toEqual({ undoable: 1, skipped: 1 });
  });
});
