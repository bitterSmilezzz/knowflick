import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createZipArchive } from "./markdownExport";
import { restoreKfBackup, unpackZipStoreBinary } from "./systemBackup";

describe("Go 生成的 v4 备份包", () => {
  const fixture = process.env.KF_GO_SYSTEM_BACKUP_FIXTURE;

  it.skipIf(!fixture)("使用现有恢复器读取清单、主数据和二进制附件", () => {
    if (!fixture) throw new Error("缺少 Go 备份测试文件");
    const data = new Uint8Array(readFileSync(fixture));
    const restored = restoreKfBackup(data);
    expect(restored.manifest.schemaVersion).toBe(4);
    expect(restored.manifest.exportedAtIso).toBe("2023-11-14T22:13:20.123Z");
    expect(restored.manifest.stats).toEqual({ cards: 1, materials: 1, artifacts: 1, notes: 1, knowledgeBases: 1, media: 1 });
    expect(restored.cards.map(card => card.id)).toEqual(["card-1"]);
    expect(restored.materials.map(material => material.id)).toEqual(["material-1"]);
    expect(restored.artifacts.map(artifact => artifact.id)).toEqual(["artifact-1"]);
    expect(restored.notes.map(note => note.bodyMd)).toEqual(["正文"]);
    expect(restored.knowledgeBases.map(kb => kb.id)).toEqual(["kb-1"]);
    expect(restored.kbMembership).toEqual({ "kb-1\nnote-1": 1700000000000 });
    expect(restored.settings?.raw).toEqual({ ui: { theme: "dark" }, sync: { username: "demo" } });
    expect(restored.media.get("media/image/test.png")).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0xff, 0x80]));
    const files = unpackZipStoreBinary(data);
    files.set("media/image/test.png", new Uint8Array([0]));
    const tampered = createZipArchive([...files].map(([path, data]) => ({ path, data })));
    expect(() => restoreKfBackup(tampered)).toThrow(/校验和不匹配/);
  });
});

describe("Go 从 SQLite 导出的 v4 备份包", () => {
  const fixture = process.env.KF_GO_SQLITE_BACKUP_FIXTURE;

  it.skipIf(!fixture)("恢复回收站笔记、成员关系和未重复打包的引用附件", () => {
    if (!fixture) throw new Error("缺少 SQLite 备份测试文件");
    const restored = restoreKfBackup(new Uint8Array(readFileSync(fixture)));
    expect(restored.manifest.schemaVersion).toBe(11);
    expect(restored.manifest.stats).toEqual({ cards: 1, materials: 1, artifacts: 1, notes: 2, knowledgeBases: 1, noteRevisions: 3, media: 2, r4: { projects: 1, goals: 1, profile_claims: 1, profile_denials: 0, project_members: 1, goal_evidence: 1 }, subscriptions: 2, subscriptionsExcluded: 1, mailAccounts: 1, mailSyncStates: 1, mailImports: 1, mailRejected: 1, reviewEvents: 1, searchHistory: 2, deletedMaterials: 1, deletedCards: 1, deletedArtifacts: 1 });
    expect(restored.cards[0]).toMatchObject({ id: "card-active", tags: ["标签"] });
    expect(restored.materials[0]).toMatchObject({ id: "material-active", mediaPath: "media/image/material.png" });
    expect(restored.artifacts[0]).toMatchObject({ id: "artifact-active", sourceCardIds: ["card-active"], sourceNoteIds: ["note-active"] });
    expect(restored.notes).toMatchObject([
      { id: "note-deleted", isDeleted: true, deletedAt: 1700000000004, bodyMd: "![笔迹](media/ink/note.json)" },
      { id: "note-active", isDeleted: false, excludeFromProfile: true, tags: ["备份"], sourceMaterialId: "material-active" },
    ]);
    expect(restored.kbMembership).toEqual({ "kb-1\nnote-active": 1700000000000, "kb-1\nnote-deleted": 1700000000004 });
    expect(restored.settings?.raw).toEqual({ ui: { theme: "dark" }, sync: { username: "demo" } });
    expect(restored.media.get("media/image/material.png")).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff]));
    expect(new TextDecoder().decode(restored.media.get("media/ink/note.json"))).toBe('{"strokes":[]}');
    expect(restored.noteRevisions).toMatchObject([
      { noteId: "note-active", revision: 1, title: "初稿", bodyMd: "只读旧正文" },
      { noteId: "note-active", revision: 2, title: "当前笔记", bodyMd: "![素材](media/image/material.png)" },
      { noteId: "note-deleted", revision: 1, title: "回收站笔记", bodyMd: "![笔迹](media/ink/note.json)" },
    ]);
  });
});
