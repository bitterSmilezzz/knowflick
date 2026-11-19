import { describe, expect, it } from "vitest";
import { bulkRedoTotals, bulkUndoTotals, planBulkRedo, planBulkUndo } from "./noteBulkUndo";

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

describe("批量替换的重做（B01）", () => {
  // 一次替换：原文「知识库」→「库」；撤销后回到「知识库」，重做再回到「库」。
  const entry = { id: "a", undoBody: "库", restoredBody: "知识库" };

  it("还停在撤销结果上：重做写回替换后的正文", () => {
    const plans = planBulkRedo([{ id: "a", bodyMd: "知识库" }], [entry]);
    expect(plans).toEqual([{ id: "a", body: "库" }]);
  });

  it("撤销之后又改过这篇：**不重做**，否则会把用户刚写的东西冲掉", () => {
    const plans = planBulkRedo([{ id: "a", bodyMd: "知识库（我刚补了一句）" }], [entry]);
    expect(plans).toEqual([]);
  });

  it("已经在替换后状态：不重复写，避免多一条无意义修订", () => {
    expect(planBulkRedo([{ id: "a", bodyMd: "库" }], [entry])).toEqual([]);
  });

  it("撤销后被删掉的不重做——不该把回收站里的笔记拉回列表", () => {
    expect(planBulkRedo([{ id: "a", bodyMd: "知识库", isDeleted: true }], [entry])).toEqual([]);
    expect(planBulkRedo([], [entry])).toEqual([]);
  });

  it("摘要说清能重做几篇、跳过几篇", () => {
    const entries = [entry, { id: "b", undoBody: "新", restoredBody: "旧" }];
    const plans = planBulkRedo(
      [{ id: "a", bodyMd: "知识库" }, { id: "b", bodyMd: "用户又改了" }],
      entries,
    );
    expect(bulkRedoTotals(entries, plans)).toEqual({ redoable: 1, skipped: 1 });
  });
});
