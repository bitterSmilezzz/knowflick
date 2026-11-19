import { describe, expect, it } from "vitest";
import { addTagsToNotes, createNoteDraft, emptyNotesState, parseTagInput, removeTagsFromNotes, upsertNote } from "./note";

const NOW = new Date(2026, 10, 19, 9, 0, 0).getTime();

function seed() {
  let state = emptyNotesState();
  // id 必须显式指定：`createNoteDraft` 自己生成 UUID，测试里按固定 id 断言才稳。
  const a = { ...createNoteDraft(NOW), id: "n1", title: "甲", tags: ["工作"] };
  const b = { ...createNoteDraft(NOW), id: "n2", title: "乙", tags: [] };
  state = upsertNote(state, a, 0, NOW).state;
  state = upsertNote(state, b, 0, NOW + 1).state;
  return state;
}

describe("批量去标签（B03）", () => {
  it("完全相等才删：「工作」不该带走「工作流」", () => {
    const state = seed();
    // 给甲加一个包含关系的标签，验证不会被误删。
    const withLonger = addTagsToNotes(state, ["n1"], "工作流", NOW + 5).state;
    const out = removeTagsFromNotes(withLonger, ["n1"], "工作", NOW + 10);
    expect(out.state.notes.find((n) => n.id === "n1")!.tags).toEqual(["工作流"]);
  });

  it("删到空标签列表也算改动", () => {
    const state = seed();
    const out = removeTagsFromNotes(state, ["n1"], "工作", NOW + 10);
    expect(out.changed.slice().sort()).toEqual(["n1"]);
    expect(out.state.notes.find((n) => n.id === "n1")!.tags).toEqual([]);
  });

  it("没有这个标签的笔记不算改动，也不改 updatedAt", () => {
    const state = seed();
    const out = removeTagsFromNotes(state, ["n1", "n2"], "工作", NOW + 10);
    // 甲有「工作」→ 改了；乙没有 → 原样
    expect(out.changed).toEqual(["n1"]);
    expect(out.state.notes.find((n) => n.id === "n2")!.updatedAt).toBe(state.notes.find((n) => n.id === "n2")!.updatedAt);
  });

  it("全都没有这个标签时整批不动：不白写", () => {
    const state = seed();
    const out = removeTagsFromNotes(state, ["n2"], "工作", NOW + 10);
    expect(out.changed).toEqual([]);
    expect(out.state).toEqual(state);
  });

  it("找不到的 id 收进 missing；空输入什么都不做", () => {
    const state = seed();
    const out = removeTagsFromNotes(state, ["n1", "不存在"], "工作", NOW + 10);
    expect(out.missing).toEqual(["不存在"]);
    const empty = removeTagsFromNotes(state, ["n1"], "  ", NOW + 10);
    expect(empty.changed).toEqual([]);
    expect(empty.state).toEqual(state);
  });
});

describe("批量加标签（B03）", () => {
  it("输入规范化：逗号与空白分隔、去掉开头 #、去空、去重", () => {
    expect(parseTagInput("工作, 灵感 ，#复盘")).toEqual(["工作", "灵感", "复盘"]);
    expect(parseTagInput("#工作 工作  ,,")).toEqual(["工作"]);
    expect(parseTagInput("   ")).toEqual([]);
    expect(parseTagInput("#")).toEqual([]);
  });

  it("加标签是元数据变化：不动正文，只追加没有的那个", () => {
    const state = seed();
    const out = addTagsToNotes(state, ["n1", "n2"], "灵感, 工作", NOW + 10);
    // `upsertNote` 把新建的笔记**插到列表最前**，所以遍历顺序是 [n2, n1]；
    // 这里只关心「哪几篇真的打了标签」，不把列表顺序当成契约。
    expect(out.tagged.slice().sort()).toEqual(["n1", "n2"]);
    const a = out.state.notes.find((n) => n.id === "n1")!;
    expect(a.tags).toEqual(["工作", "灵感"]);
    expect(a.bodyMd).toBe(state.notes.find((n) => n.id === "n1")!.bodyMd);
  });

  it("已经有这个标签的笔记不算「打了标签」，也不改 updatedAt", () => {
    const state = seed();
    const out = addTagsToNotes(state, ["n1", "n2"], "工作", NOW + 10);
    // 甲本来就有「工作」→ 没有新增；乙是空的 → 加上
    expect(out.tagged).toEqual(["n2"]);
    expect(out.state.notes.find((n) => n.id === "n1")!.updatedAt).toBe(state.notes.find((n) => n.id === "n1")!.updatedAt);
  });

  it("全是已有标签时整批不动：不白写一条修订", () => {
    const state = seed();
    const out = addTagsToNotes(state, ["n1"], "工作", NOW + 10);
    expect(out.tagged).toEqual([]);
    expect(out.state).toEqual(state);
  });

  it("找不到的 id 收进 missing，界面才能说清有几篇没动", () => {
    const state = seed();
    const out = addTagsToNotes(state, ["n1", "不存在"], "灵感", NOW + 10);
    expect(out.tagged).toEqual(["n1"]);
    expect(out.missing).toEqual(["不存在"]);
  });

  it("空标签输入什么都不做", () => {
    const state = seed();
    const out = addTagsToNotes(state, ["n1", "n2"], "   ", NOW + 10);
    expect(out.tagged).toEqual([]);
    expect(out.state).toEqual(state);
  });

  it("只动被选中的笔记，没选的原样", () => {
    const state = seed();
    const out = addTagsToNotes(state, ["n2"], "复盘", NOW + 10);
    expect(out.state.notes.find((n) => n.id === "n1")!.tags).toEqual(["工作"]);
    expect(out.state.notes.find((n) => n.id === "n2")!.tags).toEqual(["复盘"]);
  });
});
