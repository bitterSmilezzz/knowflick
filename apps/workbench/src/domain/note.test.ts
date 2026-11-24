import { describe, expect, it } from "vitest";
import {
  addNoteToKb,
  archivedNotes,
  createKnowledgeBase,
  createNoteDraft,
  deleteNote,
  duplicateNoteDraft,
  emptyNotesState,
  listNotes,
  moveNotesToNotebook,
  NoteConflictError,
  noteFromJson,
  noteToMarkdown,
  restoreNote,
  restoreNoteRaw,
  searchNotes,
  upsertNote,
  type Note,
} from "./note";

/** 与 Rust notes.rs 的测试同语义——同一契约两份实现，两边都要钉住。 */
describe("笔记领域语义（与 Rust notes.rs 对齐）", () => {
  it("新建即修订 1；内容变化追加修订，元数据变化不追加", () => {
    let state = emptyNotesState();
    const draft = createNoteDraft(1000);
    draft.title = "第一篇";
    draft.bodyMd = "正文：记忆与知识";

    const r1 = upsertNote(state, draft, 0, 1000);
    expect(r1.outcome).toEqual({ id: draft.id, revision: 1, created: true });
    state = r1.state;

    const v2 = { ...state.notes[0], bodyMd: "正文：记忆、知识与检索" };
    const r2 = upsertNote(state, v2, 1, 2000);
    expect(r2.outcome.revision).toBe(2);
    state = r2.state;

    // 只改元数据（收藏/置顶）不追加修订
    const v3 = { ...state.notes[0], isFavorite: true, isPinned: true };
    const r3 = upsertNote(state, v3, 2, 3000);
    expect(r3.outcome.revision).toBe(2);
    state = r3.state;
    expect(state.notes[0].createdAt).toBe(1000);
    expect(state.notes[0].updatedAt).toBe(3000);
  });

  it("旧草稿不能覆盖新内容：修订冲突抛错并携带当前修订号", () => {
    let state = emptyNotesState();
    const draft = createNoteDraft();
    draft.bodyMd = "v1";
    state = upsertNote(state, draft, 0, 1000).state;
    state = upsertNote(state, { ...state.notes[0], bodyMd: "v2" }, 1, 2000).state;

    // 另一窗口拿着修订 1 保存旧草稿
    const stale = { ...state.notes[0], bodyMd: "旧草稿" };
    expect(() => upsertNote(state, stale, 1, 3000)).toThrowError(NoteConflictError);
    try {
      upsertNote(state, stale, 1, 3000);
    } catch (e) {
      expect((e as NoteConflictError).currentRevision).toBe(2);
    }
    expect(state.notes[0].bodyMd).toBe("v2");

    // 不存在的笔记配 baseRevision != 0 也拒绝（不静默重建）
    expect(() => upsertNote(state, { ...createNoteDraft(), id: "ghost" }, 3, 3000)).toThrowError(NoteConflictError);
  });

  it("回收站：删除后搜不到，恢复后回到检索，修订不重置", () => {
    let state = emptyNotesState();
    const draft = createNoteDraft();
    draft.title = "会议记录";
    draft.bodyMd = "关于北极项目的结论";
    state = upsertNote(state, draft, 0, 1000).state;

    expect(searchNotes(state, "北极项目")).toHaveLength(1);
    state = deleteNote(state, draft.id, 2000);
    expect(searchNotes(state, "北极项目")).toHaveLength(0);
    state = restoreNote(state, draft.id);
    expect(searchNotes(state, "北极项目")).toHaveLength(1);
    expect(state.notes[0].currentRevision).toBe(1);
  });

  it("知识库：幂等加入、库内检索不串库、多库共存", () => {
    let state = emptyNotesState();
    const a = createNoteDraft(); a.title = "工作"; a.bodyMd = "项目 A 的结论";
    const b = createNoteDraft(); b.title = "生活"; b.bodyMd = "项目 B 的菜谱";
    state = upsertNote(state, a, 0, 1000).state;
    state = upsertNote(state, b, 0, 1100).state;
    state = createKnowledgeBase(state, { id: "kb1", name: "项目 A", description: "" }, 1200);

    state = addNoteToKb(state, "kb1", a.id, 1300);
    state = addNoteToKb(state, "kb1", a.id, 1400); // 幂等
    expect(Object.keys(state.membership)).toHaveLength(1);

    expect(searchNotes(state, "项目")).toHaveLength(2);
    const scoped = searchNotes(state, "项目", "kb1");
    expect(scoped).toHaveLength(1);
    expect(scoped[0].id).toBe(a.id);

    expect(() => createKnowledgeBase(state, { id: "kb2", name: "项目 A", description: "" }, 1500)).toThrow();
    expect(() => createKnowledgeBase(state, { id: "kb3", name: "   ", description: "" }, 1500)).toThrow();
  });

  it("序列化：Rust snake_case DTO 与前端 camelCase 都能读回", () => {
    const fromRust = noteFromJson({
      id: "n1",
      title: "t",
      body_md: "b",
      notebook: null,
      tags_json: '["a","b"]',
      is_pinned: 1,
      is_favorite: 0,
      archived_at: null,
      source_material_id: null,
      current_revision: 3,
      created_at: 1,
      updated_at: 2,
      is_deleted: 0,
      deleted_at: null,
    });
    expect(fromRust).toMatchObject({ id: "n1", bodyMd: "b", tags: ["a", "b"], isPinned: true, currentRevision: 3, excludeFromProfile: false });

    const fromTs = noteFromJson({ id: "n2", title: "t2", bodyMd: "b2", tags: ["x"], excludeFromProfile: true });
    expect(fromTs).toMatchObject({ id: "n2", bodyMd: "b2", tags: ["x"], isPinned: false, currentRevision: 1, excludeFromProfile: true });
    expect(noteFromJson({ id: "n3", exclude_from_profile: 1 }).excludeFromProfile).toBe(true);
  });

  it("恢复专用写入：修订、时间与删除态按包保留（审计 KF-003 反例）", () => {
    let state = emptyNotesState();
    const pkg: Note = {
      ...createNoteDraft(0),
      id: "n1",
      title: "备份里的笔记",
      bodyMd: "修订 9 的内容",
      currentRevision: 9,
      createdAt: 1000,
      updatedAt: 8000,
      isDeleted: true,
      deletedAt: 8001,
      isFavorite: true,
      excludeFromProfile: true,
    };
    const first = restoreNoteRaw(state, pkg, 99999);
    expect(first.action).toBe("created");
    state = first.state;
    const got = state.notes[0];
    expect(got.currentRevision).toBe(9);
    expect(got.createdAt).toBe(1000);
    expect(got.updatedAt).toBe(8000);
    expect(got.isDeleted).toBe(true);
    expect(got.deletedAt).toBe(8001);
    expect(got.excludeFromProfile).toBe(true);

    // 重复恢复：幂等 current
    expect(restoreNoteRaw(state, pkg, 99999).action).toBe("current");
    expect(restoreNoteRaw(state, { ...pkg, excludeFromProfile: false }, 99999).action).toBe("skippedDivergent");

    // 恢复后的下一笔编辑从包内修订继续：9 → 10
    const edited = { ...pkg, title: "改", bodyMd: "新内容", isDeleted: false, deletedAt: null };
    const up = upsertNote(state, edited, 9, 100_000);
    expect(up.outcome.revision).toBe(10);
  });

  it("恢复专用写入：本地修订不回退，同修订分歧保留本地", () => {
    let state = emptyNotesState();
    const seed = createNoteDraft(1);
    seed.id = "n1";
    state = upsertNote(state, { ...seed, bodyMd: "v1" }, 0, 100).state;
    state = upsertNote(state, { ...seed, bodyMd: "v2" }, 1, 200).state;
    // 本地修订 2；包内修订 1 → 不回退
    const older = { ...seed, bodyMd: "v1-old", currentRevision: 1 };
    expect(restoreNoteRaw(state, older, 300).action).toBe("skippedLocalNewer");
    expect(state.notes[0].bodyMd).toBe("v2");
    // 包内修订 3 → 覆盖
    const newer = { ...seed, bodyMd: "v3", currentRevision: 3, createdAt: 50, updatedAt: 400 };
    const up = restoreNoteRaw(state, newer, 500);
    expect(up.action).toBe("updated");
    expect(up.state.notes[0]).toMatchObject({ bodyMd: "v3", currentRevision: 3, createdAt: 50, updatedAt: 400 });
    // 同修订号不同内容 → 保留本地等人工处置
    const divergent = { ...seed, bodyMd: "分歧内容", currentRevision: 3 };
    expect(restoreNoteRaw(up.state, divergent, 600).action).toBe("skippedDivergent");
  });
  it("归档与回收站是两个维度：归档不进主列表、能单独列出、移出后回来", () => {
    let state = emptyNotesState();
    const a = createNoteDraft(1000); a.id = "a"; a.title = "甲";
    const b = createNoteDraft(2000); b.id = "b"; b.title = "乙";
    state = upsertNote(state, { ...a, bodyMd: "甲正文" }, 0, 1000).state;
    state = upsertNote(state, { ...b, bodyMd: "乙正文" }, 0, 2000).state;

    // 归档之前：两篇都在主列表。
    expect(listNotes(state).map((n) => n.id).sort()).toEqual(["a", "b"]);

    // 归档甲：主列表只剩乙，归档视图单独列出甲。
    const archivedAt = 5000;
    state = upsertNote(state, { ...state.notes.find((n) => n.id === "a")!, archivedAt }, 1, archivedAt).state;
    expect(listNotes(state).map((n) => n.id)).toEqual(["b"]);
    expect(archivedNotes(state).map((n) => n.id)).toEqual(["a"]);
    // 归档是元数据：不追加修订。
    expect(state.notes.find((n) => n.id === "a")!.currentRevision).toBe(1);

    // 全文检索也不该把归档内容当活跃结果。
    expect(searchNotes(state, "甲正文")).toHaveLength(0);

    // 归档 + 回收站同时成立时，回收站视图仍要看得到它（两个维度独立）。
    state = deleteNote(state, "a", 6000);
    expect(listNotes(state, { includeDeleted: true, includeArchived: true }).map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(archivedNotes(state)).toHaveLength(0);

    // 恢复回收站后再移出归档：回到主列表。
    state = restoreNote(state, "a");
    state = upsertNote(state, { ...state.notes.find((n) => n.id === "a")!, archivedAt: null }, 1, 7000).state;
    expect(listNotes(state).map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(archivedNotes(state)).toHaveLength(0);
  });

  it("置顶排在列表最前，且不影响归档过滤", () => {
    let state = emptyNotesState();
    const old = createNoteDraft(1000); old.id = "old"; old.title = "旧";
    const fresh = createNoteDraft(2000); fresh.id = "fresh"; fresh.title = "新";
    state = upsertNote(state, { ...old, bodyMd: "旧正文" }, 0, 1000).state;
    state = upsertNote(state, { ...fresh, bodyMd: "新正文" }, 0, 2000).state;
    // 默认按更新时间倒序。
    expect(listNotes(state).map((n) => n.id)).toEqual(["fresh", "old"]);
    // 置顶旧的那篇：它排到最前，且不追加修订。
    state = upsertNote(state, { ...state.notes.find((n) => n.id === "old")!, isPinned: true }, 1, 3000).state;
    expect(listNotes(state).map((n) => n.id)).toEqual(["old", "fresh"]);
    expect(state.notes.find((n) => n.id === "old")!.currentRevision).toBe(1);
    // 置顶的笔记归档后也不再出现在主列表。
    state = upsertNote(state, { ...state.notes.find((n) => n.id === "old")!, archivedAt: 4000 }, 1, 4000).state;
    expect(listNotes(state).map((n) => n.id)).toEqual(["fresh"]);
  });
  it("批量移动只改笔记本、不追加修订，并如实报告没找到的 id", () => {
    let state = emptyNotesState();
    const a = createNoteDraft(1000); a.id = "a";
    const b = createNoteDraft(2000); b.id = "b";
    const c = createNoteDraft(3000); c.id = "c";
    state = upsertNote(state, { ...a, title: "甲", bodyMd: "甲正文" }, 0, 1000).state;
    state = upsertNote(state, { ...b, title: "乙", bodyMd: "乙正文" }, 0, 2000).state;
    state = upsertNote(state, { ...c, title: "丙", bodyMd: "丙正文", notebook: "项目A" }, 0, 3000).state;

    const out = moveNotesToNotebook(state, ["a", "c", "ghost"], "  项目B  ", 9000);
    // 两端空白要去掉
    expect(out.notebook).toBe("项目B");
    expect(out.moved.sort()).toEqual(["a", "c"]);
    // 找不到的 id 要点名，不能静默吞掉
    expect(out.missing).toEqual(["ghost"]);
    expect(out.state.notes.find((n) => n.id === "a")!.notebook).toBe("项目B");
    expect(out.state.notes.find((n) => n.id === "c")!.notebook).toBe("项目B");
    expect(out.state.notes.find((n) => n.id === "b")!.notebook).toBeNull();
    // 三篇的修订号都还是 1：批量移动是元数据变化
    expect(["a", "b", "c"].map((id) => out.state.notes.find((n) => n.id === id)!.currentRevision)).toEqual([1, 1, 1]);

    const out2 = moveNotesToNotebook(out.state, ["a", "c"], "   ", 99000);
    expect(out2.notebook).toBeNull();
    expect(out2.state.notes.find((n) => n.id === "a")!.notebook).toBeNull();
    const before = out.state.notes.find((n) => n.id === "c")!.updatedAt;
    const out3 = moveNotesToNotebook(out.state, ["c"], "项目B", 99000);
    // 已在该本里就不该改动时间
    expect(out3.state.notes.find((n) => n.id === "c")!.updatedAt).toBe(before);
  });

  it("复制笔记是新建：新 id、修订 1，保留内容与笔记本/标签，清掉原篇的状态", () => {
    let state = emptyNotesState();
    const src = createNoteDraft(1000);
    src.id = "src";
    src.title = "项目复盘";
    state = upsertNote(state, { ...src, bodyMd: "正文第一段" }, 0, 1000).state;
    // 原篇带上「属于它自己」的状态：置顶、收藏、归档、来源素材、修订 3。
    state = upsertNote(state, { ...state.notes[0], bodyMd: "正文第二段" }, 1, 2000).state;
    state = upsertNote(state, {
      ...state.notes[0],
      isPinned: true,
      isFavorite: true,
      archivedAt: 2500,
      notebook: "项目A",
      tags: ["工作", "灵感"],
      excludeFromProfile: true,
      sourceMaterialId: "m-1",
    }, 2, 3000).state;

    const draft = duplicateNoteDraft(state, "src", 9000);
    expect(draft.currentRevision).toBe(0); // 草稿尚未落库
    const saved = upsertNote(state, draft, 0, 9000);
    const copy = saved.state.notes[0];
    expect(saved.outcome).toEqual({ id: draft.id, revision: 1, created: true });
    expect(copy.id).not.toBe("src");
    expect(copy.currentRevision).toBe(1);
    expect(copy.title).toBe("项目复盘（副本）");
    expect(copy.bodyMd).toBe("正文第二段");
    expect(copy.notebook).toBe("项目A");
    expect(copy.tags).toEqual(["工作", "灵感"]);
    expect(copy.excludeFromProfile).toBe(true);
    // 属于原篇的状态不复制。
    expect(copy.isPinned).toBe(false);
    expect(copy.isFavorite).toBe(false);
    expect(copy.archivedAt).toBeNull();
    expect(copy.isDeleted).toBe(false);
    expect(copy.sourceMaterialId).toBeNull();
    // 原篇不动，副本进状态且可被列表看到。
    expect(saved.state.notes.find((n) => n.id === "src")!.currentRevision).toBe(2);
    // 原篇仍是置顶：置顶优先于「谁更新」，所以它排在副本前面。
    expect(listNotes(saved.state, { includeArchived: true }).map((n) => n.id)).toEqual(["src", copy.id]);
    expect(() => duplicateNoteDraft(state, "missing", 9000)).toThrow(/笔记不存在/);
  });

  it("单篇导出即正文本身，正文为空时退化为标题", () => {
    const note = createNoteDraft(1000);
    note.title = "标题";
    note.bodyMd = "# 自带标题\n\n正文里的 `代码` 与列表：\n\n- 甲\n- 乙\n";
    // 逐字一致：不补标题、不包装 front matter。
    expect(noteToMarkdown(note)).toBe(note.bodyMd);
    // 空正文导出空文件等于丢内容，退化为一行标题。
    expect(noteToMarkdown({ ...note, bodyMd: "   " })).toBe("# 标题\n");
    expect(noteToMarkdown({ ...note, title: "  ", bodyMd: "" })).toBe("# 无标题笔记\n");
  });
});
