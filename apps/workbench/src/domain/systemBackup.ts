import type { KnowledgeCard } from "./card";
import { cardFromJson } from "./card";
import type { RawMaterial, Artifact } from "../shell/store";
import type { KnowledgeBase, Note } from "./note";
import { noteFromJson } from "./note";
import type { SettingsFile } from "./settings";
import { parseSettings, encodeSettings } from "./settings";
import { createZipArchive } from "./markdownExport";

export interface BackupManifest {
  format: "knowflick-backup";
  /** v2 起携带 notes.json / knowledge_bases.json（契约 docs/NOTES_MODEL.md）。 */
  schemaVersion: number;
  appName: string;
  appVersion: string;
  exportedAt: number;
  exportedAtIso: string;
  stats: {
    cards: number;
    materials: number;
    artifacts: number;
    media: number;
    notes?: number;
    knowledgeBases?: number;
  };
  checksums: Record<string, string>;
}

export interface RestoredBackup {
  manifest: BackupManifest;
  cards: KnowledgeCard[];
  materials: RawMaterial[];
  settings: SettingsFile | null;
  artifacts: Artifact[];
  /** 附件字节，键是库内相对路径（如 media/audio/x.webm）。旧备份里为空。 */
  media: Map<string, Uint8Array>;
  /** 笔记与知识库（v2 包）。v1 旧包为空数组——读取端按“有就恢复”兼容。 */
  notes: Note[];
  knowledgeBases: KnowledgeBase[];
  /** `${kbId}\n${noteId}` → addedAt；与 notes/knowledgeBases 同为 v2 字段。 */
  kbMembership: Record<string, number>;
}

/** 简易快速确定性哈希校验和（基于 FNV-1a） */
function computeChecksum(content: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * 将整套知识库打包生成系统级无损备份包 (.kfbackup / zip)
 */
export function createKfBackupArchive(
  materials: RawMaterial[],
  cards: KnowledgeCard[],
  settingsFile: SettingsFile,
  artifacts: Artifact[] = [],
  media: Map<string, Uint8Array> = new Map(),
  notes: Note[] = [],
  knowledgeBases: KnowledgeBase[] = [],
  kbMembership: Record<string, number> = {}
): Uint8Array {
  const now = Date.now();
  const cardsStr = JSON.stringify(cards, null, 2);
  const materialsStr = JSON.stringify(materials, null, 2);
  // 备份包是**用户会分享/上传的文件**，界面与文档都写着「不含 API 密钥」。
  // 但 encodeSettings 会把 settings.json 里的未知键原样带走——如果那份文件里
  // 留着密钥字段（用户手改过、或旧版本写过），它就会被打进包里。
  // 这里在**备份路径上**净化，不改动正常读写 settings.json 的行为。
  const settingsStr = stripSecrets(encodeSettings(settingsFile));
  const artifactsStr = JSON.stringify(artifacts, null, 2);

  const notesStr = JSON.stringify(notes, null, 2);
  const kbsStr = JSON.stringify({ knowledgeBases, membership: kbMembership }, null, 2);

  const manifest: BackupManifest = {
    format: "knowflick-backup",
    schemaVersion: 2,
    appName: "KnowFlick",
    appVersion: "0.1.0",
    exportedAt: now,
    exportedAtIso: new Date(now).toISOString(),
    stats: {
      cards: cards.length,
      materials: materials.length,
      artifacts: artifacts.length,
      media: media.size,
      notes: notes.length,
      knowledgeBases: knowledgeBases.length,
    },
    checksums: {
      "cards.json": computeChecksum(cardsStr),
      "materials.json": computeChecksum(materialsStr),
      "settings.json": computeChecksum(settingsStr),
      "artifacts.json": computeChecksum(artifactsStr),
      "notes.json": computeChecksum(notesStr),
      "knowledge_bases.json": computeChecksum(kbsStr),
    },
  };

  const manifestStr = JSON.stringify(manifest, null, 2);

  return createZipArchive([
    { path: "manifest.json", data: manifestStr },
    { path: "cards.json", data: cardsStr },
    { path: "materials.json", data: materialsStr },
    { path: "settings.json", data: settingsStr },
    { path: "artifacts.json", data: artifactsStr },
    { path: "notes.json", data: notesStr },
    { path: "knowledge_bases.json", data: kbsStr },
    // 附件（录音 / 图片 / 手写笔迹）随包带走：只带 mediaPath 字符串不带字节，
    // 恢复到另一台机器后就是一批指向空处的引用。
    ...[...media].map(([path, bytes]) => ({ path, data: bytes })),
  ]);
}

/**
 * 纯客户端解包标准 ZIP 文件 (Store 模式)
 */
export function unpackZipStore(buffer: Uint8Array): Map<string, string> {
  const bytes = unpackZipStoreBinary(buffer);
  const decoder = new TextDecoder("utf-8");
  const text = new Map<string, string>();
  for (const [name, data] of bytes) text.set(name, decoder.decode(data));
  return text;
}

/**
 * 解包并保留原始字节。
 *
 * 附件是二进制的，用文本解码会把音视频搅坏，所以字节版是主力，
 * 文本版只是给 json 条目用的薄封装。
 */
export function unpackZipStoreBinary(buffer: Uint8Array): Map<string, Uint8Array> {
  const result = new Map<string, Uint8Array>();
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const decoder = new TextDecoder("utf-8");
  let pos = 0;

  while (pos + 30 <= buffer.length) {
    const sig = view.getUint32(pos, true);
    if (sig !== 0x04034b50) break; // 非 Local File Header

    const compMethod = view.getUint16(pos + 8, true);
    const compSize = view.getUint32(pos + 18, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);

    const nameStart = pos + 30;
    const filename = decoder.decode(buffer.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;

    if (compMethod === 0) {
      // Store 模式 (无压缩)
      result.set(filename, buffer.slice(dataStart, dataStart + compSize));
    }
    pos = dataStart + compSize;
  }

  return result;
}

/**
 * 从 .kfbackup 二进制包或 JSON 文本中无损还原整套知识库
 */
export function restoreKfBackup(input: Uint8Array | string): RestoredBackup {
  if (typeof input === "string") {
    // 兼容历史单一 JSON 格式 (knowflick-workspace)
    const json = JSON.parse(input) as {
      materials?: unknown[];
      cards?: unknown[];
      settings?: unknown;
      artifacts?: unknown[];
    };
    const now = Date.now();
    const rawCards = Array.isArray(json.cards) ? json.cards : [];
    const rawMaterials = Array.isArray(json.materials) ? json.materials : [];
    const rawArtifacts = Array.isArray(json.artifacts) ? json.artifacts : [];

    const cards = rawCards.map((c) => cardFromJson(c));
    const materials = rawMaterials as RawMaterial[];
    const artifacts = rawArtifacts as Artifact[];
    const settings = json.settings ? parseSettings(JSON.stringify(json.settings)) : null;

    return {
      manifest: {
        format: "knowflick-backup",
        schemaVersion: 1,
        appName: "KnowFlick",
        appVersion: "0.1.0",
        exportedAt: now,
        exportedAtIso: new Date(now).toISOString(),
        stats: {
          cards: cards.length,
          materials: materials.length,
          artifacts: artifacts.length,
          // 旧版单一 JSON 格式没有附件位。
          media: 0,
          notes: 0,
          knowledgeBases: 0,
        },
        checksums: {},
      },
      cards,
      materials,
      settings,
      artifacts,
      media: new Map(),
      notes: [],
      knowledgeBases: [],
      kbMembership: {},
    };
  }

  // 二进制 .kfbackup (ZIP)
  const files = unpackZipStore(input);
  const rawFiles = unpackZipStoreBinary(input);
  const manifestRaw = files.get("manifest.json");
  if (!manifestRaw) {
    throw new Error("备份包缺少 manifest.json 元数据文件，可能不是有效的 KnowFlick 备份包");
  }

  const manifest = JSON.parse(manifestRaw) as BackupManifest;
  if (manifest.format !== "knowflick-backup") {
    throw new Error(`未知备份格式: ${manifest.format}`);
  }

  // 1. 读取并校验 cards.json
  const cardsRaw = files.get("cards.json") ?? "[]";
  if (manifest.checksums["cards.json"]) {
    const calc = computeChecksum(cardsRaw);
    if (calc !== manifest.checksums["cards.json"]) {
      console.warn("cards.json 校验和不匹配，文件可能已在外部被修改");
    }
  }
  const rawCards = JSON.parse(cardsRaw) as unknown[];
  const cards = Array.isArray(rawCards) ? rawCards.map((c) => cardFromJson(c)) : [];

  // 2. 读取 materials.json
  const materialsRaw = files.get("materials.json") ?? "[]";
  const rawMaterials = JSON.parse(materialsRaw) as unknown[];
  const materials = Array.isArray(rawMaterials) ? (rawMaterials as RawMaterial[]) : [];

  // 3. 读取 settings.json
  const settingsRaw = files.get("settings.json");
  const settings = settingsRaw ? parseSettings(settingsRaw) : null;

  // 4. 读取 artifacts.json
  const artifactsRaw = files.get("artifacts.json") ?? "[]";
  const rawArtifacts = JSON.parse(artifactsRaw) as unknown[];
  const artifacts = Array.isArray(rawArtifacts) ? (rawArtifacts as Artifact[]) : [];

  // 附件只认 manifest 里声明的库内相对路径，避免备份包里夹带任意路径被还原。
  const media = new Map<string, Uint8Array>();
  for (const [name, data] of rawFiles) {
    if (!/^media\/(audio|image|ink)\/[A-Za-z0-9._-]+$/.test(name)) continue;
    media.set(name, data);
  }

  // 5. 读取笔记与知识库（v2 包；v1 旧包没有这两个文件 → 空集，读取端按“有就恢复”兼容）
  const notesRaw = files.get("notes.json") ?? "[]";
  const rawNotes = JSON.parse(notesRaw) as unknown[];
  const notes = Array.isArray(rawNotes) ? rawNotes.map(noteFromJson) : [];
  const kbsRaw = files.get("knowledge_bases.json") ?? "{}";
  const kbsParsed = JSON.parse(kbsRaw) as {
    knowledgeBases?: unknown[];
    membership?: Record<string, number>;
  };
  const knowledgeBases = (Array.isArray(kbsParsed.knowledgeBases) ? kbsParsed.knowledgeBases : []) as KnowledgeBase[];
  const kbMembership = kbsParsed.membership ?? {};

  return {
    manifest,
    cards,
    materials,
    settings,
    artifacts,
    media,
    notes,
    knowledgeBases,
    kbMembership,
  };
}

/**
 * 去掉设置 JSON 里像凭据的键。
 *
 * 只认「名字像密钥」的键（apiKey / api_key / token / secret / password / credential…），
 * 不做值层面的猜测——值层面的脱敏是错误信息的职责，这里防的是「字段本身不该带走」。
 */
export function stripSecrets(settingsJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(settingsJson) as unknown;
  } catch {
    return settingsJson;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return settingsJson;
  const SECRET_KEY = /(api[-_]?key|apikey|token|secret|password|passwd|credential|auth)/i;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = value;
  }
  return JSON.stringify(out);
}

/** 触发浏览器下载系统级备份包 */
export function downloadKfBackup(
  materials: RawMaterial[],
  cards: KnowledgeCard[],
  settingsFile: SettingsFile,
  artifacts: Artifact[] = [],
  media: Map<string, Uint8Array> = new Map(),
  notes: Note[] = [],
  knowledgeBases: KnowledgeBase[] = [],
  kbMembership: Record<string, number> = {}
): void {
  const bytes = createKfBackupArchive(materials, cards, settingsFile, artifacts, media, notes, knowledgeBases, kbMembership);
  // 复制到独立的 ArrayBuffer：createZipArchive 返回的缓冲区类型是 ArrayBufferLike，
  // 在 TS 的 BlobPart 约束下不能直接当 BlobPart 用（SharedArrayBuffer 不兼容）。
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `knowflick-backup-${dateStr}.kfbackup`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
