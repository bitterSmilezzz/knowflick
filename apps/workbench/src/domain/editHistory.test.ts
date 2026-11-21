import { describe, expect, it } from "vitest";
import { canRedo, canUndo, EDIT_MERGE_WINDOW_MS, emptyHistory, recordEdit, redoEdit, undoEdit } from "./editHistory";

const snap = (body: string, title = "标题") => ({ body, title });
const T0 = 1_000_000;

describe("正文撤销/重做栈（B01）", () => {
  it("记一版历史后能撤销回到改动前", () => {
    const h = recordEdit(emptyHistory(T0), snap("原文"), T0 + EDIT_MERGE_WINDOW_MS);
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);
    const out = undoEdit(h, snap("新文"));
    expect(out!.snapshot).toEqual(snap("原文"));
    expect(canRedo(out!.history)).toBe(true);
  });

  it("撤销之后能重做，回到撤销前的样子", () => {
    const h = recordEdit(emptyHistory(T0), snap("原文"), T0 + EDIT_MERGE_WINDOW_MS);
    const undone = undoEdit(h, snap("新文"))!;
    const redone = redoEdit(undone.history, undone.snapshot)!;
    expect(redone.snapshot).toEqual(snap("新文"));
    expect(canRedo(redone.history)).toBe(false);
  });

  it("窗口内的连续输入合成一版：不然 Ctrl+Z 变成「退一个字」", () => {
    let h = emptyHistory(T0);
    h = recordEdit(h, snap("第一版"), T0);
    // 紧接着的两次输入都在窗口内：不再压新版本。
    h = recordEdit(h, snap("第一版b"), T0 + 100);
    h = recordEdit(h, snap("第一版bc"), T0 + 200);
    expect(h.past).toHaveLength(1);
    // 窗口外的输入才压新版本。
    h = recordEdit(h, snap("第二版"), T0 + EDIT_MERGE_WINDOW_MS + 500);
    expect(h.past).toHaveLength(2);
  });

  it("新改动清空重做栈：改了新内容，原来的「重做」就没有意义了", () => {
    const h = recordEdit(emptyHistory(T0), snap("原文"), T0 + EDIT_MERGE_WINDOW_MS);
    const undone = undoEdit(h, snap("新文"))!;
    expect(canRedo(undone.history)).toBe(true);
    const afterNewEdit = recordEdit(undone.history, undone.snapshot, T0 + 5000);
    expect(canRedo(afterNewEdit)).toBe(false);
  });

  it("没有历史时撤销、没有撤销过时重做都返回 null", () => {
    expect(undoEdit(emptyHistory(T0), snap("x"))).toBeNull();
    expect(redoEdit(emptyHistory(T0), snap("x"))).toBeNull();
  });

  it("与上一版完全相同的改动不记：避免 Ctrl+Z 按一下什么都没发生", () => {
    const h = recordEdit(emptyHistory(T0), snap("原文"), T0 + EDIT_MERGE_WINDOW_MS);
    const same = recordEdit(h, snap("原文"), T0 + 9999);
    expect(same.past).toHaveLength(1);
  });

  it("标题也进历史：只改标题的撤销要能把标题退回去", () => {
    const h = recordEdit(emptyHistory(T0), snap("正文", "旧标题"), T0 + EDIT_MERGE_WINDOW_MS);
    const out = undoEdit(h, snap("正文", "新标题"));
    expect(out!.snapshot.title).toBe("旧标题");
  });
});
