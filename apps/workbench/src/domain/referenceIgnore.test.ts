import { describe, expect, it } from "vitest";
import { auditReferences, removeReferenceFromBody, type ReferenceIssue } from "./referenceAudit";
import { applyNoteReference } from "./noteReference";
import {
  IGNORED_REF_LIMIT,
  addIgnored,
  issueKey,
  pruneIgnored,
  removeIgnored,
  splitIgnored,
} from "./referenceIgnore";

const missing: ReferenceIssue = { noteId: "n1", noteTitle: "甲", targetId: "m1", targetTitle: "素材", status: "missing" };
const changed: ReferenceIssue = { noteId: "n1", noteTitle: "甲", targetId: "m1", targetTitle: "素材", status: "changed" };
const other: ReferenceIssue = { noteId: "n2", noteTitle: "乙", targetId: "m1", targetTitle: "素材", status: "missing" };

describe("引用体检的忽略与撤销（C05）", () => {
  it("同篇同目标的多条引用能分别忽略，正文前面插段落不改变标识", () => {
    const source = { id: "gone", title: "原件", bodyMd: "原文", kind: "note" as const };
    const ref = applyNoteReference("", source, "片段甲");
    const bodyMd = [ref, applyNoteReference("", source, "片段乙"), ref].join("\n\n");
    const note = { id: "n", title: "笔记", bodyMd };
    const issues = auditReferences([note]);
    expect(new Set(issues.map(issueKey)).size).toBe(3);
    expect(splitIgnored(issues, [issueKey(issues[0])]).active).toHaveLength(2);
    const moved = auditReferences([{ ...note, bodyMd: "新增段落\n\n" + bodyMd }]);
    expect(moved.map(issueKey)).toEqual(issues.map(issueKey));
  });
  it("按「引用者 + 被引用方 + 状态」区分：同一对目标，失效与过期不是同一条", () => {
    expect(issueKey(missing)).not.toBe(issueKey(changed));
    expect(issueKey(missing)).not.toBe(issueKey(other));
    const split = splitIgnored([missing, changed, other], [issueKey(missing)]);
    expect(split.active.map(issueKey)).toEqual([issueKey(changed), issueKey(other)]);
    expect(split.ignored).toEqual([missing]);
  });

  it("删除待复核的引用时保留同目标的已忽略引用", () => {
    const source = { id: "gone", title: "原件", bodyMd: "原文", kind: "note" as const };
    const kept = applyNoteReference("", source, "保留的证据");
    const removed = applyNoteReference("", source, "需要删除的片段");
    const body = kept + "\n\n" + removed;
    const issues = auditReferences([{ id: "n", title: "笔记", bodyMd: body }]);
    const split = splitIgnored(issues, [issueKey(issues[0])]);
    const out = removeReferenceFromBody(body, source.id, split.active[0].referenceKey);
    expect(out.removed).toBe(1);
    expect(out.body).toContain(kept);
    expect(out.body).not.toContain(removed);
  });

  it("同一目标再次改动后不沿用上一内容版本的忽略", () => {
    const target = { id: "t", title: "来源", bodyMd: "原文", kind: "note" as const };
    const origin = { id: "n", title: "引用者", bodyMd: applyNoteReference("", target) };
    const first = auditReferences([origin, { ...target, bodyMd: "改动一" }]);
    const next = auditReferences([origin, { ...target, bodyMd: "改动二" }]);
    expect(first[0].status).toBe("changed");
    expect(next[0].status).toBe("changed");
    expect(splitIgnored(next, [issueKey(first[0])]).active).toHaveLength(1);
  });

  it("同一条忽略两次只留一份（否则撤销一次只去掉一份）", () => {
    const once = addIgnored([], issueKey(missing));
    const twice = addIgnored(once, issueKey(missing));
    expect(twice).toEqual(once);
    expect(removeIgnored(twice, issueKey(missing))).toEqual([]);
  });

  it("忽略表有上限，超了丢最早的", () => {
    let list: string[] = [];
    for (let i = 0; i < IGNORED_REF_LIMIT + 5; i++) list = addIgnored(list, `k${i}`);
    expect(list).toHaveLength(IGNORED_REF_LIMIT);
    expect(list[0]).toBe("k5");
    expect(list[list.length - 1]).toBe(`k${IGNORED_REF_LIMIT + 4}`);
  });

  it("修剪掉已经不存在的忽略：不然修好后同一问题再出现会被陈年忽略默默吞掉", () => {
    const ignored = [issueKey(missing), "n9|m9|missing"];
    expect(pruneIgnored(ignored, [missing, changed])).toEqual([issueKey(missing)]);
  });
});
