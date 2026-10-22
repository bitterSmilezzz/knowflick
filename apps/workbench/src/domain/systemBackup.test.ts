import { describe, expect, it } from "vitest";
import { createKfBackupArchive, restoreKfBackup, stripSecrets } from "./systemBackup";
import { cardFromJson } from "./card";
import type { RawMaterial, Artifact } from "../shell/store";
import type { SettingsFile } from "./settings";
import { defaultSettings, parseSettings } from "./settings";

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

describe("备份带走附件", () => {
  const settings: SettingsFile = { settings: { ...defaultSettings }, raw: {} };
  const audio = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0xff, 0xfe]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const material = (id: string, mediaPath: string): RawMaterial => ({
    id, sourceType: mediaPath.includes("audio") ? "audio" : "image",
    title: id, sourceUrl: null, rawText: "正文", contentHash: "", mediaPath,
    mediaSizeBytes: 8, metadataJson: "{}", inboxStatus: "inbox",
    createdAt: 1, updatedAt: 1,
  });

  it("附件字节原样往返，且不被文本解码搅坏", () => {
    const media = new Map<string, Uint8Array>([
      ["media/audio/a.webm", audio],
      ["media/image/b.png", png],
    ]);
    const archive = createKfBackupArchive(
      [material("m-audio", "media/audio/a.webm"), material("m-image", "media/image/b.png")],
      [], settings, [], media,
    );
    const restored = restoreKfBackup(archive);
    expect(restored.manifest.stats.media).toBe(2);
    expect(Array.from(restored.media.get("media/audio/a.webm") ?? [])).toEqual(Array.from(audio));
    expect(Array.from(restored.media.get("media/image/b.png") ?? [])).toEqual(Array.from(png));
  });

  it("拒绝备份包里的越界路径，不还原到 media 之外", () => {
    const media = new Map<string, Uint8Array>([
      ["media/audio/ok.webm", audio],
      ["../../etc/passwd", new Uint8Array([1, 2, 3])],
      ["notes/readme.txt", new Uint8Array([4, 5])],
    ]);
    const restored = restoreKfBackup(createKfBackupArchive([], [], settings, [], media));
    expect([...restored.media.keys()]).toEqual(["media/audio/ok.webm"]);
  });

  it("带全部字段取值的卡片与素材逐字段无损往返", () => {
    // 已有测试用的都是常见取值。这条专门用「边角取值」跑一遍：
    // 空字符串、负数、极值时间戳、含特殊字符的正文、null 与缺失的区别。
    // 备份的承诺是「无损」——字段一多，某个字段被悄悄丢掉就很难被发现。
    const edgeCard = cardFromJson({
      id: "card-edge-1",
      headline: "",
      summary: "含特殊字符 \"引号\" 与\t制表\n换行",
      details: "",
      category: "",
      tags: [],
      links: [],
      source: "seed",
      createdAt: 0,
      editedAt: null,
      seenAt: null,
      swiped: null,
      isFavorite: false,
      favoritedAt: null,
      reviewCount: 0,
      masteryLevel: 0,
      lastReviewedAt: null,
      repetition: 0,
      intervalDays: 0,
      easeFactor: 2.5,
      stability: 0,
      difficulty: 0,
      subject: null, branch: null, level: null, track: null, orderKey: null, prereq: [],
    });
    const edgeMaterial: RawMaterial = {
      id: "mat-edge-1",
      sourceType: "web",
      title: "",
      sourceUrl: null,
      rawText: "换行\n与制表\t以及\"引号\"",
      contentHash: "",
      mediaPath: null,
      mediaSizeBytes: 0,
      metadataJson: JSON.stringify({ from: "a@b.test", tags: ["x"] }),
      inboxStatus: "dismissed",
      createdAt: 0,
      updatedAt: 0,
    };
    const archive = createKfBackupArchive(
      [edgeMaterial],
      [edgeCard],
      { raw: { ...defaultSettings }, settings: defaultSettings },
      []
    );
    const restored = restoreKfBackup(archive);
    expect(restored.cards).toHaveLength(1);
    const card = restored.cards[0];
    expect(card.id).toBe("card-edge-1");
    expect(card.headline).toBe("");
    expect(card.summary).toBe(edgeCard.summary);
    expect(card.source).toBe("seed");
    expect(card.createdAt).toBe(0);
    expect(card.seenAt).toBeNull();
    expect(card.tags).toEqual([]);
    expect(card.prereq).toEqual([]);
    expect(restored.materials).toHaveLength(1);
    const material = restored.materials[0];
    expect(material.id).toBe("mat-edge-1");
    expect(material.title).toBe("");
    expect(material.sourceUrl).toBeNull();
    expect(material.rawText).toBe(edgeMaterial.rawText);
    expect(material.inboxStatus).toBe("dismissed");
    expect(material.metadataJson).toBe(edgeMaterial.metadataJson);
    expect(material.mediaPath).toBeNull();
  });

  it("备份包不带 settings.json 里遗留的密钥字段", () => {
    // 界面与文档都写着「.kfbackup 不含 API 密钥」。但 encodeSettings 会把
    // settings.json 的未知键原样带走——那份文件里若留着密钥（用户手改过、
    // 或旧版本写过），就会被打进用户会分享的包里。
    const raw = JSON.stringify({
      providerId: "openai", baseURL: "https://api.openai.com/v1", model: "gpt-4",
      apiKey: "sk-legacy-INSECURE-1234567890",
      api_key: "sk-legacy-2-INSECURE-0987654321",
      token: "legacy-token-abcdefghijklmnop",
      password: "hunter2",
    });
    const file = parseSettings(raw);
    const archive = createKfBackupArchive([], [], file, []);
    const text = new TextDecoder("latin1").decode(new Uint8Array(archive));
    expect(text).not.toContain("sk-legacy-INSECURE-1234567890");
    expect(text).not.toContain("sk-legacy-2-INSECURE-0987654321");
    expect(text).not.toContain("legacy-token-abcdefghijklmnop");
    expect(text).not.toContain("hunter2");
    // 正常的设置要留着——净化不能把该带的也删了
    expect(text).toContain("openai");
    expect(text).toContain("gpt-4");
  });

  it("stripSecrets 只认名字像密钥的键，不误删正常键", () => {
    const out = JSON.parse(stripSecrets(JSON.stringify({
      providerId: "openai",
      baseURL: "https://api.example.test/v1",
      model: "gpt-4",
      soundEffectsEnabled: true,
      // 名字里带 key 但是正常配置
      orderKey: "a-1",
      searchKeywords: ["复购", "留存"],
    }))) as Record<string, unknown>;
    expect(out.providerId).toBe("openai");
    expect(out.model).toBe("gpt-4");
    expect(out.soundEffectsEnabled).toBe(true);
    expect(out.searchKeywords).toEqual(["复购", "留存"]);
  });

  it("旧备份没有附件时 media 为空而不是报错", () => {
    const restored = restoreKfBackup(createKfBackupArchive([], [], settings, []));
    expect(restored.media.size).toBe(0);
    expect(restored.manifest.stats.media).toBe(0);
  });
});
