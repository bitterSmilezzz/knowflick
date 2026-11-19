import { describe, expect, it } from "vitest";
import { addIgnoredDue, dueIgnoreKey, pruneIgnoredDue, removeIgnoredDue, splitIgnoredDue, IGNORED_DUE_LIMIT } from "./dueIgnore";

const a = { noteId: "n1", due: "2026-11-20", text: "交周报" };
const b = { noteId: "n2", due: "2026-11-21", text: "回邮件" };

describe("到期待办的忽略（B10）", () => {
  it("身份用 noteId + 日期 + 文字，不用行号（行号会因上面插入一行而漂移）", () => {
    expect(dueIgnoreKey(a)).toBe(JSON.stringify(["n1", "2026-11-20", "交周报"]));
    // 同一个任务在不同行号下应该是同一个 key——这里由「不含行号」直接保证。
    expect(dueIgnoreKey({ ...a })).toBe(dueIgnoreKey(a));
  });

  it("改期或改文字就是另一个任务：忽略自动失效，重新出现", () => {
    const key = dueIgnoreKey(a);
    expect(dueIgnoreKey({ ...a, due: "2026-11-27" })).not.toBe(key);
    expect(dueIgnoreKey({ ...a, text: "交周报（改）" })).not.toBe(key);
  });

  it("拆成「还在的」与「已忽略的」，顺序不变", () => {
    const ignored = [dueIgnoreKey(a)];
    const out = splitIgnoredDue([a, b], ignored);
    expect(out.active).toEqual([b]);
    expect(out.ignored).toEqual([a]);
  });

  it("加与撤销：重复加不产生两条", () => {
    const once = addIgnoredDue([], a);
    expect(once).toHaveLength(1);
    expect(addIgnoredDue(once, a)).toHaveLength(1);
    expect(removeIgnoredDue(once, a)).toEqual([]);
  });

  it("数量有上限，不会无限增长", () => {
    let ignored: string[] = [];
    for (let i = 0; i < IGNORED_DUE_LIMIT + 5; i += 1) {
      ignored = addIgnoredDue(ignored, { noteId: `n${i}`, due: "2026-11-20", text: "t" });
    }
    expect(ignored).toHaveLength(IGNORED_DUE_LIMIT);
  });

  it("剪枝：待办被完成/删掉之后，它的忽略记录不再留着", () => {
    const ignored = [dueIgnoreKey(a), dueIgnoreKey(b)];
    expect(pruneIgnoredDue(ignored, [b])).toEqual([dueIgnoreKey(b)]);
    expect(pruneIgnoredDue(ignored, [])).toEqual([]);
  });
});
