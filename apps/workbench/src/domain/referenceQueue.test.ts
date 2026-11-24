import { describe, expect, it } from "vitest";
import type { ReferenceIssue } from "./referenceAudit";
import { AUDIT_PAGE_SIZE, auditCounts, auditPage, filterIssues, paginateIssues } from "./referenceQueue";

function issue(n: number, status: "missing" | "changed"): ReferenceIssue {
  return { noteId: `n${n}`, noteTitle: `笔记${n}`, targetId: `t${n}`, targetTitle: `原件${n}`, status };
}

const many: ReferenceIssue[] = Array.from({ length: 20 }, (_, i) => issue(i, i % 2 === 0 ? "missing" : "changed"));

describe("引用体检的筛选与分页（C05）", () => {
  it("按状态筛选，并给出三类计数", () => {
    const counts = auditCounts(many);
    expect(counts).toEqual({ all: 20, missing: 10, changed: 10 });
    expect(filterIssues(many, "all")).toHaveLength(20);
    expect(filterIssues(many, "missing").every((i) => i.status === "missing")).toBe(true);
    expect(filterIssues(many, "changed")).toHaveLength(10);
  });

  it("筛选返回新数组：调用方改结果不会污染原清单", () => {
    const copy = filterIssues(many, "all");
    copy.pop();
    expect(many).toHaveLength(20);
  });

  it("分页给出当前页条目与前后页可用性", () => {
    const first = paginateIssues(many, 1);
    expect(first.items).toHaveLength(AUDIT_PAGE_SIZE);
    expect(first.pageCount).toBe(3);
    expect(first.hasPrev).toBe(false);
    expect(first.hasNext).toBe(true);
    const last = paginateIssues(many, 3);
    expect(last.items).toHaveLength(4);
    expect(last.hasNext).toBe(false);
    expect(last.hasPrev).toBe(true);
  });

  it("页码越界时夹到最后一页，而不是显示空白", () => {
    const p = paginateIssues(many, 99);
    expect(p.page).toBe(3);
    expect(p.items).toHaveLength(4);
    expect(paginateIssues(many, 0).page).toBe(1);
    expect(paginateIssues(many, -5).page).toBe(1);
  });

  it("空清单也是第 1 页、共 1 页，界面不会出现「第 0 页」", () => {
    const empty = paginateIssues([], 1);
    expect(empty).toMatchObject({ total: 0, page: 1, pageCount: 1, hasPrev: false, hasNext: false });
    expect(empty.items).toEqual([]);
  });

  it("换筛选后页码回到第 1 页：否则切到小分类会看到空白", () => {
    const page = auditPage(many, "changed", 3);
    expect(page.total).toBe(10);
    expect(page.pageCount).toBe(2);
    // 第 3 页在「过期」分类里越界 → 夹到第 2 页，仍有内容
    expect(page.page).toBe(2);
    expect(page.items).toHaveLength(2);
    expect(auditPage(many, "changed", 1).items[0].status).toBe("changed");
  });

  it("页大小非正数时按 1 条处理，不会死循环或除零", () => {
    const p = paginateIssues(many, 1, 0);
    expect(p.pageCount).toBe(20);
    expect(p.items).toHaveLength(1);
  });
});
