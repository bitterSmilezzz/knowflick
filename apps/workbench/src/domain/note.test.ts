import { describe, expect, it } from "vitest";
import {
  addNoteToKb,
  createKnowledgeBase,
  createNoteDraft,
  deleteNote,
  emptyNotesState,
  NoteConflictError,
  noteFromJson,
  restoreNote,
  searchNotes,
  upsertNote,
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
    expect(fromRust).toMatchObject({ id: "n1", bodyMd: "b", tags: ["a", "b"], isPinned: true, currentRevision: 3 });

    const fromTs = noteFromJson({ id: "n2", title: "t2", bodyMd: "b2", tags: ["x"] });
    expect(fromTs).toMatchObject({ id: "n2", bodyMd: "b2", tags: ["x"], isPinned: false, currentRevision: 1 });
  });
});
