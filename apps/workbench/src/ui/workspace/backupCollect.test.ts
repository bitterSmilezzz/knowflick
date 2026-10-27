import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backupCompleteness,
  collectBackupSnapshot,
  registerNotesDraftFlusher,
} from "./backupCollect";

/**
 * 备份采集（T03，审计 KF-001 的反例）：
 * 旧导出用 Workspace 的界面缓存——冷启动直接导出时 notes.json 是空的，
 * 界面却报告「完整备份」。现在采集只认权威仓储：这里在浏览器仓储
 * （localStorage 桩）上验证「不打开笔记页也有全量笔记、含回收站」。
 */

const storage: Record<string, string> = {};

beforeEach(() => {
  for (const k of Object.keys(storage)) delete storage[k];
  const shell = {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => { storage[k] = v; },
    removeItem: (k: string) => { delete storage[k]; },
  };
  vi.stubGlobal("localStorage", shell);
  vi.stubGlobal("sessionStorage", { ...shell, length: 0 });
  registerNotesDraftFlusher(null);
});
afterEach(() => {
  registerNotesDraftFlusher(null);
  vi.unstubAllGlobals();
});

const note = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `笔记 ${id}`,
  bodyMd: `${id} 正文`,
  notebook: null,
  tags: [],
  isPinned: false,
  isFavorite: false,
  archivedAt: null,
  sourceMaterialId: null,
  currentRevision: 2,
  createdAt: 100,
  updatedAt: 200,
  isDeleted: false,
  deletedAt: null,
  ...over,
});

describe("collectBackupSnapshot（KF-001）", () => {
  it("冷启动不打开笔记页：快照仍含全量笔记（含回收站删除态）与成员关系", async () => {
    // 只写仓储：没有任何「页面被打开过」的前置
    storage["knowflick.notes.v1"] = JSON.stringify({
      notes: [
        note("n1", { currentRevision: 9 }),
        note("n2", { isDeleted: true, deletedAt: 8001, currentRevision: 3 }),
      ],
      knowledgeBases: [{ id: "kb1", name: "项目 A", description: "", createdAt: 1, updatedAt: 2 }],
      membership: { "kb1\nn1": 300 },
    });
    storage["knowflick.workspace.v1"] = JSON.stringify({ materials: [], cards: [], settings: "{}" });

    const snapshot = await collectBackupSnapshot("");
    expect(snapshot.notes, "回收站里的笔记也进备份").toHaveLength(2);
    expect(snapshot.notes.map((n) => n.currentRevision)).toEqual([9, 3]);
    expect(snapshot.knowledgeBases).toHaveLength(1);
    expect(snapshot.membership["kb1\nn1"]).toBe(300);
    expect(backupCompleteness(snapshot), "无缺口 → 完整备份").toEqual([]);
  });

  it("导出前处置未保存草稿：保存成功不报缺口，失败如实报", async () => {
    storage["knowflick.notes.v1"] = JSON.stringify({ notes: [], knowledgeBases: [], membership: {} });
    storage["knowflick.workspace.v1"] = JSON.stringify({ materials: [], cards: [], settings: "{}" });

    registerNotesDraftFlusher(async () => ({ attempted: true, saved: true }));
    const saved = await collectBackupSnapshot("");
    expect(backupCompleteness(saved)).toEqual([]);

    registerNotesDraftFlusher(async () => ({ attempted: true, saved: false }));
    const failed = await collectBackupSnapshot("");
    expect(backupCompleteness(failed)).toEqual(["当前草稿未能落库，这次备份不含它的最新内容"]);

    registerNotesDraftFlusher(async () => { throw new Error("挂了"); });
    const threw = await collectBackupSnapshot("");
    expect(backupCompleteness(threw)).toEqual(["当前草稿未能落库，这次备份不含它的最新内容"]);
  });
});
