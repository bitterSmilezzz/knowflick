import { describe, expect, it, vi } from "vitest";
import * as notesRestore from "./notesRestore";
import {
  executeRestore,
  restoreFailuresToMarkdown,
  summarizeRestore,
  type RestoreSink,
} from "./backupRestore";
import type { DeletedRecordsSnapshot, RestoredBackup } from "../../domain/systemBackup";
import type { RawMaterial } from "../../shell/store";
import { cardFromJson } from "../../domain/card";

/**
 * 整份恢复的一致性与失败报告（T05，收口审计 KF-007）。
 *
 * 旧实现的两个失真：
 * - 外层 catch 一律写「本地内容未受影响」，但中途失败时前面写进去的
 *   多条**没有回滚**——用户无法判断本地被改了多少；
 * - 附件保存失败时把素材的 mediaPath 改成 null 继续报告完成，
 *   于是恢复出来的素材看起来正常、附件实际丢了。
 *
 * 这里用注入式 sink 做故障注入：第 1/N/最后一条写失败、附件缺失、
 * 中途取消，逐个验证报告与真实副作用一致。
 */

const material = (id: string, over: Partial<RawMaterial> = {}): RawMaterial => ({
  id,
  sourceType: "manual",
  title: `素材 ${id}`,
  sourceUrl: null,
  rawText: `正文 ${id}`,
  contentHash: "",
  mediaPath: null,
  mediaSizeBytes: 0,
  metadataJson: "{}",
  inboxStatus: "inbox",
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

function backup(over: Partial<RestoredBackup> = {}): RestoredBackup {
  return {
    manifest: {
      format: "knowflick-backup",
      schemaVersion: 3,
      appName: "KnowFlick",
      appVersion: "0.1.0",
      exportedAt: 1,
      exportedAtIso: new Date(1).toISOString(),
      stats: { cards: 0, materials: 0, artifacts: 0, media: 0 },
      checksums: {},
    },
    cards: [],
    materials: [],
    settings: null,
    artifacts: [],
    media: new Map(),
    notes: [],
    knowledgeBases: [],
    kbMembership: {},
    ...over,
  };
}

interface Recorder {
  sink: RestoreSink;
  writtenMaterials: string[];
  writtenCards: string[];
}

function recorder(opts: { failMaterial?: (id: string) => string | null; failCard?: (id: string) => string | null } = {}): Recorder {
  const writtenMaterials: string[] = [];
  const writtenCards: string[] = [];
  const sink: RestoreSink = {
    async updateMaterial(m) {
      const err = opts.failMaterial?.(m.id);
      if (err) throw new Error(err);
      writtenMaterials.push(m.id);
    },
    async updateCard(c) {
      const err = opts.failCard?.(c.id);
      if (err) throw new Error(err);
      writtenCards.push(c.id);
    },
  };
  return { sink, writtenMaterials, writtenCards };
}

describe("executeRestore 失败报告（KF-007）", () => {
  it("恢复入口接受浏览器产物仓储，并按保存结果报告", async () => {
    const artifact = {
      id: "artifact-1",
      artifactType: "创作草稿",
      title: "草稿",
      contentMarkdown: "正文",
      sourceCardIds: [],
      sourceNoteIds: [],
      dateScopeStart: null,
      dateScopeEnd: null,
      createdAt: 1,
      updatedAt: 2,
      isDeleted: false,
    };
    const saveArtifact = vi.fn(async () => true);
    const report = await executeRestore(
      backup({ artifacts: [artifact] }),
      "",
      async (path) => path,
      { ...recorder().sink, saveArtifact },
    );
    expect(saveArtifact).toHaveBeenCalledWith(artifact);
    expect(report.written.artifacts).toBe(1);
    expect(report.failures.filter((failure) => failure.kind === "artifact")).toEqual([]);
  });

  it("只有其他内容恢复成功后才恢复订阅，避免部分恢复时启动抓取", async () => {
    const subscriptions = { version: 1 as const, items: [], excludedCount: 0 };
    const restoreSubscriptions = vi.fn(async () => 2);
    const failed = recorder({ failMaterial: () => "写入失败" });
    const report = await executeRestore(backup({ materials: [material("m1")], subscriptions }), "", async (path) => path, { ...failed.sink, restoreSubscriptions });
    expect(restoreSubscriptions).not.toHaveBeenCalled();
    expect(report.failures.some((f) => f.kind === "subscription")).toBe(true);
    const success = await executeRestore(backup({ subscriptions }), "", async (path) => path, { ...recorder().sink, restoreSubscriptions });
    expect(restoreSubscriptions).toHaveBeenCalledOnce();
    expect(summarizeRestore(success)).toContain("订阅新增 2 条");
  });
  it("素材未完整恢复时不迁移邮箱游标，成功后报告迁移计数", async () => {
    const mail = { version: 1 as const, accounts: [], syncStates: [], imports: [], rejected: [], materialBindings: {} };
    const counts = { accounts: 1, syncStates: 1, imports: 3, rejected: 0 };
    const restoreMail = vi.fn(async () => counts);
    const failed = recorder({ failMaterial: () => "写入失败" });
    const partial = await executeRestore(backup({ materials: [material("m1")], mail }), "", async (path) => path, { ...failed.sink, restoreMail });
    expect(restoreMail).not.toHaveBeenCalled();
    expect(partial.failures.some((failure) => failure.kind === "mail")).toBe(true);
    const complete = await executeRestore(backup({ mail }), "", async (path) => path, { ...recorder().sink, restoreMail });
    expect(restoreMail).toHaveBeenCalledOnce();
    expect(complete.mailWritten).toEqual(counts);
    expect(summarizeRestore(complete)).toContain("邮件去重记录新增 3 条");
  });
  it("v9 合并逐次复习事件；旧包没有历史字段时不触碰本机历史", async () => {
    const reviewHistory = { version: 1 as const, coverageStartedAt: 10, events: [] };
    const counts = { inserted: 2, skipped: 1 };
    const restoreReviewHistory = vi.fn(async () => counts);
    const sink = { ...recorder().sink, restoreReviewHistory };
    const oldPackage = await executeRestore(backup(), "", async (path) => path, sink);
    expect(restoreReviewHistory).not.toHaveBeenCalled();
    expect(oldPackage.reviewHistoryWritten).toBeUndefined();

    const current = await executeRestore(backup({ reviewHistory }), "", async (path) => path, sink);
    expect(restoreReviewHistory).toHaveBeenCalledOnce();
    expect(restoreReviewHistory).toHaveBeenCalledWith(reviewHistory);
    expect(current.reviewHistoryWritten).toEqual(counts);
    expect(summarizeRestore(current)).toContain("逐次复习事件新增 2 条、已存在 1 条");
  });
  it("v10 合并搜索历史并回报新增与跳过；旧包不触碰搜索历史", async () => {
    const imported = ["shared", "from backup"];
    const counts = { added: 1, skipped: 1, alreadyPresent: 1, overLimit: 0 };
    const restoreSearchHistory = vi.fn(async () => counts);
    const sink = { ...recorder().sink, restoreSearchHistory };
    const oldPackage = await executeRestore(backup(), "", async (path) => path, sink);
    expect(restoreSearchHistory).not.toHaveBeenCalled();
    expect(oldPackage.searchHistoryWritten).toBeUndefined();

    const current = await executeRestore(backup({ searchHistory: imported }), "", async (path) => path, sink);
    expect(restoreSearchHistory).toHaveBeenCalledOnce();
    expect(restoreSearchHistory).toHaveBeenCalledWith(imported);
    expect(current.searchHistoryWritten).toEqual(counts);
    expect(summarizeRestore(current)).toContain("搜索历史新增 1 条、已存在 1 条、超出 8 条上限 0 条");
    expect(current.partial).toBe(false);
  });
  it("v11 恢复回收站时重写附件路径、保留删除态，并先于 R4 落库", async () => {
    const deletedMaterial = material("trash-material", { mediaPath: "media/audio/deleted.webm" });
    const deletedCard = cardFromJson({ id: "trash-card", materialId: deletedMaterial.id });
    const deletedArtifact: DeletedRecordsSnapshot["artifacts"][number] = {
      id: "trash-artifact",
      artifactType: "note",
      title: "已删除产物",
      contentMarkdown: "正文",
      sourceCardIds: [deletedCard.id],
      sourceNoteIds: [],
      dateScopeStart: null,
      dateScopeEnd: null,
      createdAt: 1,
      updatedAt: 2,
      isDeleted: true,
    };
    const deletedRecords: DeletedRecordsSnapshot = {
      version: 1,
      materials: [{ material: deletedMaterial, deletedAt: 12 }],
      cards: [{ card: deletedCard, deletedAt: 13 }],
      artifacts: [deletedArtifact],
    };
    const events: string[] = [];
    const restoreDeletedRecords = vi.fn(async () => {
      events.push("deleted-records");
      return { materials: 1, cards: 1, artifacts: 1, alreadyPresent: 0 };
    });
    const restoreR4 = vi.fn(async () => {
      events.push("r4");
      return 1;
    });

    const report = await executeRestore(
      backup({
        deletedRecords,
        media: new Map([["media/audio/deleted.webm", new Uint8Array([1, 2, 3])]]),
        r4: {},
      }),
      "",
      async (path) => {
        events.push(`stage:${path}`);
        return "media/audio/restored-deleted.webm";
      },
      { ...recorder().sink, restoreDeletedRecords, restoreR4 },
    );

    expect(restoreDeletedRecords).toHaveBeenCalledWith({
      ...deletedRecords,
      materials: [{ material: { ...deletedMaterial, mediaPath: "media/audio/restored-deleted.webm" }, deletedAt: 12 }],
    });
    expect(events).toEqual(["stage:media/audio/deleted.webm", "deleted-records", "r4"]);
    expect(report.deletedRecordsWritten).toEqual({ materials: 1, cards: 1, artifacts: 1, alreadyPresent: 0 });
    expect(report.partial).toBe(false);
  });
  it("回收站附件失败时跳过依赖素材的删除卡片和产物，并逐条报告", async () => {
    const deletedMaterial = material("trash-material", { mediaPath: "media/audio/deleted.webm" });
    const deletedCard = cardFromJson({ id: "trash-card", materialId: deletedMaterial.id });
    const deletedRecords: DeletedRecordsSnapshot = {
      version: 1,
      materials: [{ material: deletedMaterial, deletedAt: 12 }],
      cards: [{ card: deletedCard, deletedAt: 13 }],
      artifacts: [{
        id: "trash-artifact",
        artifactType: "note",
        title: "已删除产物",
        contentMarkdown: "正文",
        sourceCardIds: [deletedCard.id],
        sourceNoteIds: [],
        dateScopeStart: null,
        dateScopeEnd: null,
        createdAt: 1,
        updatedAt: 2,
        isDeleted: true,
      }],
    };
    const restoreDeletedRecords = vi.fn(async () => ({ materials: 0, cards: 0, artifacts: 0, alreadyPresent: 0 }));

    const report = await executeRestore(
      backup({
        deletedRecords,
        media: new Map([["media/audio/deleted.webm", new Uint8Array([1, 2, 3])]]),
      }),
      "",
      async () => { throw new Error("附件无法写入"); },
      { ...recorder().sink, restoreDeletedRecords },
    );

    expect(restoreDeletedRecords).not.toHaveBeenCalled();
    expect(report.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "deletedRecords", id: "trash-material" }),
      expect.objectContaining({ kind: "deletedRecords", id: "trash-card" }),
      expect.objectContaining({ kind: "deletedRecords", id: "trash-artifact" }),
    ]));
    expect(restoreFailuresToMarkdown(report)).toContain("回收站：新增素材 0 条");
    expect(report.partial).toBe(true);
  });
  it("不支持搜索历史的恢复环境会写入明确失败", async () => {
    const report = await executeRestore(backup({ searchHistory: ["query"] }), "", async (path) => path, recorder().sink);
    expect(report.failures).toContainEqual(expect.objectContaining({ kind: "searchHistory", id: "search_history.json" }));
    expect(report.partial).toBe(true);
  });
  it("素材冲突时不把关联卡片、笔记和产物连到本地不同的原件", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke: vi.fn() } });
    const noteRestore = vi.spyOn(notesRestore, "restoreNotesBundle").mockResolvedValueOnce(notesRestore.emptyNotesRestoreReport());
    try {
      const rec = recorder({ failMaterial: () => "同一标识冲突" });
      const saveArtifact = vi.fn(async () => true);
      const note = { id: "n1", bodyMd: "正文", sourceMaterialId: "m1" } as RestoredBackup["notes"][number];
      const report = await executeRestore(backup({
        materials: [material("m1")],
        cards: [cardFromJson({ id: "c1", materialId: "m1" })],
        notes: [note],
        kbMembership: { "kb\nn1": 1 },
        artifacts: [{ id: "a1", artifactType: "note", title: "", contentMarkdown: "正文", sourceCardIds: ["c1"], sourceNoteIds: ["n1"], createdAt: 1, updatedAt: 1 }],
      }), "", async (path) => path, { ...rec.sink, saveArtifact });
      expect(rec.writtenCards).toEqual([]);
      expect(noteRestore.mock.calls[0][0]).toEqual([]);
      expect(noteRestore.mock.calls[0][2]).toEqual({});
      expect(saveArtifact).not.toHaveBeenCalled();
      expect(report.failures.map((f) => f.kind)).toEqual(["material", "card", "note", "membership", "artifact"]);
      expect(report.partial).toBe(true);
    } finally { noteRestore.mockRestore(); vi.unstubAllGlobals(); }
  });
  it("无有效标识的条目列入失败报告，不静默丢弃", async () => {
    const report = await executeRestore(backup({ materials: [material("")], artifacts: [{ id: "", title: "标题" } as RestoredBackup["artifacts"][number]] }), "", async (path) => path, recorder().sink);
    expect(report.partial).toBe(true);
    expect(report.plan.materials).toBe(1);
    expect(report.failures.map((f) => f.kind)).toEqual(["material", "artifact"]);
  });
  it("相同产物安全跳过并显示在回执", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke: vi.fn() } });
    try {
      const report = await executeRestore(backup({ artifacts: [{ id: "a1", artifactType: "note", title: "", contentMarkdown: "正文", sourceCardIds: [], sourceNoteIds: [], createdAt: 1, updatedAt: 1 }] }), "", async (path) => path, { ...recorder().sink, saveArtifact: async () => false });
      expect(report.partial).toBe(false);
      expect(report.skipped.artifacts).toBe(1);
      expect(summarizeRestore(report)).toContain("产物 0/1（跳过 1）");
    } finally { vi.unstubAllGlobals(); }
  });
  it("笔记附件按原路径恢复，附件失败的笔记及其成员关系不落库", async () => {
    const restore = vi.spyOn(notesRestore, "restoreNotesBundle").mockResolvedValueOnce(notesRestore.emptyNotesRestoreReport());
    try {
      const good = { id: "good", bodyMd: "![图](media/image/good.png)" } as RestoredBackup["notes"][number];
      const bad = { id: "bad", bodyMd: "![录音](media/audio/bad.webm)" } as RestoredBackup["notes"][number];
      const report = await executeRestore(backup({
        notes: [good, bad],
        media: new Map([["media/image/good.png", new Uint8Array([1])], ["media/audio/bad.webm", new Uint8Array([2])]]),
        kbMembership: { "kb\ngood": 1, "kb\nbad": 2 },
      }), "", async (path) => { if (path.includes("bad")) throw new Error("同路径内容冲突"); return path; }, recorder().sink);
      expect(restore.mock.calls[0][0]).toEqual([good]);
      expect(restore.mock.calls[0][2]).toEqual({ "kb\ngood": 1 });
      expect(report.partial).toBe(true);
      expect(report.failures).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "note", id: "bad" }),
        expect.objectContaining({ kind: "membership", id: "kb\nbad" }),
        expect.objectContaining({ kind: "media", id: "media/audio/bad.webm" }),
      ]));
    } finally { restore.mockRestore(); }
  });

  it("备份缺少笔记引用的附件时不写入该笔记", async () => {
    const restore = vi.spyOn(notesRestore, "restoreNotesBundle").mockResolvedValueOnce(notesRestore.emptyNotesRestoreReport());
    try {
      const note = { id: "n1", bodyMd: "![图片](media/image/missing.png)" } as RestoredBackup["notes"][number];
      const report = await executeRestore(backup({ notes: [note] }), "", async (path) => path, recorder().sink);
      expect(restore.mock.calls[0][0]).toEqual([]);
      expect(report.partial).toBe(true);
      expect(report.failures[0]).toMatchObject({ kind: "note", id: "n1" });
    } finally { restore.mockRestore(); }
  });
  it("历史修订引用的附件缺失时，笔记和历史一起保留不写", async () => {
    const restore = vi.spyOn(notesRestore, "restoreNotesBundle").mockResolvedValueOnce(notesRestore.emptyNotesRestoreReport());
    try {
      const note = { id: "n1", bodyMd: "当前正文" } as RestoredBackup["notes"][number];
      const report = await executeRestore(backup({ notes: [note], noteRevisions: [{ noteId: "n1", revision: 1, title: "旧稿", bodyMd: "![图片](media/image/old.png)", savedAt: 1 }] }), "", async (path) => path, recorder().sink);
      expect(restore.mock.calls[0][0]).toEqual([]);
      expect(report.partial).toBe(true);
      expect(report.failures[0].error).toContain("media/image/old.png");
    } finally { restore.mockRestore(); }
  });
  it("笔记存在分歧时报告部分恢复，重复恢复的相同笔记不算冲突", async () => {
    const noteReport = notesRestore.emptyNotesRestoreReport();
    noteReport.notes.skippedDivergent = 1;
    noteReport.notes.current = 1;
    const restore = vi.spyOn(notesRestore, "restoreNotesBundle").mockResolvedValueOnce(noteReport);
    try {
      const report = await executeRestore(backup({ notes: [{ id: "n1" }, { id: "n2" }] as RestoredBackup["notes"] }), "", async () => "", recorder().sink);
      expect(report.partial).toBe(true);
      expect(report.failures[0].error).toContain("1 篇笔记");
      expect(summarizeRestore(report)).toContain("跳过 2");
    } finally {
      restore.mockRestore();
    }
  });
  it("已存在且匹配的关联素材不覆盖，回执报告跳过", async () => {
    const rec = recorder();
    rec.sink.updateMaterial = async () => false;
    const report = await executeRestore(backup({ materials: [material("m1")] }), "", async () => "", rec.sink);
    expect(report.partial).toBe(false);
    expect(report.skipped.materials).toBe(1);
    expect(summarizeRestore(report)).toContain("跳过 1");
  });
  it("笔记恢复意外中断时，不掩盖此前写入", async () => {
    const restore = vi.spyOn(notesRestore, "restoreNotesBundle").mockRejectedValueOnce(new Error("读取失败"));
    try {
      const rec = recorder();
      const report = await executeRestore(backup({ materials: [material("m1")], notes: [{ id: "n1" } as RestoredBackup["notes"][number]] }), "", async () => "", rec.sink);
      expect(rec.writtenMaterials).toEqual(["m1"]);
      expect(report.partial).toBe(true);
      expect(report.failures[0].error).toContain("部分笔记或知识库可能已写入");
    } finally {
      restore.mockRestore();
    }
  });
  it("项目快照冲突时报告部分恢复，保留已写入条目的事实", async () => {
    const rec = recorder();
    rec.sink.restoreR4 = async () => { throw new Error("同一标识冲突"); };
    const report = await executeRestore(backup({ materials: [material("m1")], r4: {} }), "", async () => "", rec.sink);
    expect(rec.writtenMaterials).toEqual(["m1"]);
    expect(report.partial).toBe(true);
    expect(report.failures).toEqual([{ kind: "r4", id: "r4.json", error: "同一标识冲突" }]);
  });
  it("当前环境无法恢复包内产物时，报告部分恢复及失败项", async () => {
    const rec = recorder();
    const report = await executeRestore(
      backup({ artifacts: [{ id: "a1", artifactType: "note", title: "产物", contentMarkdown: "正文", sourceCardIds: [], sourceNoteIds: [], dateScopeStart: null, dateScopeEnd: null, createdAt: 1, updatedAt: 1, isDeleted: false }] }),
      "", async () => "", rec.sink
    );
    expect(report.partial).toBe(true);
    expect(report.failures).toEqual([{ kind: "artifact", id: "a1", error: "当前环境不支持恢复认知产物" }]);
  });
  it("全部成功：报告为完整恢复，摘要与实际条数一致", async () => {
    const rec = recorder();
    const report = await executeRestore(
      backup({ materials: [material("m1"), material("m2")] }),
      "",
      async () => "media/audio/x.webm",
      rec.sink
    );
    expect(report.partial).toBe(false);
    expect(report.failures).toHaveLength(0);
    expect(report.written.materials).toBe(2);
    expect(rec.writtenMaterials).toEqual(["m1", "m2"]);
    expect(summarizeRestore(report)).toContain("素材 2/2");
  });

  it("第 1 条写入失败：其余条目照常写入，失败逐条记录——不再谎称「未受影响」", async () => {
    const rec = recorder({ failMaterial: (id) => (id === "m1" ? "磁盘满" : null) });
    const report = await executeRestore(
      backup({ materials: [material("m1"), material("m2"), material("m3")] }),
      "",
      async () => "media/audio/x.webm",
      rec.sink
    );
    expect(report.partial).toBe(true);
    expect(report.failures).toEqual([{ kind: "material", id: "m1", error: "磁盘满" }]);
    // 关键：第 2、3 条**已经写进去了**——报告如实反映这一点
    expect(rec.writtenMaterials).toEqual(["m2", "m3"]);
    expect(report.written.materials).toBe(2);
  });

  it("最后一条写入失败：前面的写入保留，报告只记失败那一条", async () => {
    const rec = recorder({ failCard: (id) => (id === "c3" ? "只读库" : null) });
    const report = await executeRestore(
      backup({
        materials: [],
        cards: [
          { id: "c1", headline: "h1", summary: "s", details: "d", category: "c", tags: [], links: [], source: "", seenAt: null, swiped: null, isFavorite: false, favoritedAt: null, reviewCount: 0, masteryLevel: 0, lastReviewedAt: null, repetition: 0, intervalDays: 0, easeFactor: 2.5, stability: 0, difficulty: 0, createdAt: 1, editedAt: null, updatedAt: 1, version: 1 } as any,
          { id: "c2", headline: "h2", summary: "s", details: "d", category: "c", tags: [], links: [], source: "", seenAt: null, swiped: null, isFavorite: false, favoritedAt: null, reviewCount: 0, masteryLevel: 0, lastReviewedAt: null, repetition: 0, intervalDays: 0, easeFactor: 2.5, stability: 0, difficulty: 0, createdAt: 1, editedAt: null, updatedAt: 1, version: 1 } as any,
          { id: "c3", headline: "h3", summary: "s", details: "d", category: "c", tags: [], links: [], source: "", seenAt: null, swiped: null, isFavorite: false, favoritedAt: null, reviewCount: 0, masteryLevel: 0, lastReviewedAt: null, repetition: 0, intervalDays: 0, easeFactor: 2.5, stability: 0, difficulty: 0, createdAt: 1, editedAt: null, updatedAt: 1, version: 1 } as any,
        ],
      }),
      "",
      async () => "media/audio/x.webm",
      rec.sink
    );
    expect(report.partial).toBe(true);
    expect(report.failures).toEqual([{ kind: "card", id: "c3", error: "只读库" }]);
    expect(rec.writtenCards).toEqual(["c1", "c2"]);
    expect(report.written.cards).toBe(2);
  });

  it("附件缺失：素材不落库（不把引用改成 null），失败明细说清原因", async () => {
    const rec = recorder();
    const report = await executeRestore(
      backup({
        materials: [material("m1", { mediaPath: "media/audio/a.webm" })],
        media: new Map([["media/audio/a.webm", new Uint8Array([1, 2, 3])]]),
      }),
      "",
      async () => {
        throw new Error("磁盘空间不足");
      },
      rec.sink
    );
    expect(report.partial).toBe(true);
    // 附件失败 → 素材**没有**落库（不留下指向空处的引用）
    expect(rec.writtenMaterials).toEqual([]);
    expect(report.written.materials).toBe(0);
    const mediaFailure = report.failures.find((f) => f.kind === "media");
    expect(mediaFailure?.error).toBe("磁盘空间不足");
    const materialFailure = report.failures.find((f) => f.kind === "material");
    expect(materialFailure?.id).toBe("m1");
    expect(materialFailure?.error).toContain("附件未能恢复");
  });

  it("附件恢复成功：素材落库且 mediaPath 换成本机路径", async () => {
    const rec = recorder();
    let staged: RawMaterial | undefined;
    const report = await executeRestore(
      backup({
        materials: [material("m1", { mediaPath: "media/audio/a.webm" })],
        media: new Map([["media/audio/a.webm", new Uint8Array([1, 2, 3])]]),
      }),
      "",
      async () => "media/audio/local-copy.webm",
      {
        ...rec.sink,
        async updateMaterial(m) {
          staged = m;
        },
      }
    );
    expect(report.partial).toBe(false);
    expect(staged?.mediaPath).toBe("media/audio/local-copy.webm");
  });

  it("中途取消：停止后续写入，报告标记为取消且为部分恢复", async () => {
    const rec = recorder();
    const cancel = { cancelled: false };
    const report = await executeRestore(
      backup({ materials: [material("m1"), material("m2"), material("m3")] }),
      "",
      async () => "media/audio/x.webm",
      {
        ...rec.sink,
        async updateMaterial(m) {
          await rec.sink.updateMaterial(m);
          if (m.id === "m1") cancel.cancelled = true;
        },
      },
      { cancel }
    );
    expect(report.cancelled).toBe(true);
    expect(report.partial).toBe(true);
    expect(rec.writtenMaterials).toEqual(["m1"]);
  });

  it("失败明细能导出成 Markdown（用户可贴给外部工具排查）", async () => {
    const rec = recorder({ failMaterial: (id) => (id === "m1" ? "磁盘满" : null) });
    const report = await executeRestore(
      backup({ materials: [material("m1")] }),
      "",
      async () => "media/audio/x.webm",
      rec.sink
    );
    const md = restoreFailuresToMarkdown(report);
    expect(md).toContain("# 备份恢复失败明细");
    expect(md).toContain("m1");
    expect(md).toContain("磁盘满");
  });
});
