import { describe, expect, it } from "vitest";
import { createKfBackupArchive, legacyFnvChecksum, r4SourceBinding, restoreKfBackup, stripSecrets, unpackZipStoreBinary, type DeletedRecordsSnapshot, type MailSnapshot } from "./systemBackup";
import { sha256Hex } from "./sha256";
import { createZipArchive } from "./markdownExport";
import { createKnowledgeBase, createNoteDraft, emptyNotesState, upsertNote } from "./note";
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
    expect(restored.manifest.limitations?.[0]).toContain("项目、目标、个人画像");
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
    const files = unpackZipStoreBinary(createKfBackupArchive([], [], settings));
    files.set("../../etc/passwd", new Uint8Array([1, 2, 3]));
    const archive = createZipArchive([...files].map(([path, data]) => ({ path, data })));
    expect(() => restoreKfBackup(archive)).toThrow(/不支持的条目/);
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

describe("备份包 v2：笔记与知识库随包无损往返", () => {
  const sampleSettings: SettingsFile = { raw: {}, settings: { ...defaultSettings } };

  function buildNotes() {
    let state = emptyNotesState();
    const draft = createNoteDraft(1000);
    draft.title = "第一篇笔记";
    draft.bodyMd = "正文：关于北极项目的结论\n\n第二段：检索从这里命中";
    state = upsertNote(state, draft, 0, 1000).state;
    state = createKnowledgeBase(state, { id: "kb1", name: "项目 A", description: "范围" }, 1200);
    // 把 kb1 的成员关系构造成导出用的形状（noteId 在 upsert 后确定）
    const noteId = state.notes[0].id;
    const kbMembership = { [`kb1\n${noteId}`]: 1300 };
    return { state, noteId, kbMembership };
  }

  it("笔记正文、修订号、库与成员关系全部一致", () => {
    const { state, kbMembership } = buildNotes();
    const archive = createKfBackupArchive([], [], sampleSettings, [], new Map(), state.notes, state.knowledgeBases, kbMembership);
    const restored = restoreKfBackup(archive);

    expect(restored.manifest.schemaVersion).toBe(4);
    expect(restored.notes).toHaveLength(1);
    expect(restored.notes[0].title).toBe("第一篇笔记");
    expect(restored.notes[0].bodyMd).toContain("北极项目");
    expect(restored.notes[0].currentRevision).toBe(1);
    expect(restored.knowledgeBases).toHaveLength(1);
    expect(restored.knowledgeBases[0].name).toBe("项目 A");
    expect(Object.keys(restored.kbMembership)).toHaveLength(1);
  });

  it("真正的 v1 ZIP 包（无 notes.json）恢复为空集，不报错", () => {
    // 审计要求：v1 用例必须真构造 v1 文件集，不能用「v2 空 notes」代替。
    // v1 特征：schemaVersion 1、FNV 校验和、没有 notes/knowledge_bases 两个文件。
    const cardsStr = "[]";
    const materialsStr = "[]";
    const settingsStr = JSON.stringify(sampleSettings);
    const manifest = {
      format: "knowflick-backup",
      schemaVersion: 1,
      appName: "KnowFlick",
      appVersion: "0.1.0",
      exportedAt: 1,
      exportedAtIso: new Date(1).toISOString(),
      stats: { cards: 0, materials: 0, artifacts: 0, media: 0 },
      checksums: {
        "cards.json": legacyFnvChecksum(cardsStr),
        "materials.json": legacyFnvChecksum(materialsStr),
        "settings.json": legacyFnvChecksum(settingsStr),
        "artifacts.json": legacyFnvChecksum("[]"),
      },
    };
    const legacyZip = createZipArchive([
      { path: "manifest.json", data: JSON.stringify(manifest) },
      { path: "cards.json", data: cardsStr },
      { path: "materials.json", data: materialsStr },
      { path: "settings.json", data: settingsStr },
      { path: "artifacts.json", data: "[]" },
    ]);
    const restored = restoreKfBackup(legacyZip);
    expect(restored.manifest.schemaVersion).toBe(1);
    expect(restored.notes).toHaveLength(0);
    expect(restored.knowledgeBases).toHaveLength(0);
    expect(restored.cards).toHaveLength(0);
  });

  it("篡改 notes.json 的备份包在恢复前被整体拒绝", () => {
    const { state, kbMembership } = buildNotes();
    const archive = createKfBackupArchive([], [], sampleSettings, [], new Map(), state.notes, state.knowledgeBases, kbMembership);
    // 用「checksum 对应另一份内容」的方式模拟包内文件被改
    const files = unpackZipStoreBinary(archive);
    const tampered = new Map(files);
    tampered.set("notes.json", new TextEncoder().encode('[{"id":"x","title":"被换掉的内容"}]'));
    const rebuilt = createZipArchive([...tampered].map(([path, data]) => ({ path, data })));
    expect(() => restoreKfBackup(rebuilt)).toThrow(/notes\.json/);
  });

  it("v4 检查附件原始字节与必需校验和；旧 v3 未校验附件被标记", () => {
    const name = "media/image/sample.png";
    const files = unpackZipStoreBinary(createKfBackupArchive([], [], sampleSettings, [], new Map([[name, new Uint8Array([0, 255, 129, 128])]])));
    const makeZip = (items: Map<string, Uint8Array>) => createZipArchive([...items].map(([path, data]) => ({ path, data })));
    expect(restoreKfBackup(makeZip(files)).uncheckedMediaPaths).toEqual([]);
    const corrupt = new Map(files); corrupt.set(name, new Uint8Array([0, 255, 129, 129]));
    expect(() => restoreKfBackup(makeZip(corrupt))).toThrow(/sample\.png.*校验和不匹配/);
    const missingChecksum = new Map(files);
    const manifest = JSON.parse(new TextDecoder().decode(files.get("manifest.json")));
    delete manifest.checksums[name];
    missingChecksum.set("manifest.json", new TextEncoder().encode(JSON.stringify(manifest)));
    expect(() => restoreKfBackup(makeZip(missingChecksum))).toThrow(/附件 SHA-256 校验和缺失/);
    manifest.schemaVersion = 3;
    missingChecksum.set("manifest.json", new TextEncoder().encode(JSON.stringify(manifest)));
    expect(restoreKfBackup(makeZip(missingChecksum)).uncheckedMediaPaths).toEqual([name]);
    manifest.schemaVersion = 4;
    delete manifest.checksums["notes.json"];
    missingChecksum.set("manifest.json", new TextEncoder().encode(JSON.stringify(manifest)));
    expect(() => restoreKfBackup(makeZip(missingChecksum))).toThrow(/notes\.json.*校验和缺失/);
  });

  it("v4 附件被移除或路径不受支持时拒绝", () => {
    const name = "media/image/a.png";
    const files = unpackZipStoreBinary(createKfBackupArchive([], [], sampleSettings, [], new Map([[name, new Uint8Array([1])]])));
    files.delete(name);
    const zip = createZipArchive([...files].map(([path, data]) => ({ path, data })));
    expect(() => restoreKfBackup(zip)).toThrow(/a\.png/);
    expect(() => createKfBackupArchive([], [], sampleSettings, [], new Map([["../outside", new Uint8Array([1])]]))).toThrow(/附件路径无效/);
  });

  it("v2 旧包（FNV 校验和）被篡改同样拒绝——兼容不豁免", () => {
    const cardsStr = "[]";
    const materialsStr = "[]";
    const notesStr = JSON.stringify([{ id: "n1", title: "v2 笔记" }]);
    const kbsStr = JSON.stringify({ knowledgeBases: [], membership: {} });
    // manifest 的 notes.json 校验和按「旧内容」算，包里放「新内容」→ 篡改
    const manifest = {
      format: "knowflick-backup",
      schemaVersion: 2,
      appName: "KnowFlick",
      appVersion: "0.1.0",
      exportedAt: 1,
      exportedAtIso: new Date(1).toISOString(),
      stats: { cards: 0, materials: 0, artifacts: 0, media: 0, notes: 1, knowledgeBases: 0 },
      checksums: {
        "cards.json": legacyFnvChecksum(cardsStr),
        "materials.json": legacyFnvChecksum(materialsStr),
        "notes.json": legacyFnvChecksum('{"被篡改前的内容": true}'),
        "knowledge_bases.json": legacyFnvChecksum(kbsStr),
      },
    };
    const v2Zip = createZipArchive([
      { path: "manifest.json", data: JSON.stringify(manifest) },
      { path: "cards.json", data: cardsStr },
      { path: "materials.json", data: materialsStr },
      { path: "notes.json", data: notesStr },
      { path: "knowledge_bases.json", data: kbsStr },
    ]);
    expect(() => restoreKfBackup(v2Zip)).toThrow(/notes\.json/);
  });

  it("v2+ 包缺 notes.json：结构不完整，拒绝恢复", () => {
    const zip = createZipArchive([
      { path: "manifest.json", data: JSON.stringify({
        format: "knowflick-backup", schemaVersion: 2, appName: "KnowFlick", appVersion: "0.1.0",
        exportedAt: 1, exportedAtIso: new Date(1).toISOString(),
        stats: { cards: 0, materials: 0, artifacts: 0, media: 0, notes: 0, knowledgeBases: 0 },
        checksums: {},
      }) },
      { path: "cards.json", data: "[]" },
      { path: "materials.json", data: "[]" },
    ]);
    expect(() => restoreKfBackup(zip)).toThrow(/notes\.json/);
  });

  it("manifest 计数与包内实际不一致：拒绝恢复", () => {
    const notesStr = JSON.stringify([{ id: "n1" }, { id: "n2" }]);
    const files = unpackZipStoreBinary(createKfBackupArchive([], [], sampleSettings));
    const manifest = JSON.parse(new TextDecoder().decode(files.get("manifest.json")));
    manifest.stats.notes = 5;
    manifest.checksums["notes.json"] = `sha256:${sha256Hex(notesStr)}`;
    files.set("manifest.json", new TextEncoder().encode(JSON.stringify(manifest)));
    files.set("notes.json", new TextEncoder().encode(notesStr));
    const zip = createZipArchive([...files].map(([path, data]) => ({ path, data })));
    expect(() => restoreKfBackup(zip)).toThrow(/notes 声称 5 条、包里实际 2 条/);
  });

  it("截断的包：拒绝恢复，不把半截附件写进库", () => {
    const { state, kbMembership } = buildNotes();
    // 末尾是附件条目：切进它的数据内部，而不是只切掉尾部目录结构
    const bigMedia = new Map([["media/image/big.bin", new Uint8Array(4096).fill(7)]]);
    const archive = createKfBackupArchive([], [], sampleSettings, [], bigMedia, state.notes, state.knowledgeBases, kbMembership);
    const truncated = archive.slice(0, archive.length - 600);
    expect(() => restoreKfBackup(truncated)).toThrow(/截断/);
  });

  it("重复条目的包：拒绝恢复", () => {
    const files = unpackZipStoreBinary(
      createKfBackupArchive([], [], sampleSettings, [], new Map(), [], [], {})
    );
    const entries = [...files].map(([path, data]) => ({ path, data }));
    entries.push({ path: "cards.json", data: new TextEncoder().encode("[]") });
    const duplicated = createZipArchive(entries);
    expect(() => restoreKfBackup(duplicated)).toThrow(/重复条目/);
  });

  it("未知未来版本：拒绝并说明支持的版本", () => {
    const zip = createZipArchive([
      { path: "manifest.json", data: JSON.stringify({
        format: "knowflick-backup", schemaVersion: 99, appName: "KnowFlick", appVersion: "9.9.9",
        exportedAt: 1, exportedAtIso: new Date(1).toISOString(), stats: {}, checksums: {},
      }) },
      { path: "cards.json", data: "[]" },
      { path: "materials.json", data: "[]" },
      { path: "notes.json", data: "[]" },
      { path: "knowledge_bases.json", data: "{}" },
    ]);
    expect(() => restoreKfBackup(zip)).toThrow(/不支持的备份包版本 99/);
  });

  it("v5 打包项目和画像并对文件与各表数量校验", () => {
    const r4 = { version: 1, tables: { projects: [{ id: "p1" }], goals: [], profile_claims: [], profile_denials: [], project_members: [], goal_evidence: [] }, note_bindings: {}, evidence_bindings: {}, profile_bindings: {} };
    const archive = createKfBackupArchive([], [], sampleSettings, [], new Map(), [], [], {}, r4);
    const restored = restoreKfBackup(archive);
    expect(restored.manifest.schemaVersion).toBe(5);
    expect(restored.r4).toEqual(r4);
    expect(restored.manifest.stats.r4?.projects).toBe(1);
    const files = unpackZipStoreBinary(archive);
    files.set("r4.json", new TextEncoder().encode("{}"));
    expect(() => restoreKfBackup(createZipArchive([...files].map(([path, data]) => ({ path, data }))))).toThrow(/r4\.json/);
    const files2 = unpackZipStoreBinary(archive);
    const manifest = JSON.parse(new TextDecoder().decode(files2.get("manifest.json")));
    manifest.stats.r4.projects = 2;
    files2.set("manifest.json", new TextEncoder().encode(JSON.stringify(manifest)));
    expect(() => restoreKfBackup(createZipArchive([...files2].map(([path, data]) => ({ path, data }))))).toThrow(/数量不匹配/);
    files2.delete("r4.json");
    expect(() => restoreKfBackup(createZipArchive([...files2].map(([path, data]) => ({ path, data }))))).toThrow(/r4\.json/);
  });

  it("关联原件按证据类型和明确的缺失状态取得保护指纹", () => {
    const snapshot = { note_bindings: { n1: "note-hash" }, evidence_bindings: { "material\nm1": "hash" }, profile_bindings: { c1: { material: null, card: "card-hash" } } };
    expect(r4SourceBinding(snapshot, "material", "m1")).toEqual({ protected: true, fingerprint: "hash" });
    expect(r4SourceBinding(snapshot, "card", "c1")).toEqual({ protected: true, fingerprint: "card-hash" });
    expect(r4SourceBinding(snapshot, "material", "c1")).toEqual({ protected: true, fingerprint: null });
    expect(r4SourceBinding(snapshot, "card", "__proto__")).toEqual({ protected: false, fingerprint: null });
    expect(r4SourceBinding(snapshot, "note", "n1")).toEqual({ protected: true, fingerprint: "note-hash" });
  });

  it("v6 保存历史修订，缺少项目快照时仍保留历史并正确校验", () => {
    const { state } = buildNotes();
    const note = { ...state.notes[0], currentRevision: 2 };
    const history = [
      { noteId: note.id, revision: 1, title: "初稿", bodyMd: "![旧图](media/image/old.png)", savedAt: 10 },
      { noteId: note.id, revision: 2, title: note.title, bodyMd: note.bodyMd, savedAt: 20 },
    ];
    const archive = createKfBackupArchive([], [], sampleSettings, [], new Map([["media/image/old.png", new Uint8Array([1, 2])]]), [note], [], {}, null, history);
    const restored = restoreKfBackup(archive);
    expect(restored.manifest.schemaVersion).toBe(6);
    expect(restored.r4).toBeUndefined();
    expect(restored.noteRevisions).toEqual(history);
    expect(restored.manifest.stats.noteRevisions).toBe(2);
    expect(restored.manifest.limitations?.[0]).toContain("项目、目标、个人画像");
    const files = unpackZipStoreBinary(archive);
    files.set("note_revisions.json", new TextEncoder().encode("[]"));
    expect(() => restoreKfBackup(createZipArchive([...files].map(([path, data]) => ({ path, data }))))).toThrow(/note_revisions\.json/);
    const files2 = unpackZipStoreBinary(archive);
    const manifest = JSON.parse(new TextDecoder().decode(files2.get("manifest.json")));
    manifest.stats.noteRevisions = 3;
    files2.set("manifest.json", new TextEncoder().encode(JSON.stringify(manifest)));
    expect(() => restoreKfBackup(createZipArchive([...files2].map(([path, data]) => ({ path, data })) ))).toThrow(/历史修订数量不匹配/);
    expect(() => createKfBackupArchive([], [], sampleSettings, [], new Map(), [note], [], {}, null, [...history, history[0]])).toThrow(/引用或修订号/);
    expect(() => createKfBackupArchive([], [], sampleSettings, [], new Map(), [note], [], {}, null, [{ ...history[1], bodyMd: "错误正文" }])).toThrow(/不一致/);
    const files3 = unpackZipStoreBinary(archive);
    const forgedHistory = JSON.stringify([{ ...history[0], noteId: "不存在的笔记" }]);
    const forgedManifest = JSON.parse(new TextDecoder().decode(files3.get("manifest.json")));
    forgedManifest.checksums["note_revisions.json"] = `sha256:${sha256Hex(forgedHistory)}`;
    forgedManifest.stats.noteRevisions = 1;
    files3.set("manifest.json", new TextEncoder().encode(JSON.stringify(forgedManifest)));
    files3.set("note_revisions.json", new TextEncoder().encode(forgedHistory));
    expect(() => restoreKfBackup(createZipArchive([...files3].map(([path, data]) => ({ path, data }))))).toThrow(/引用或修订号/);
  });
  it("v6 同时保留项目快照和笔记历史", () => {
    const { state } = buildNotes();
    const note = state.notes[0];
    const history = [{ noteId: note.id, revision: 1, title: note.title, bodyMd: note.bodyMd, savedAt: 1000 }];
    const r4 = { version: 1, tables: { projects: [], goals: [], profile_claims: [], profile_denials: [], project_members: [], goal_evidence: [] }, note_bindings: {}, evidence_bindings: {}, profile_bindings: {} };
    const result = restoreKfBackup(createKfBackupArchive([], [], sampleSettings, [], new Map(), [note], [], {}, r4, history));
    expect(result.manifest.schemaVersion).toBe(6);
    expect(result.r4).toEqual(r4);
    expect(result.noteRevisions).toEqual(history);
    expect(result.manifest.limitations?.[0]).not.toContain("笔记历史版本");
  });
  it("v7 对订阅记录、遗漏数量和校验和进行版本化往返", () => {
    const subscriptions = { version: 1 as const, items: [{ id: "s1", type: "rss", title: "订阅", targetUrl: "https://example.org/feed", intervalMinutes: 60, lastPolledAt: 123, isActive: true, createdAt: 10 }], excludedCount: 1 };
    const archive = createKfBackupArchive([], [], sampleSettings, [], new Map(), [], [], {}, null, [], subscriptions);
    const restored = restoreKfBackup(archive);
    expect(restored.manifest.schemaVersion).toBe(7);
    expect(restored.subscriptions).toEqual(subscriptions);
    expect(restored.manifest.stats.subscriptions).toBe(1);
    expect(restored.manifest.limitations?.join("；")).toContain("1 条订阅");
    const files = unpackZipStoreBinary(archive);
    files.set("subscriptions.json", new TextEncoder().encode("{}"));
    expect(() => restoreKfBackup(createZipArchive([...files].map(([path, data]) => ({ path, data })) ))).toThrow(/subscriptions\.json/);
    const files2 = unpackZipStoreBinary(archive);
    const manifest = JSON.parse(new TextDecoder().decode(files2.get("manifest.json")));
    manifest.stats.subscriptionsExcluded = 2;
    files2.set("manifest.json", new TextEncoder().encode(JSON.stringify(manifest)));
    expect(() => restoreKfBackup(createZipArchive([...files2].map(([path, data]) => ({ path, data })) ))).toThrow(/订阅快照数量不匹配/);
    expect(() => createKfBackupArchive([], [], sampleSettings, [], new Map(), [], [], {}, null, [], { ...subscriptions, items: [...subscriptions.items, subscriptions.items[0]] })).toThrow(/无效或重复/);
    expect(() => createKfBackupArchive([], [], sampleSettings, [], new Map(), [], [], {}, null, [], { ...subscriptions, items: [{ ...subscriptions.items[0], targetUrl: "https://example.org/feed?token=PRIVATE-SECRET" }] })).toThrow(/无效或重复/);
  });

  it("v8 往返邮箱游标与去重记录，不带密码并验证素材绑定", () => {
    const subscriptions = { version: 1 as const, items: [], excludedCount: 0 };
    const material: RawMaterial = { id: "mail-material-1", sourceType: "email", title: "邮件正文", sourceUrl: null, rawText: "邮件文本", contentHash: "mail-hash", metadataJson: "{}", inboxStatus: "inbox", createdAt: 10, updatedAt: 11 };
    const fingerprint = sha256Hex(JSON.stringify([
      material.id, material.sourceType, material.title, material.sourceUrl ?? null,
      material.rawText, material.cleanedMarkdown ?? null, material.contentHash,
      material.mediaPath ?? null, material.mediaSizeBytes ?? 0, material.metadataJson,
      material.inboxStatus, material.createdAt, material.updatedAt, 0,
    ]));
    const accountId = "00000000-0000-4000-8000-000000000001";
    const mail: MailSnapshot = {
      version: 1,
      accounts: [{ config: { id: accountId, name: "工作邮箱", email: "reader@example.org", host: "imap.example.org", port: 993, username: "reader", folder: "INBOX", syncLimit: 50, syncIntervalMinutes: 0 }, createdAt: 10, lastSyncAt: 20, uidValidity: 7, lastUid: 9 }],
      syncStates: [{ accountId, historyBefore: 1, historyComplete: false, lastAttemptAt: 19 }, { accountId: "00000000-0000-4000-8000-000000000002", historyBefore: null, historyComplete: true, lastAttemptAt: null }],
      imports: [{ accountId, folder: "INBOX", uidValidity: 7, uid: 9, messageId: "<mail@example.org>", materialId: material.id }],
      rejected: [{ accountId, folder: "INBOX", uidValidity: 7, uid: 8, reason: "邮件大小超过导入上限", rejectedAt: 18 }],
      materialBindings: { [material.id]: { state: "active", fingerprint } },
    };
    const archive = createKfBackupArchive([material], [], sampleSettings, [], new Map(), [], [], {}, null, [], subscriptions, mail);
    const restored = restoreKfBackup(archive);
    expect(restored.manifest.schemaVersion).toBe(8);
    expect(restored.mail).toEqual(mail);
    expect(restored.manifest.stats.mailAccounts).toBe(1);
    expect(restored.manifest.stats.mailImports).toBe(1);
    expect(restored.reviewHistory).toBeUndefined();
    expect(restored.manifest.limitations?.join("；")).toContain("邮箱密码");
    expect(new TextDecoder().decode(unpackZipStoreBinary(archive).get("mail.json")!)).not.toContain("password");
    expect(() => createKfBackupArchive([material], [], sampleSettings, [], new Map(), [], [], {}, null, [], subscriptions, {
      ...mail,
      materialBindings: { [material.id]: { state: "active", fingerprint: "0".repeat(64) } },
    })).toThrow(/素材与备份正文不一致/);
    expect(() => createKfBackupArchive([{ ...material, sourceType: "manual" }], [], sampleSettings, [], new Map(), [], [], {}, null, [], subscriptions, mail)).toThrow(/素材与备份正文不一致/);

    const files = unpackZipStoreBinary(archive);
    files.delete("mail.json");
    expect(() => restoreKfBackup(createZipArchive([...files].map(([path, data]) => ({ path, data }))))).toThrow(/mail\.json/);
    const files2 = unpackZipStoreBinary(archive);
    const manifest = JSON.parse(new TextDecoder().decode(files2.get("manifest.json")));
    manifest.stats.mailRejected = 3;
    files2.set("manifest.json", new TextEncoder().encode(JSON.stringify(manifest)));
    expect(() => restoreKfBackup(createZipArchive([...files2].map(([path, data]) => ({ path, data }))))).toThrow(/邮箱备份快照数量不匹配/);
  });

  it("v9 原子携带逐次复习历史并校验覆盖边界与事件数量", () => {
    const noteHistory: NonNullable<Parameters<typeof createKfBackupArchive>[9]> = [];
    const subscriptions = { version: 1 as const, items: [], excludedCount: 0 };
    const mail: MailSnapshot = { version: 1, accounts: [], syncStates: [], imports: [], rejected: [], materialBindings: {} };
    const reviewHistory = { version: 1 as const, coverageStartedAt: 1234, events: [] };
    const archive = createKfBackupArchive([], [], sampleSettings, [], new Map(), [], [], {}, null, noteHistory, subscriptions, mail, reviewHistory);
    const restored = restoreKfBackup(archive);
    expect(restored.manifest.schemaVersion).toBe(9);
    expect(restored.reviewHistory).toEqual(reviewHistory);
    expect(restored.manifest.stats.reviewEvents).toBe(0);
    expect(restored.manifest.limitations?.join("；")).toContain("覆盖起点之前的复习不补造");
    const files = unpackZipStoreBinary(archive);
    expect(files.has("review_history.json")).toBe(true);
    expect(restored.manifest.checksums["review_history.json"]).toMatch(/^sha256:[0-9a-f]{64}$/);

    const missingFile = unpackZipStoreBinary(archive);
    missingFile.delete("review_history.json");
    expect(() => restoreKfBackup(createZipArchive([...missingFile].map(([path, data]) => ({ path, data }))))).toThrow(/review_history\.json/);

    const wrongCount = unpackZipStoreBinary(archive);
    const manifest = JSON.parse(new TextDecoder().decode(wrongCount.get("manifest.json")!));
    manifest.stats.reviewEvents = 1;
    wrongCount.set("manifest.json", new TextEncoder().encode(JSON.stringify(manifest)));
    expect(() => restoreKfBackup(createZipArchive([...wrongCount].map(([path, data]) => ({ path, data }))))).toThrow(/逐次复习事件数量不匹配/);

    expect(() => createKfBackupArchive([], [], sampleSettings, [], new Map(), [], [], {}, null, noteHistory, subscriptions, null, reviewHistory)).toThrow(/需要邮箱、订阅与笔记历史快照/);
    const duplicateEvent = { id: "00000000-0000-4000-8000-000000000001", cardId: "card-1", reviewedAt: 100, rating: "good" as const, algorithm: "fsrs" as const, projectIds: [], projectAttributionComplete: true };
    expect(() => createKfBackupArchive([], [], sampleSettings, [], new Map(), [], [], {}, null, noteHistory, subscriptions, mail, { ...reviewHistory, events: [duplicateEvent, duplicateEvent] })).toThrow(/重复事件标识/);
  });

  it("v10 携带已校验的搜索历史并拒绝缺失、篡改或数量不符", () => {
    const noteHistory: NonNullable<Parameters<typeof createKfBackupArchive>[9]> = [];
    const subscriptions = { version: 1 as const, items: [], excludedCount: 0 };
    const mail: MailSnapshot = { version: 1, accounts: [], syncStates: [], imports: [], rejected: [], materialBindings: {} };
    const reviewHistory = { version: 1 as const, coverageStartedAt: 1234, events: [] };
    const searchHistory = ["sqlite index", "复习计划"];
    const archive = createKfBackupArchive([], [], sampleSettings, [], new Map(), [], [], {}, null, noteHistory, subscriptions, mail, reviewHistory, searchHistory);
    const restored = restoreKfBackup(archive);
    expect(restored.manifest.schemaVersion).toBe(10);
    expect(restored.searchHistory).toEqual(searchHistory);
    expect(restored.manifest.stats.searchHistory).toBe(2);
    expect(restored.manifest.limitations?.join("；")).not.toContain("不含搜索历史");
    expect(restored.manifest.limitations?.join("；")).toContain("搜索历史、附件和设置分别从数据库之外读取");
    const files = unpackZipStoreBinary(archive);
    expect(new TextDecoder().decode(files.get("search_history.json"))).toBe(JSON.stringify(searchHistory, null, 2));
    expect(restored.manifest.checksums["search_history.json"]).toMatch(/^sha256:[0-9a-f]{64}$/);

    const missingFile = unpackZipStoreBinary(archive);
    missingFile.delete("search_history.json");
    expect(() => restoreKfBackup(createZipArchive([...missingFile].map(([path, data]) => ({ path, data }))))).toThrow(/search_history\.json/);

    const wrongCount = unpackZipStoreBinary(archive);
    const wrongCountManifest = JSON.parse(new TextDecoder().decode(wrongCount.get("manifest.json")!));
    wrongCountManifest.stats.searchHistory = 1;
    wrongCount.set("manifest.json", new TextEncoder().encode(JSON.stringify(wrongCountManifest)));
    expect(() => restoreKfBackup(createZipArchive([...wrongCount].map(([path, data]) => ({ path, data }))))).toThrow(/搜索历史数量不匹配/);

    const tampered = unpackZipStoreBinary(archive);
    tampered.set("search_history.json", new TextEncoder().encode('["tampered"]'));
    expect(() => restoreKfBackup(createZipArchive([...tampered].map(([path, data]) => ({ path, data }))))).toThrow(/search_history\.json.*校验和不匹配/);
    const malformed = unpackZipStoreBinary(archive);
    const privateTerm = "private query must not appear";
    const malformedHistory = `not-json ${privateTerm}`;
    malformed.set("search_history.json", new TextEncoder().encode(malformedHistory));
    const malformedManifest = JSON.parse(new TextDecoder().decode(malformed.get("manifest.json")!));
    malformedManifest.checksums["search_history.json"] = `sha256:${sha256Hex(malformedHistory)}`;
    malformed.set("manifest.json", new TextEncoder().encode(JSON.stringify(malformedManifest)));
    try {
      restoreKfBackup(createZipArchive([...malformed].map(([path, data]) => ({ path, data }))));
      throw new Error("expected invalid search history rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("搜索历史快照格式无效");
      expect((error as Error).message).not.toContain(privateTerm);
    }
    expect(() => createKfBackupArchive([], [], sampleSettings, [], new Map(), [], [], {}, null, noteHistory, subscriptions, mail, reviewHistory, ["duplicate", "duplicate"])).toThrow(/搜索历史快照包含重复/);
    expect(() => createKfBackupArchive([], [], sampleSettings, [], new Map(), [], [], {}, null, noteHistory, subscriptions, mail, null, searchHistory)).toThrow(/搜索历史备份需要 v9 前置快照/);
  });

  it("浏览器 v12 单独携带搜索历史并校验 profile、文件和数量", () => {
    const searchHistory = ["本地索引", "知识库搜索"];
    const archive = createKfBackupArchive([], [], sampleSettings, [], new Map(), [], [], {}, null, null, null, null, null, null, null, searchHistory);
    const restored = restoreKfBackup(archive);
    expect(restored.manifest.schemaVersion).toBe(12);
    expect(restored.manifest.profile).toBe("browser");
    expect(restored.searchHistory).toEqual(searchHistory);
    expect(restored.manifest.stats.searchHistory).toBe(2);
    expect(restored.manifest.limitations?.[0]).toContain("浏览器备份包含最近搜索历史");
    const files = unpackZipStoreBinary(archive);
    expect(new TextDecoder().decode(files.get("browser_search_history.json"))).toBe(JSON.stringify(searchHistory, null, 2));
    expect(restored.manifest.checksums["browser_search_history.json"]).toMatch(/^sha256:[0-9a-f]{64}$/);

    const withoutProfile = unpackZipStoreBinary(archive);
    const manifest = JSON.parse(new TextDecoder().decode(withoutProfile.get("manifest.json")!));
    delete manifest.profile;
    withoutProfile.set("manifest.json", new TextEncoder().encode(JSON.stringify(manifest)));
    expect(() => restoreKfBackup(createZipArchive([...withoutProfile].map(([path, data]) => ({ path, data }))))).toThrow(/不支持的备份包版本 12/);

    const missingFile = unpackZipStoreBinary(archive);
    missingFile.delete("browser_search_history.json");
    expect(() => restoreKfBackup(createZipArchive([...missingFile].map(([path, data]) => ({ path, data }))))).toThrow(/browser_search_history\.json/);

    const tampered = unpackZipStoreBinary(archive);
    tampered.set("browser_search_history.json", new TextEncoder().encode('["changed"]'));
    expect(() => restoreKfBackup(createZipArchive([...tampered].map(([path, data]) => ({ path, data }))))).toThrow(/browser_search_history\.json.*校验和不匹配/);

    const wrongCount = unpackZipStoreBinary(archive);
    const wrongCountManifest = JSON.parse(new TextDecoder().decode(wrongCount.get("manifest.json")!));
    wrongCountManifest.stats.searchHistory = 1;
    wrongCount.set("manifest.json", new TextEncoder().encode(JSON.stringify(wrongCountManifest)));
    expect(() => restoreKfBackup(createZipArchive([...wrongCount].map(([path, data]) => ({ path, data }))))).toThrow(/搜索历史数量不匹配/);
  });

  it("v11 携带软删除原件与删除时间，严格核对回收站数量", () => {
    const noteHistory: NonNullable<Parameters<typeof createKfBackupArchive>[9]> = [];
    const subscriptions = { version: 1 as const, items: [], excludedCount: 0 };
    const mail: MailSnapshot = { version: 1, accounts: [], syncStates: [], imports: [], rejected: [], materialBindings: {} };
    const reviewHistory = { version: 1 as const, coverageStartedAt: 1234, events: [] };
    const searchHistory: string[] = [];
    const deletedRecords: DeletedRecordsSnapshot = {
      version: 1,
      materials: [{ material: {
        id: "deleted-material", sourceType: "manual", title: "回收站素材", sourceUrl: null,
        rawText: "保留已删除原件", cleanedMarkdown: null, contentHash: "source-hash", mediaPath: null,
        mediaSizeBytes: 0, metadataJson: "{}", inboxStatus: "processed", createdAt: 10, updatedAt: 11,
      }, deletedAt: 12 }],
      cards: [{ card: cardFromJson({
        id: "deleted-card", materialId: "deleted-material", category: "架构", headline: "回收站卡片",
        summary: "摘要", details: "正文", links: [], tags: [], source: "imported", createdAt: 10,
        editedAt: null, seenAt: null, swiped: null, isFavorite: false, favoritedAt: null, reviewCount: 0,
        masteryLevel: 0, lastReviewedAt: null, repetition: 0, intervalDays: 1, easeFactor: 2.5,
        stability: 0, difficulty: 0, subject: null, branch: null, level: null, track: null, orderKey: null, prereq: [],
      }), deletedAt: 13 }],
      artifacts: [{ id: "deleted-artifact", artifactType: "briefing", title: "已删除简报", contentMarkdown: "# 已删除",
        sourceCardIds: ["deleted-card"], sourceNoteIds: [], dateScopeStart: null, dateScopeEnd: null,
        createdAt: 10, updatedAt: 14, isDeleted: true }],
    };
    const activeMaterial: RawMaterial = {
      id: "active-material", sourceType: "manual", title: "活动素材", sourceUrl: null,
      rawText: "仍在库中的原件", cleanedMarkdown: null, contentHash: "active-hash", mediaPath: null,
      mediaSizeBytes: 0, metadataJson: "{}", inboxStatus: "processed", createdAt: 10, updatedAt: 11,
    };
    const archive = createKfBackupArchive([], [], sampleSettings, [], new Map(), [], [], {}, null, noteHistory, subscriptions, mail, reviewHistory, searchHistory, deletedRecords);
    const restored = restoreKfBackup(archive);
    expect(restored.manifest.schemaVersion).toBe(11);
    expect(restored.deletedRecords?.materials[0].deletedAt).toBe(12);
    expect(restored.deletedRecords?.materials[0].material.rawText).toBe("保留已删除原件");
    expect(restored.deletedRecords?.cards[0].card.materialId).toBe("deleted-material");
    expect(restored.deletedRecords?.cards[0].card.createdAt).toBe(deletedRecords.cards[0].card.createdAt);
    expect(restored.deletedRecords?.artifacts[0].isDeleted).toBe(true);
    expect(restored.manifest.stats.deletedMaterials).toBe(1);
    expect(restored.manifest.stats.deletedCards).toBe(1);
    expect(restored.manifest.stats.deletedArtifacts).toBe(1);

    const legacyFiles = unpackZipStoreBinary(archive);
    legacyFiles.delete("search_history.json");
    const packLegacyFiles = () => createZipArchive([...legacyFiles].map(([path, data]) => ({ path, data })));
    expect(() => restoreKfBackup(packLegacyFiles())).toThrow(/search_history[.]json/);
    const legacyManifest = JSON.parse(new TextDecoder().decode(legacyFiles.get("manifest.json")!));
    delete legacyManifest.checksums["search_history.json"];
    delete legacyManifest.stats.searchHistory;
    legacyFiles.set("manifest.json", new TextEncoder().encode(JSON.stringify(legacyManifest)));
    const legacy = restoreKfBackup(packLegacyFiles());
    expect(legacy.searchHistory).toBeUndefined();
    expect(legacy.deletedRecords?.materials[0].material.id).toBe("deleted-material");
    expect(restored.manifest.limitations?.join("；")).not.toContain("已删除的素材");

    const deletedMaterial = deletedRecords.materials[0].material;
    const deletedMailFingerprint = sha256Hex(JSON.stringify([
      deletedMaterial.id, deletedMaterial.sourceType, deletedMaterial.title, deletedMaterial.sourceUrl ?? null,
      deletedMaterial.rawText, deletedMaterial.cleanedMarkdown ?? null, deletedMaterial.contentHash,
      deletedMaterial.mediaPath ?? null, deletedMaterial.mediaSizeBytes ?? 0, deletedMaterial.metadataJson,
      deletedMaterial.inboxStatus, deletedMaterial.createdAt, deletedMaterial.updatedAt, 1,
    ]));
    const mailAccountId = "123e4567-e89b-42d3-a456-426614174000";
    const mailWithDeletedSource: MailSnapshot = {
      ...mail,
      accounts: [{ config: { id: mailAccountId, name: "测试邮箱", email: "reader@example.test", host: "imap.example.test", port: 993, username: "reader", folder: "INBOX", syncLimit: 50, syncIntervalMinutes: 0 }, createdAt: 1, lastSyncAt: null, uidValidity: 1, lastUid: 1 }],
      syncStates: [{ accountId: mailAccountId, historyBefore: null, historyComplete: false, lastAttemptAt: null }],
      imports: [{ accountId: mailAccountId, folder: "INBOX", uidValidity: 1, uid: 1, messageId: "deleted-source@example.test", materialId: deletedMaterial.id }],
      materialBindings: { [deletedMaterial.id]: { state: "deleted", fingerprint: deletedMailFingerprint } },
    };
    const mailArchive = createKfBackupArchive([], [], sampleSettings, [], new Map(), [], [], {}, null, noteHistory, subscriptions, mailWithDeletedSource, reviewHistory, searchHistory, deletedRecords);
    expect(restoreKfBackup(mailArchive).manifest.limitations?.join("；")).not.toContain("原件未纳入本包");
    expect(() => createKfBackupArchive([], [], sampleSettings, [], new Map(), [], [], {}, null, noteHistory, subscriptions, mailWithDeletedSource, reviewHistory, searchHistory, {
      ...deletedRecords,
      materials: [{ ...deletedRecords.materials[0], material: { ...deletedMaterial, rawText: "被篡改的回收站正文" } }],
    })).toThrow(/邮件素材指纹与回收站原件不一致/);

    const wrongCount = unpackZipStoreBinary(archive);
    const manifest = JSON.parse(new TextDecoder().decode(wrongCount.get("manifest.json")!));
    manifest.stats.deletedCards = 0;
    wrongCount.set("manifest.json", new TextEncoder().encode(JSON.stringify(manifest)));
    expect(() => restoreKfBackup(createZipArchive([...wrongCount].map(([path, data]) => ({ path, data }))))).toThrow(/回收站快照数量不匹配/);

    expect(() => createKfBackupArchive([activeMaterial], [], sampleSettings, [], new Map(), [], [], {}, null, noteHistory, subscriptions, mail, reviewHistory, searchHistory, {
      ...deletedRecords,
      materials: [{ ...deletedRecords.materials[0], material: { ...deletedRecords.materials[0].material, id: activeMaterial.id } }],
    })).toThrow(/回收站快照结构无效/);
    expect(() => createKfBackupArchive([], [], sampleSettings, [], new Map(), [], [], {}, null, noteHistory, subscriptions, mail, reviewHistory, searchHistory, {
      ...deletedRecords,
      cards: [{ ...deletedRecords.cards[0], card: { ...deletedRecords.cards[0].card, reviewCount: "损坏" as unknown as number } }],
    })).toThrow(/回收站快照结构无效/);
    expect(() => createKfBackupArchive([], [], sampleSettings, [], new Map(), [], [], {}, null, noteHistory, subscriptions, mail, reviewHistory, null, deletedRecords)).toThrow(/回收站备份需要 v10/);
  });
});
