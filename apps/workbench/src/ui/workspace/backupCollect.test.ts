import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backupCompleteness,
  backupReceipt,
  backupVersion,
  collectBackupSnapshot,
  readCurrentSettings,
  registerNotesDraftFlusher,
  webdavBackupReceipt,
} from "./backupCollect";
import { BACKUP_BROWSER_FORMAT_GAP } from "../../domain/systemBackup";
import { readArtifacts, restoreBrowserArtifact, restoreBrowserCard, restoreBrowserMaterial, restoreNoteFromBackup, storeArtifact } from "./repository";
import { backupRestoreNote, backupRestoreNoteHistory, SEARCH_HISTORY_STORAGE_KEY } from "../../shell/store";
import { cardFromJson } from "../../domain/card";
import type { RawMaterial } from "../../shell/store";

/**
 * 备份采集（T03，审计 KF-001 的反例）：
 * 旧导出用 Workspace 的界面缓存——冷启动直接导出时 notes.json 是空的，
 * 界面却报告「完整备份」。现在采集只认权威仓储：这里在浏览器仓储
 * （localStorage 桩）上验证「不打开笔记页也有全量笔记、含回收站」。
 */

const storage: Record<string, string> = {};
const formatGap = BACKUP_BROWSER_FORMAT_GAP;
const reviewHistoryGap = "逐次复习历史未纳入备份（浏览器体验不支持逐次复习历史备份）";
const deletedRecordsGap = "回收站内容未纳入备份（浏览器体验不支持回收站内容备份）";

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
  excludeFromProfile: false,
  ...over,
});

const artifact = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  artifactType: "创作草稿",
  title: `产物 ${id}`,
  contentMarkdown: `正文 ${id}`,
  sourceCardIds: [],
  sourceNoteIds: [],
  dateScopeStart: null,
  dateScopeEnd: null,
  createdAt: 100,
  updatedAt: 200,
  isDeleted: false,
  ...over,
});

describe("collectBackupSnapshot（KF-001）", () => {
  it("订阅快照入包时说明被排除的带参数地址", async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd !== "backup_capture_database") throw new Error(`unexpected ${cmd}`);
      return { materials: [], cards: [], notes: [], noteRevisions: [], subscriptions: { version: 1, items: [], excludedCount: 2 }, subscriptionsError: null, knowledgeBases: [], membership: {}, artifacts: [], artifactsError: null, r4: null, r4Error: null };
    });
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke } });
    const snapshot = await collectBackupSnapshot("/test/library");
    expect(backupReceipt(snapshot)).toContain("v7");
    expect(backupCompleteness(snapshot).join("；")).toContain("2 条订阅");
  });
  it("浏览器备份采集产物，并把损坏的产物库作为明确缺口", async () => {
    storage["knowflick.workspace.artifacts"] = JSON.stringify([artifact("a1")]);
    const collected = await collectBackupSnapshot("");
    expect(collected.artifacts).toEqual([artifact("a1")]);
    expect(collected.artifactsError).toBeNull();

    storage["knowflick.workspace.artifacts"] = "{broken";
    const corrupted = await collectBackupSnapshot("");
    expect(corrupted.artifacts).toEqual([]);
    expect(corrupted.artifactsError).toMatch(/无法解析/);
    expect(backupCompleteness(corrupted).join("；")).toContain("认知产物读取失败");
  });
  it("浏览器搜索历史进入独立 v12 备份分支", async () => {
    storage[SEARCH_HISTORY_STORAGE_KEY] = '["结构化检索","本地索引"]';
    const snapshot = await collectBackupSnapshot("");
    expect(snapshot.searchHistory).toEqual(["结构化检索", "本地索引"]);
    expect(backupVersion(snapshot)).toBe(12);
    expect(backupCompleteness(snapshot)).toContain(BACKUP_BROWSER_FORMAT_GAP);
    expect(backupCompleteness(snapshot).join("；")).not.toContain("搜索历史未纳入");
  });
  it("浏览器产物保存和恢复按 ID 幂等，冲突时保留本地内容", async () => {
    const saved = artifact("a1");
    await storeArtifact(saved, "");
    expect(await readArtifacts("")).toEqual([saved]);
    expect(await restoreBrowserArtifact({ ...saved })).toBe(false);
    await expect(restoreBrowserArtifact({ ...saved, title: "另一份内容" })).rejects.toThrow(/未覆盖/);
    expect(await readArtifacts("")).toEqual([saved]);
  });
  it("桌面采集历史版本里引用的附件，即使当前正文不再引用", async () => {
    const invoke = vi.fn(async (cmd: string, args: { relative?: string }) => {
      if (cmd === "backup_capture_database") return { materials: [], cards: [], notes: [note("n1")], noteRevisions: [{ noteId: "n1", revision: 1, title: "旧稿", bodyMd: "![图](media/image/old.png)", savedAt: 1 }], knowledgeBases: [], membership: {}, artifacts: [], artifactsError: null, r4: null, r4Error: null };
      if (cmd === "read_media" && args.relative === "media/image/old.png") return "AQI=";
      throw new Error(`unexpected ${cmd}`);
    });
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke } });
    const snapshot = await collectBackupSnapshot("/test/library");
    expect(snapshot.media.get("media/image/old.png")).toEqual(new Uint8Array([1, 2]));
    expect(snapshot.noteRevisions).toHaveLength(1);
    expect(backupReceipt(snapshot)).toContain("v6");
    expect(backupCompleteness(snapshot)[0]).not.toContain("笔记历史版本");
  });
  it("浏览器重复恢复相同素材和卡片会跳过，冲突时保留本地版本", async () => {
    const material = { id: "m1", sourceType: "manual", title: "原素材", rawText: "正文", createdAt: 1700000000000, updatedAt: 1700000000000 } as RawMaterial;
    const card = cardFromJson({ id: "c1", headline: "原卡片", details: "正文", reviewCount: 2, createdAt: 1700000000000 });
    expect(await restoreBrowserMaterial(material)).toBe(true);
    expect(await restoreBrowserCard(card)).toBe(true);
    expect(await restoreBrowserMaterial({ ...material })).toBe(false);
    expect(await restoreBrowserCard({ ...card })).toBe(false);
    await expect(restoreBrowserMaterial({ ...material, title: "不同内容" })).rejects.toThrow(/未覆盖/);
    await expect(restoreBrowserCard({ ...card, reviewCount: 1 })).rejects.toThrow(/学习进度不同/);
    const saved = JSON.parse(storage["knowflick.workspace.v1"]);
    expect(saved.materials[0].title).toBe("原素材");
    expect(saved.cards[0].reviewCount).toBe(2);
    saved.cards.push(saved.cards[0]);
    storage["knowflick.workspace.v1"] = JSON.stringify(saved);
    await expect(restoreBrowserCard(card)).rejects.toThrow(/多个同标识/);
  });
  it("桌面恢复笔记时保留标签", async () => {
    const invoke = vi.fn(async (_cmd: string, _args: unknown) => "created");
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke } });
    await restoreNoteFromBackup({ ...note("n1"), tags: ["学习"] }, "/test/library");
    expect(invoke.mock.calls[0][0]).toBe("note_restore_upsert");
    expect(invoke.mock.calls[0][1]).toMatchObject({ note: { tagsJson: '["学习"]' } });
    await backupRestoreNote({ protected: true, fingerprint: "hash" }, { ...note("n1"), tags: ["学习"] }, "/test/library");
    expect(invoke.mock.calls[1][0]).toBe("backup_restore_note");
    expect(invoke.mock.calls[1][1]).toMatchObject({ note: { tagsJson: '["学习"]' }, protected: true, fingerprint: "hash" });
    const history = [{ noteId: "n1", revision: 1, title: "旧稿", bodyMd: "正文", savedAt: 1 }];
    await backupRestoreNoteHistory({ protected: true, fingerprint: "hash" }, { ...note("n1"), tags: ["学习"] }, history, "/test/library");
    expect(invoke.mock.calls[2][0]).toBe("backup_restore_note_history");
    expect(invoke.mock.calls[2][1]).toMatchObject({ note: { tagsJson: '["学习"]' }, history });
  });
  it("桌面采集一次读取数据库快照，保留笔记字段与项目快照状态", async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd !== "backup_capture_database") throw new Error(`unexpected ${cmd}`);
      return { materials: [], cards: [], notes: [{ ...note("n1"), tags: undefined, tagsJson: '["学习"]' }],
        knowledgeBases: [], membership: {}, artifacts: [], artifactsError: null,
        r4: { version: 1, tables: {} }, r4Error: null };
    });
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke } });
    const snapshot = await collectBackupSnapshot("/test/library");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toBe("backup_capture_database");
    expect(snapshot.notes[0].tags).toEqual(["学习"]);
    expect(snapshot.r4).toEqual({ version: 1, tables: {} });
    expect(backupCompleteness(snapshot)[0]).not.toContain("不含项目、目标、个人画像");
    expect(backupReceipt(snapshot)).toContain("v5");
  });
  it("桌面 v10 只在全部前置快照可用时采集并校验搜索历史", async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === "backup_capture_database") return {
        materials: [], cards: [], notes: [], noteRevisions: [],
        subscriptions: { version: 1, items: [], excludedCount: 0 }, subscriptionsError: null,
        mail: { version: 1, accounts: [], syncStates: [], imports: [], rejected: [], materialBindings: {} }, mailError: null,
        reviewHistory: { version: 1, coverageStartedAt: 100, events: [] }, reviewHistoryError: null,
        knowledgeBases: [], membership: {}, artifacts: [], artifactsError: null, r4: null, r4Error: null,
      };
      if (cmd === "load_store") return { dir: "/test/library", cards: null, backup: null, backup2: null, settings: null, searchHistory: '["本地词","另一个词"]' };
      throw new Error(`unexpected ${cmd}`);
    });
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke } });
    const snapshot = await collectBackupSnapshot("/test/library");
    expect(snapshot.searchHistory).toEqual(["本地词", "另一个词"]);
    expect(backupVersion(snapshot)).toBe(10);
    expect(invoke).toHaveBeenCalledWith("load_store", { dir: "/test/library" }, undefined);
    expect(backupCompleteness(snapshot).join("；")).not.toContain("搜索历史未纳入");
  });
  it("桌面 v11 在完整前置快照下采集回收站记录及其附件", async () => {
    const deletedRecords = {
      version: 1 as const,
      materials: [{ material: {
        id: "deleted-material", sourceType: "image", title: "回收站图片", sourceUrl: null, rawText: "说明",
        cleanedMarkdown: null, contentHash: "hash", mediaPath: "media/image/deleted.png", mediaSizeBytes: 2,
        metadataJson: "{}", inboxStatus: "processed" as const, createdAt: 10, updatedAt: 11,
      }, deletedAt: 12 }],
      cards: [],
      artifacts: [],
    };
    const invoke = vi.fn(async (cmd: string, args: { relative?: string }) => {
      if (cmd === "backup_capture_database") return {
        materials: [], cards: [], notes: [], noteRevisions: [],
        subscriptions: { version: 1, items: [], excludedCount: 0 }, subscriptionsError: null,
        mail: { version: 1, accounts: [], syncStates: [], imports: [], rejected: [], materialBindings: {} }, mailError: null,
        reviewHistory: { version: 1, coverageStartedAt: 100, events: [] }, reviewHistoryError: null,
        knowledgeBases: [], membership: {}, artifacts: [], artifactsError: null,
        deletedRecords, deletedRecordsError: null, r4: null, r4Error: null,
      };
      if (cmd === "load_store") return { dir: "/test/library", cards: null, backup: null, backup2: null, settings: null, searchHistory: "[]" };
      if (cmd === "read_media" && args.relative === "media/image/deleted.png") return "AQI=";
      throw new Error(`unexpected ${cmd}`);
    });
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke } });
    const snapshot = await collectBackupSnapshot("/test/library");
    expect(backupVersion(snapshot)).toBe(11);
    expect(snapshot.deletedRecords?.materials).toHaveLength(1);
    expect(snapshot.media.get("media/image/deleted.png")).toEqual(new Uint8Array([1, 2]));
    expect(backupReceipt(snapshot)).toContain("回收站 1 条");
    expect(backupCompleteness(snapshot).join("；")).not.toContain("回收站内容未纳入");
  });
  it("损坏或重复的桌面搜索历史不被当成空列表，且错误不泄露搜索词", async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === "backup_capture_database") return {
        materials: [], cards: [], notes: [], noteRevisions: [],
        subscriptions: { version: 1, items: [], excludedCount: 0 }, subscriptionsError: null,
        mail: { version: 1, accounts: [], syncStates: [], imports: [], rejected: [], materialBindings: {} }, mailError: null,
        reviewHistory: { version: 1, coverageStartedAt: 100, events: [] }, reviewHistoryError: null,
        knowledgeBases: [], membership: {}, artifacts: [], artifactsError: null, r4: null, r4Error: null,
      };
      if (cmd === "load_store") return { dir: "/test/library", cards: null, backup: null, backup2: null, settings: null, searchHistory: '["private query","private query"]' };
      throw new Error(`unexpected ${cmd}`);
    });
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke } });
    const snapshot = await collectBackupSnapshot("/test/library");
    expect(snapshot.searchHistory).toBeNull();
    expect(backupCompleteness(snapshot).join("；")).toContain("搜索历史文件损坏或无法读取");
    expect(backupCompleteness(snapshot).join("；")).not.toContain("private query");
  });
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
    expect(backupCompleteness(snapshot)).toEqual([formatGap, reviewHistoryGap, deletedRecordsGap]);
    expect(backupReceipt(snapshot)).toContain("部分备份包");
    expect(backupReceipt(snapshot)).toContain("目标");
  });

  it("导出前处置未保存草稿：保存成功不报缺口，失败如实报", async () => {
    storage["knowflick.notes.v1"] = JSON.stringify({ notes: [], knowledgeBases: [], membership: {} });
    storage["knowflick.workspace.v1"] = JSON.stringify({ materials: [], cards: [], settings: "{}" });

    registerNotesDraftFlusher(async () => ({ attempted: true, saved: true }));
    const saved = await collectBackupSnapshot("");
    expect(backupCompleteness(saved)).toEqual([formatGap, reviewHistoryGap, deletedRecordsGap]);

    registerNotesDraftFlusher(async () => ({ attempted: true, saved: false }));
    const failed = await collectBackupSnapshot("");
    expect(backupCompleteness(failed)).toEqual([formatGap, reviewHistoryGap, deletedRecordsGap, "当前草稿未能落库，这次备份不含它的最新内容"]);

    registerNotesDraftFlusher(async () => { throw new Error("挂了"); });
    const threw = await collectBackupSnapshot("");
    expect(backupCompleteness(threw)).toEqual([formatGap, reviewHistoryGap, deletedRecordsGap, "当前草稿未能落库，这次备份不含它的最新内容"]);
  });

  it("WebDAV 上传回执明确列出缺失内容", () => {
    const receipt = webdavBackupReceipt({ fileName: "backup.kfbackup", bytes: 1024, sha256: "a".repeat(64), gaps: [formatGap] });
    expect(receipt).toContain("部分备份");
    expect(receipt).toContain("个人画像");
    expect(receipt).toContain("不是双向同步");
  });

  it("备份设置从当前已保存的数据读取", async () => {
    storage["knowflick.workspace.v1"] = JSON.stringify({ materials: [], cards: [], settings: JSON.stringify({ backupMarker: "saved" }) });
    expect((await readCurrentSettings("")).raw.backupMarker).toBe("saved");
  });
});
