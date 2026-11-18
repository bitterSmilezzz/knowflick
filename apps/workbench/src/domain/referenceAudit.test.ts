import { describe, expect, it } from "vitest";
import { auditReferences } from "./referenceAudit";
import { applyNoteReference, type ReferenceSource } from "./noteReference";

const target: ReferenceSource = { id: "t1", title: "被引用的", bodyMd: "原始正文", kind: "note" };

function note(id: string, title: string, bodyMd: string, extra: Record<string, unknown> = {}) {
  return { id, title, bodyMd, ...extra };
}

describe("引用体检（C05）", () => {
  it("引用指向不存在的笔记 → 失效；被引用正文改过 → 过期；没改过 → 不进清单", () => {
    const stable = { ...target, id: "t2", title: "没改过的", bodyMd: "稳定正文" };
    const notes = [
      note("t1", "被引用的", "原始正文"),
      note("t2", "没改过的", "稳定正文"),
      note("ok", "引用正常", applyNoteReference("正文", stable, "片段")),
      note("changed", "引用过期", applyNoteReference("正文", target, "片段")),
      note("missing", "引用失效", applyNoteReference("", { ...target, id: "gone", title: "已删的" }, "片段")),
    ];
    // 把 t1 的内容改掉：引用它的那条变成过期，引用 t2 的那条仍然合规。
    notes[0].bodyMd = "改过的正文";
    const issues = auditReferences(notes);
    expect(issues.map((i) => i.status).sort()).toEqual(["changed", "missing"]);
    const changed = issues.find((i) => i.status === "changed")!;
    expect(changed.noteId).toBe("changed");
    expect(changed.targetTitle).toBe("被引用的");
    const missing = issues.find((i) => i.status === "missing")!;
    expect(missing.targetTitle).toBe("已删的");
  });

  it("回收站里的笔记不作为引用者，但仍可作为被引用方", () => {
    const refToTrash = applyNoteReference("", { ...target, id: "trash", title: "已删笔记" }, "片段");
    const notes = [
      note("trash", "已删笔记", "正文", { isDeleted: true }),
      note("keeper", "还在的", refToTrash),
      note("deleted-src", "被删的引用者", applyNoteReference("", target, "片段"), { isDeleted: true }),
    ];
    const issues = auditReferences(notes);
    // 只有「还在的 → 已删笔记」这一条：被删的引用者不扫。
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ noteId: "keeper", targetId: "trash", status: "missing" });
  });

  it("素材也能是被引用方；结果按引用者标题拼音序稳定排序", () => {
    const material = { id: "m1", title: "素材甲", rawText: "素材正文" };
    const refMaterial = applyNoteReference("", { ...material, bodyMd: material.rawText, kind: "material" }, "片段");
    const notes = [
      note("b", "乙笔记", applyNoteReference("", { ...target, id: "gone-b", title: "没了B" }, "f")),
      note("a", "甲笔记", applyNoteReference("", { ...target, id: "gone-a", title: "没了A" }, "f")),
      note("m", "素材引用", refMaterial),
    ];
    const issues = auditReferences(notes, [material]);
    // 素材被引用且素材还在 → 合规，不报；两条失效按引用者标题拼音序：甲 jiǎ < 乙 yǐ
    expect(issues.map((i) => i.noteTitle)).toEqual(["甲笔记", "乙笔记"]);
  });
});
