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
