import { describe, expect, it } from "vitest";
import { createKfBackupArchive, restoreKfBackup } from "./systemBackup";
import { cardFromJson } from "./card";
import type { RawMaterial, Artifact } from "../shell/store";
import type { SettingsFile } from "./settings";
import { defaultSettings } from "./settings";

describe("系统级完整无损备份包 (.kfbackup)", () => {
  const sampleCard = cardFromJson({
    id: "card-backup-1",
    headline: "系统备份规范",
    summary: "保证整库数据无损双向迁移",
    details: "包含 SQLite 原始数据、设置与产物，支持校验和与往返还原。",
    category: "架构",
    tags: ["备份", "数据主权"],
    source: "imported",
    createdAt: 1700000000000,
    isFavorite: true,
    reviewCount: 3,
  });

  const sampleMaterial: RawMaterial = {
    id: "mat-backup-1",
    sourceType: "web",
    title: "数据主权白皮书",
    sourceUrl: "https://example.com/data-sovereignty",
    rawText: "用户对其生成与收集的所有数据拥有最高所有权。",
    contentHash: "hash-12345",
    metadataJson: "{}",
    inboxStatus: "processed",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };

  const sampleArtifact: Artifact = {
    id: "art-backup-1",
    artifactType: "briefing",
    title: "第 42 周认知洞察",
    contentMarkdown: "# 周度总结\n\n本周新增架构卡片 5 张。",
    sourceCardIds: ["card-backup-1"],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };

  const sampleSettingsFile: SettingsFile = {
    settings: {
      ...defaultSettings,
      providerId: "deepseek",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-chat",
    },
    raw: {
      reviewPluginEnabled: true,
    },
  };

  it("打包生成 .kfbackup 二进制归档并 100% 无损还原", () => {
    const archiveBytes = createKfBackupArchive(
      [sampleMaterial],
      [sampleCard],
      sampleSettingsFile,
      [sampleArtifact]
    );

    expect(archiveBytes.length).toBeGreaterThan(100);

    // 还原验证
    const restored = restoreKfBackup(archiveBytes);

    expect(restored.manifest.format).toBe("knowflick-backup");
    expect(restored.manifest.stats.cards).toBe(1);
    expect(restored.manifest.stats.materials).toBe(1);
    expect(restored.manifest.stats.artifacts).toBe(1);

    // 验证卡片逐字段还原
    expect(restored.cards.length).toBe(1);
    expect(restored.cards[0].id).toBe(sampleCard.id);
    expect(restored.cards[0].headline).toBe(sampleCard.headline);
    expect(restored.cards[0].details).toBe(sampleCard.details);
    expect(restored.cards[0].isFavorite).toBe(true);
    expect(restored.cards[0].reviewCount).toBe(3);

    // 验证素材逐字段还原
    expect(restored.materials.length).toBe(1);
    expect(restored.materials[0].id).toBe(sampleMaterial.id);
    expect(restored.materials[0].title).toBe(sampleMaterial.title);
    expect(restored.materials[0].rawText).toBe(sampleMaterial.rawText);

    // 验证产物逐字段还原
    expect(restored.artifacts.length).toBe(1);
    expect(restored.artifacts[0].title).toBe(sampleArtifact.title);
    expect(restored.artifacts[0].contentMarkdown).toBe(sampleArtifact.contentMarkdown);

    // 验证设置还原
    expect(restored.settings).not.toBeNull();
    expect(restored.settings?.settings.providerId).toBe("deepseek");
    expect(restored.settings?.raw.reviewPluginEnabled).toBe(true);
  });

  it("平滑向后兼容旧版单一 JSON 格式", () => {
    const legacyJson = JSON.stringify({
      format: "knowflick-workspace",
      version: 1,
      materials: [sampleMaterial],
      cards: [sampleCard],
      settings: sampleSettingsFile.settings,
    });

    const restored = restoreKfBackup(legacyJson);
    expect(restored.cards.length).toBe(1);
    expect(restored.cards[0].headline).toBe(sampleCard.headline);
    expect(restored.materials.length).toBe(1);
    expect(restored.settings?.settings.providerId).toBe("deepseek");
  });

  it("当解包缺少 manifest.json 时抛出明确错误", () => {
    const emptyZip = new Uint8Array(22); // 仅仅是一个空的 EOCD
    expect(() => restoreKfBackup(emptyZip)).toThrow("缺少 manifest.json");
  });
});
