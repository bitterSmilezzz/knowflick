import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restoreNotesBundle, type NotesRestoreReport } from "./notesRestore";
import { noteFromJson, type KnowledgeBase, type Note } from "../../domain/note";

/**
 * 恢复编排的回执语义（T04，审计 KF-006）：
 * 走浏览器仓储（localStorage 桩）验证完整链路——包 → 预检 → 专用写入 → 报告。
 * 同名异 id 的成员关系迁移、重复恢复幂等、失败逐条上报都在这里钉住。
 *
 * Rust 侧同一语义由 notes.rs 的 restore_* 测试钉住（SQLite 路径）。
 */

const storage: Record<string, string> = {};

beforeEach(() => {
  for (const k of Object.keys(storage)) delete storage[k];
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => { storage[k] = v; },
    removeItem: (k: string) => { delete storage[k]; },
  });
});
afterEach(() => vi.unstubAllGlobals());

const pkgNote = (id: string, over: Partial<Note> = {}): Note => ({
  id,
  title: `笔记 ${id}`,
  bodyMd: `${id} 的正文`,
  notebook: null,
  tags: [],
  isPinned: false,
  isFavorite: false,
  archivedAt: null,
  sourceMaterialId: null,
  currentRevision: 1,
  createdAt: 100,
  updatedAt: 200,
  isDeleted: false,
  deletedAt: null,
  ...over,
});

const pkgKb = (id: string, name: string): KnowledgeBase => ({
  id,
  name,
  description: "",
  createdAt: 100,
  updatedAt: 200,
});

function storedState(): { notes: Note[]; knowledgeBases: KnowledgeBase[]; membership: Record<string, number> } {
  const raw = storage["knowflick.notes.v1"];
  if (!raw) return { notes: [], knowledgeBases: [], membership: {} };
  const parsed = JSON.parse(raw) as { notes?: unknown[]; knowledgeBases?: unknown[]; membership?: Record<string, number> };
  return {
    notes: (parsed.notes ?? []).map((n) => noteFromJson(n)),
    knowledgeBases: (parsed.knowledgeBases ?? []) as KnowledgeBase[],
    membership: parsed.membership ?? {},
  };
}

describe("restoreNotesBundle（KF-006）", () => {
  it("空库恢复：修订 9 与删除态按包保留，成员关系挂上", async () => {
    const notes = [
      pkgNote("n1", { currentRevision: 9, createdAt: 1000, updatedAt: 8000 }),
      pkgNote("n2", { currentRevision: 9, isDeleted: true, deletedAt: 8001 }),
    ];
    const report = await restoreNotesBundle(notes, [pkgKb("kb1", "项目 A")], { "kb1\nn1": 300 }, "dir");
    expect(report.notes.created).toBe(2);
    expect(report.notes.failed).toHaveLength(0);
    const st = storedState();
    expect(st.notes.find((n) => n.id === "n1")).toMatchObject({ currentRevision: 9, createdAt: 1000, updatedAt: 8000 });
    expect(st.notes.find((n) => n.id === "n2")).toMatchObject({ isDeleted: true, deletedAt: 8001 });
    expect(st.membership["kb1\nn1"]).toBe(300);
  });

  it("同名异 id 的知识库：并入既有库并经 id 映射迁移成员，不再静默丢关系", async () => {
    // 预置本地库：id=A 名「项目 A」，已有一篇 n1
    await restoreNotesBundle([pkgNote("n1")], [pkgKb("A", "项目 A")], { "A\nn1": 100 }, "dir");
    // 备份里同名的库 id=B，笔记 n2 属于 B
    const report = await restoreNotesBundle(
      [pkgNote("n2")],
      [pkgKb("B", "项目 A")],
      { "B\nn2": 300 },
      "dir"
    );
    expect(report.knowledgeBases.created, "同名库不重复创建").toBe(0);
    expect(report.knowledgeBases.mapped).toBe(1);
    expect(report.membership.added).toBe(1);
    const st = storedState();
    expect(st.knowledgeBases, "只有本地那一库").toHaveLength(1);
    // 成员关系落在既有库 A 上，而不是丢失的 B
    expect(st.membership["A\nn2"]).toBeDefined();
    expect(report.membership.failed).toHaveLength(0);
  });

  it("重复恢复：全部已一致，成员关系计 existing，不重复写入", async () => {
    const notes = [pkgNote("n1", { currentRevision: 4 })];
    const kbs = [pkgKb("kb1", "项目 A")];
    await restoreNotesBundle(notes, kbs, { "kb1\nn1": 100 }, "dir");
    const second = await restoreNotesBundle(notes, kbs, { "kb1\nn1": 100 }, "dir");
    expect(second.notes.current).toBe(1);
    expect(second.notes.created).toBe(0);
    expect(second.knowledgeBases.mapped).toBe(1);
    expect(second.membership.existing).toBe(1);
    expect(second.membership.added).toBe(0);
    expect(storedState().notes[0].currentRevision).toBe(4);
  });

  it("本地修订较新：不回退，报告里如实计 skippedLocalNewer", async () => {
    await restoreNotesBundle([pkgNote("n1", { currentRevision: 5, bodyMd: "本地新版" })], [], {}, "dir");
    const report = await restoreNotesBundle([pkgNote("n1", { currentRevision: 2, bodyMd: "包内旧版" })], [], {}, "dir");
    expect(report.notes.skippedLocalNewer).toBe(1);
    expect(storedState().notes[0].bodyMd).toBe("本地新版");
  });

  it("成员关系指向建库失败的库：逐条记失败，不假计数", async () => {
    const report = await restoreNotesBundle(
      [pkgNote("n1")],
      [], // 包里没带这个库
      { "ghost\nn1": 100 },
      "dir"
    );
    expect(report.membership.failed).toEqual([
      { key: "ghost\nn1", error: "知识库未能落库，成员关系无法挂载" },
    ]);
    expect(report.membership.added).toBe(0);
  });
});

// 类型级守护：报告形状变更时这里先红
it("报告包含三类分节与失败明细字段", () => {
  const report: NotesRestoreReport = {
    notes: { created: 0, updated: 0, current: 0, skippedLocalNewer: 0, skippedDivergent: 0, failed: [] },
    knowledgeBases: { created: 0, mapped: 0, failed: [] },
    membership: { added: 0, existing: 0, failed: [] },
  };
  expect(report.notes.failed).toBeInstanceOf(Array);
});
