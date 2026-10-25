import { describe, expect, it } from "vitest";
import {
  executeRestore,
  restoreFailuresToMarkdown,
  summarizeRestore,
  type RestoreSink,
} from "./backupRestore";
import type { RestoredBackup } from "../../domain/systemBackup";
import type { RawMaterial } from "../../shell/store";

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
