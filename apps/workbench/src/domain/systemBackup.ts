import type { KnowledgeCard } from "./card";
import { cardFromJson } from "./card";
import type { RawMaterial, Artifact } from "../shell/store";
import type { KnowledgeBase, Note, NoteRevision } from "./note";
import { noteFromJson } from "./note";
import type { SettingsFile } from "./settings";
import { parseSettings, encodeSettings } from "./settings";
import { createZipArchive } from "./markdownExport";
import { sha256Hex } from "./sha256";
import { validateReviewHistory, type ReviewHistorySnapshot } from "./reviewHistory";
import { validateSearchHistorySnapshot } from "./searchHistory";

/** 当前格式未覆盖的权威数据；同时写入清单并在导出、恢复和上传回执中说明。 */
export const BACKUP_FORMAT_GAP = "当前备份格式不含项目、目标、个人画像、订阅、邮箱账户及同步记录、外部连接授权、笔记历史版本、搜索历史、已删除的素材、卡片和产物";
export const BACKUP_V5_FORMAT_GAP = "当前备份格式不含订阅、邮箱账户及同步记录、外部连接授权、笔记历史版本、搜索历史、已删除的素材、卡片和产物；附件和设置与数据库不在同一事务";
export const BACKUP_V6_FORMAT_GAP = "当前备份格式不含订阅、邮箱账户及同步记录、外部连接授权、搜索历史、已删除的素材、卡片和产物；附件和设置与数据库不在同一事务";
export const BACKUP_V6_NO_R4_GAP = "当前备份格式不含项目、目标、个人画像、订阅、邮箱账户及同步记录、外部连接授权、搜索历史、已删除的素材、卡片和产物；附件和设置与数据库不在同一事务";
export const BACKUP_V7_FORMAT_GAP = "当前备份格式不含邮箱账户及同步记录、外部连接授权、搜索历史、已删除的素材、卡片和产物；附件和设置与数据库不在同一事务";
export const BACKUP_V7_NO_R4_GAP = "当前备份格式不含项目、目标、个人画像、邮箱账户及同步记录、外部连接授权、搜索历史、已删除的素材、卡片和产物；附件和设置与数据库不在同一事务";
export const BACKUP_V8_FORMAT_GAP = "当前备份格式不含外部连接授权、搜索历史、已删除的素材、卡片和产物；邮箱密码不随包迁移，附件和设置与数据库不在同一事务";
export const BACKUP_V8_NO_R4_GAP = "当前备份格式不含项目、目标、个人画像、外部连接授权、搜索历史、已删除的素材、卡片和产物；邮箱密码不随包迁移，附件和设置与数据库不在同一事务";
export const BACKUP_V9_FORMAT_GAP = "当前备份格式不含外部连接授权、搜索历史、已删除的素材、卡片和产物；邮箱密码不随包迁移，历史覆盖起点之前的复习不补造，附件和设置与数据库不在同一事务";
export const BACKUP_V9_NO_R4_GAP = "当前备份格式不含项目、目标、个人画像、外部连接授权、搜索历史、已删除的素材、卡片和产物；邮箱密码不随包迁移，历史覆盖起点之前的复习不补造，附件和设置与数据库不在同一事务";
export const BACKUP_V10_FORMAT_GAP = "当前备份格式仍不含外部连接授权、已删除的素材、卡片和产物；邮箱密码不随包迁移，历史覆盖起点之前的复习不补造；搜索历史、附件和设置分别从数据库之外读取，不与 SQLite 快照处于同一事务";
export const BACKUP_V10_NO_R4_GAP = "当前备份格式仍不含项目、目标、个人画像、外部连接授权、已删除的素材、卡片和产物；邮箱密码不随包迁移，历史覆盖起点之前的复习不补造；搜索历史、附件和设置分别从数据库之外读取，不与 SQLite 快照处于同一事务";
export const BACKUP_V11_FORMAT_GAP = "当前备份格式仍不含外部连接授权；邮箱密码不随包迁移，历史覆盖起点之前的复习不补造；搜索历史、附件和设置分别从数据库之外读取，不与 SQLite 快照处于同一事务";
export const BACKUP_V11_NO_R4_GAP = "当前备份格式仍不含项目、目标、个人画像、外部连接授权；邮箱密码不随包迁移，历史覆盖起点之前的复习不补造；搜索历史、附件和设置分别从数据库之外读取，不与 SQLite 快照处于同一事务";
export const BACKUP_BROWSER_FORMAT_GAP = "浏览器备份包含最近搜索历史，但不含项目、目标、个人画像、逐次复习历史、订阅、邮箱账户及同步记录、外部连接授权、笔记历史版本和桌面回收站；附件与设置不在同一事务";

/** Desktop v11 carries deleted records as trash entries and never revives them. */
export interface DeletedRecordsSnapshot {
  version: 1;
  materials: Array<{ material: RawMaterial; deletedAt: number | null }>;
  cards: Array<{ card: KnowledgeCard; deletedAt: number | null }>;
  artifacts: Artifact[];
}

export interface DeletedRestoreCounts {
  materials: number;
  cards: number;
  artifacts: number;
  alreadyPresent: number;
}

export interface SubscriptionSnapshot {
  version: 1;
  items: import("../shell/store").SubscriptionRow[];
  excludedCount: number;
}

export interface MailSnapshot {
  version: 1;
  accounts: Array<{
    config: { id: string; name: string; email: string; host: string; port: number; username: string; folder: string; syncLimit: number; syncIntervalMinutes: number };
    createdAt: number; lastSyncAt: number | null; uidValidity: number | null; lastUid: number;
  }>;
  syncStates: Array<{ accountId: string; historyBefore: number | null; historyComplete: boolean; lastAttemptAt: number | null }>;
  imports: Array<{ accountId: string; folder: string; uidValidity: number; uid: number; messageId: string; materialId: string }>;
  rejected: Array<{ accountId: string; folder: string; uidValidity: number; uid: number; reason: string; rejectedAt: number }>;
  materialBindings: Record<string, { state: "active" | "deleted" | "missing"; fingerprint: string | null }>;
}

export interface MailRestoreCounts { accounts: number; syncStates: number; imports: number; rejected: number }

const MAIL_REASONS = ["邮件大小超过导入上限", "无法读取邮件正文或 MIME 结构"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

function validateMailSnapshot(value: unknown, materials: RawMaterial[]): MailSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("邮箱备份快照格式无效");
  const snapshot = value as Record<string, unknown>;
  if (Object.keys(snapshot).sort().join(",") !== "accounts,imports,materialBindings,rejected,syncStates,version" || snapshot.version !== 1 || !Array.isArray(snapshot.accounts) || !Array.isArray(snapshot.syncStates) || !Array.isArray(snapshot.imports) || !Array.isArray(snapshot.rejected) || !snapshot.materialBindings || typeof snapshot.materialBindings !== "object" || Array.isArray(snapshot.materialBindings)) throw new Error("邮箱备份版本或清单无效");
  const accounts = new Set<string>();
  const sync = new Set<string>();
  const imports = new Set<string>();
  const rejected = new Set<string>();
  const materialIds = new Set<string>();
  const packageMaterials = new Map<string, RawMaterial>();
  for (const material of materials) {
    if (!material || typeof material.id !== "string" || !material.id || packageMaterials.has(material.id)) throw new Error("邮件来源素材清单无效");
    packageMaterials.set(material.id, material);
  }
  const time = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;
  const optionalTime = (n: unknown) => n === null || time(n);
  const uid = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 1 && (n as number) <= 0xffffffff;
  const label = (n: unknown, max: number) => typeof n === "string" && n.length > 0 && new TextEncoder().encode(n).length <= max && !CONTROL.test(n);
  for (const item of snapshot.accounts) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("邮箱账号数据无效");
    const row = item as Record<string, unknown>;
    if (Object.keys(row).sort().join(",") !== "config,createdAt,lastSyncAt,lastUid,uidValidity" || !row.config || typeof row.config !== "object" || Array.isArray(row.config)) throw new Error("邮箱账号字段无效");
    const config = row.config as Record<string, unknown>;
    if (Object.keys(config).sort().join(",") !== "email,folder,host,id,name,port,syncIntervalMinutes,syncLimit,username" || typeof config.id !== "string" || !UUID.test(config.id) || accounts.has(config.id) ||
        !label(config.name, 200) || typeof config.email !== "string" || !label(config.email, 320) || !config.email.includes("@") || typeof config.host !== "string" || !label(config.host, 253) || !/^[\x21-\x7e]+$/.test(config.host) || /[\/\\:@\[\]"'<>]/.test(config.host) ||
        !Number.isSafeInteger(config.port) || (config.port as number) < 1 || (config.port as number) > 65535 || !label(config.username, 320) || !label(config.folder, 512) ||
        !Number.isSafeInteger(config.syncLimit) || (config.syncLimit as number) < 1 || (config.syncLimit as number) > 200 || !Number.isSafeInteger(config.syncIntervalMinutes) || (config.syncIntervalMinutes as number) !== 0 && ((config.syncIntervalMinutes as number) < 5 || (config.syncIntervalMinutes as number) > 1440) ||
        !time(row.createdAt) || !optionalTime(row.lastSyncAt) || row.uidValidity !== null && !uid(row.uidValidity) || !Number.isSafeInteger(row.lastUid) || (row.lastUid as number) < 0 || (row.lastUid as number) > 0xffffffff) throw new Error("邮箱账号字段无效或重复");
    accounts.add(config.id);
  }
  for (const item of snapshot.syncStates) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("邮箱同步状态无效");
    const row = item as Record<string, unknown>;
    if (Object.keys(row).sort().join(",") !== "accountId,historyBefore,historyComplete,lastAttemptAt" || typeof row.accountId !== "string" || !UUID.test(row.accountId) || sync.has(row.accountId) || row.historyBefore !== null && !uid(row.historyBefore) || typeof row.historyComplete !== "boolean" || !optionalTime(row.lastAttemptAt)) throw new Error("邮箱同步状态字段无效或重复");
    sync.add(row.accountId);
  }
  for (const id of accounts) if (!sync.has(id)) throw new Error("邮箱账号缺少同步状态");
  const keyOf = (row: Record<string, unknown>) => JSON.stringify([row.accountId, row.folder, row.uidValidity, row.uid]);
  for (const item of snapshot.imports) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("邮件去重记录无效");
    const row = item as Record<string, unknown>;
    if (Object.keys(row).sort().join(",") !== "accountId,folder,materialId,messageId,uid,uidValidity" || typeof row.accountId !== "string" || !UUID.test(row.accountId) || !label(row.folder, 512) || !uid(row.uidValidity) || !uid(row.uid) || typeof row.messageId !== "string" || new TextEncoder().encode(row.messageId).length > 4096 || CONTROL.test(row.messageId) || !label(row.materialId, 512) || imports.has(keyOf(row))) throw new Error("邮件去重记录字段无效或重复");
    imports.add(keyOf(row)); materialIds.add(row.materialId as string);
  }
  for (const item of snapshot.rejected) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("邮件隔离记录无效");
    const row = item as Record<string, unknown>;
    if (Object.keys(row).sort().join(",") !== "accountId,folder,reason,rejectedAt,uid,uidValidity" || typeof row.accountId !== "string" || !UUID.test(row.accountId) || !label(row.folder, 512) || !uid(row.uidValidity) || !uid(row.uid) || !MAIL_REASONS.includes(row.reason as string) || !time(row.rejectedAt) || rejected.has(keyOf(row)) || imports.has(keyOf(row))) throw new Error("邮件隔离记录字段无效或冲突");
    rejected.add(keyOf(row));
  }
  const bindings = snapshot.materialBindings as Record<string, unknown>;
  if (Object.keys(bindings).sort().join("\n") !== [...materialIds].sort().join("\n")) throw new Error("邮件素材绑定清单与去重记录不一致");
  for (const [id, raw] of Object.entries(bindings)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("邮件素材绑定无效");
    const binding = raw as Record<string, unknown>;
    if (Object.keys(binding).sort().join(",") !== "fingerprint,state" || !["active", "deleted", "missing"].includes(binding.state as string) ||
        (binding.state === "missing" ? binding.fingerprint !== null : typeof binding.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(binding.fingerprint))) throw new Error("邮件素材绑定字段无效");
    const material = packageMaterials.get(id);
    if (binding.state === "active") {
      if (!material) throw new Error("邮箱去重记录引用的有效素材未纳入备份");
      const actual = mailMaterialFingerprint(material, 0);
      if (actual !== binding.fingerprint) throw new Error("邮箱去重记录引用的素材与备份正文不一致");
    } else if (material) throw new Error("邮件去重记录的来源状态与素材备份不一致");
  }
  return value as MailSnapshot;
}

function mailMaterialFingerprint(material: RawMaterial, deleted: 0 | 1): string {
  return sha256Hex(JSON.stringify([
    material.id, material.sourceType, material.title, material.sourceUrl ?? null,
    material.rawText, material.cleanedMarkdown ?? null, material.contentHash,
    material.mediaPath ?? null, material.mediaSizeBytes ?? 0, material.metadataJson,
    material.inboxStatus, material.createdAt, material.updatedAt, deleted,
  ]));
}

function validateDeletedMailBindings(mail: MailSnapshot | undefined, deletedRecords: DeletedRecordsSnapshot | undefined): void {
  if (!mail || !deletedRecords) return;
  const deletedById = new Map(deletedRecords.materials.map(({ material }) => [material.id, material]));
  for (const [id, binding] of Object.entries(mail.materialBindings)) {
    const deletedMaterial = deletedById.get(id);
    if (binding.state === "deleted") {
      if (!deletedMaterial) throw new Error("v11 邮件去重记录引用的已删除素材未纳入回收站快照");
      if (binding.fingerprint !== mailMaterialFingerprint(deletedMaterial, 1)) throw new Error("v11 邮件素材指纹与回收站原件不一致");
    } else if (binding.state === "missing" && deletedMaterial) {
      throw new Error("v11 邮件素材缺失状态与回收站快照冲突");
    }
  }
}

export function mailSourcesWithoutOriginal(
  mail: MailSnapshot | null | undefined,
  deletedRecords: DeletedRecordsSnapshot | null | undefined = null,
): number {
  if (!mail) return 0;
  const includedDeletedIds = new Set(deletedRecords?.materials.map(({ material }) => material.id) ?? []);
  return Object.entries(mail.materialBindings).filter(([id, binding]) =>
    binding.state === "missing" || (binding.state === "deleted" && !includedDeletedIds.has(id))
  ).length;
}

function safeSubscriptionTarget(type: string, target: string): boolean {
  if (target.length > 8192 || /[\u0000-\u001f\u007f-\u009f]/.test(target)) return false;
  if (type === "rss" || type === "tech_board") {
    try {
      const parsed = new URL(target);
      return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.href.includes("?") && !parsed.href.includes("#");
    } catch { return false; }
  }
  if (type === "github_release") return /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(target);
  if (type === "github_trending") return /^[a-z0-9+#.-]*$/i.test(target);
  return false;
}

function validateSubscriptions(value: unknown): SubscriptionSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("订阅快照结构无效");
  const snapshot = value as Record<string, unknown>;
  if (Object.keys(snapshot).sort().join(",") !== "excludedCount,items,version" || snapshot.version !== 1 || !Array.isArray(snapshot.items) || !Number.isSafeInteger(snapshot.excludedCount) || (snapshot.excludedCount as number) < 0) throw new Error("订阅快照字段无效");
  const ids = new Set<string>();
  for (const item of snapshot.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("订阅记录无效");
    const row = item as Record<string, unknown>;
    if (Object.keys(row).sort().join(",") !== "createdAt,id,intervalMinutes,isActive,lastPolledAt,targetUrl,title,type" ||
        typeof row.id !== "string" || !row.id || ids.has(row.id) || typeof row.type !== "string" || typeof row.title !== "string" || typeof row.targetUrl !== "string" ||
        !safeSubscriptionTarget(row.type as string, row.targetUrl as string) || typeof row.isActive !== "boolean" || !Number.isSafeInteger(row.intervalMinutes) || (row.intervalMinutes as number) <= 0 || !Number.isSafeInteger(row.createdAt) ||
        (row.lastPolledAt !== null && !Number.isSafeInteger(row.lastPolledAt))) throw new Error("订阅记录字段无效或重复");
    ids.add(row.id);
  }
  return value as SubscriptionSnapshot;
}

function validateNoteRevisions(value: unknown, notes: unknown): NoteRevision[] {
  if (!Array.isArray(value) || !Array.isArray(notes)) throw new Error("笔记历史结构无效");
  const byId = new Map<string, { currentRevision: number; title: string; bodyMd: string }>();
  for (const item of notes) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("备份笔记结构无效");
    const n = item as Record<string, unknown>;
    if (typeof n.id !== "string" || !n.id || byId.has(n.id) || !Number.isSafeInteger(n.currentRevision) || (n.currentRevision as number) < 1 || typeof n.title !== "string" || typeof n.bodyMd !== "string") throw new Error("备份笔记标识或修订无效");
    byId.set(n.id, { currentRevision: n.currentRevision as number, title: n.title, bodyMd: n.bodyMd });
  }
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("笔记历史结构无效");
    const r = item as Record<string, unknown>;
    if (Object.keys(r).sort().join(",") !== "bodyMd,noteId,revision,savedAt,title" || typeof r.noteId !== "string" || typeof r.title !== "string" || typeof r.bodyMd !== "string" || !Number.isSafeInteger(r.revision) || !Number.isSafeInteger(r.savedAt)) throw new Error("笔记历史字段无效");
    const note = byId.get(r.noteId);
    const revision = r.revision as number;
    const key = JSON.stringify([r.noteId, revision]);
    if (!note || revision < 1 || revision > note.currentRevision || seen.has(key)) throw new Error("笔记历史引用或修订号无效");
    if (revision === note.currentRevision && (r.title !== note.title || r.bodyMd !== note.bodyMd)) throw new Error("当前笔记与历史修订不一致");
    seen.add(key);
  }
  return value as NoteRevision[];
}

const R4_TABLES = ["projects", "goals", "profile_claims", "profile_denials", "project_members", "goal_evidence"] as const;
function r4Counts(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("项目与画像快照格式无效");
  const snapshot = value as Record<string, unknown>;
  if (snapshot.version !== 1 || !snapshot.tables || typeof snapshot.tables !== "object" || Array.isArray(snapshot.tables)) throw new Error("项目与画像快照版本或表清单无效");
  const tables = snapshot.tables as Record<string, unknown>;
  if (Object.keys(tables).length !== R4_TABLES.length || R4_TABLES.some((name) => !Array.isArray(tables[name]))) throw new Error("项目与画像快照表清单无效");
  return Object.fromEntries(R4_TABLES.map((name) => [name, (tables[name] as unknown[]).length]));
}

/** Called only after desktop validation has checked the R4 wire structure. */
export function r4SourceBinding(value: unknown, kind: "material" | "card" | "note", id: string): { protected: boolean; fingerprint: string | null } {
  const snapshot = value as { note_bindings: Record<string, string>; evidence_bindings: Record<string, string | null>; profile_bindings: Record<string, { material: string | null; card: string | null; note: string | null }> };
  if (kind === "note" && Object.hasOwn(snapshot.note_bindings, id)) return { protected: true, fingerprint: snapshot.note_bindings[id] };
  const key = `${kind}\n${id}`;
  if (Object.hasOwn(snapshot.evidence_bindings, key)) return { protected: true, fingerprint: snapshot.evidence_bindings[key] };
  if (Object.hasOwn(snapshot.profile_bindings, id)) return { protected: true, fingerprint: snapshot.profile_bindings[id][kind] };
  return { protected: false, fingerprint: null };
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

const DELETED_MATERIAL_KEYS = "id sourceType title sourceUrl rawText cleanedMarkdown contentHash mediaPath mediaSizeBytes metadataJson inboxStatus createdAt updatedAt".split(" ");

function validateDeletedRecords(
  value: unknown,
  activeMaterials: unknown[],
  activeCards: unknown[],
  activeArtifacts: unknown[],
): DeletedRecordsSnapshot {
  const fail = (): never => { throw new Error("回收站快照结构无效或与活动记录冲突"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const snapshot = value as Record<string, unknown>;
  if (!exactKeys(snapshot, ["version", "materials", "cards", "artifacts"]) || snapshot.version !== 1 ||
      !Array.isArray(snapshot.materials) || !Array.isArray(snapshot.cards) || !Array.isArray(snapshot.artifacts)) fail();

  const validTime = (time: unknown) => time === null || (Number.isSafeInteger(time) && (time as number) >= 0);
  const idsOf = (items: unknown[]): Set<string> => {
    const ids = new Set<string>();
    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) fail();
      const id = (item as Record<string, unknown>).id;
      if (typeof id !== "string" || !id.trim() || ids.has(id)) fail();
      ids.add(id as string);
    }
    return ids;
  };
  const activeMaterialIds = idsOf(activeMaterials);
  const materialIds = new Set(activeMaterialIds);
  const materials = (snapshot.materials as unknown[]).map((raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail();
    const record = raw as Record<string, unknown>;
    if (!exactKeys(record, ["material", "deletedAt"]) || !validTime(record.deletedAt) ||
        !record.material || typeof record.material !== "object" || Array.isArray(record.material)) fail();
    const material = record.material as Record<string, unknown>;
    if (!exactKeys(material, DELETED_MATERIAL_KEYS) ||
        typeof material.id !== "string" || !material.id.trim() || materialIds.has(material.id) ||
        typeof material.sourceType !== "string" || typeof material.title !== "string" ||
        material.sourceUrl !== null && typeof material.sourceUrl !== "string" || typeof material.rawText !== "string" ||
        material.cleanedMarkdown !== null && typeof material.cleanedMarkdown !== "string" || typeof material.contentHash !== "string" ||
        material.mediaPath !== null && (typeof material.mediaPath !== "string" || !/^media\/(audio|image|ink)\/[A-Za-z0-9._-]+$/.test(material.mediaPath)) ||
        !Number.isSafeInteger(material.mediaSizeBytes) || (material.mediaSizeBytes as number) < 0 || typeof material.metadataJson !== "string" ||
        !["inbox", "processed", "dismissed"].includes(material.inboxStatus as string) ||
        !Number.isSafeInteger(material.createdAt) || (material.createdAt as number) < 0 || !Number.isSafeInteger(material.updatedAt) || (material.updatedAt as number) < 0) fail();
    materialIds.add(material.id as string);
    return { material: material as unknown as RawMaterial, deletedAt: record.deletedAt as number | null };
  });

  const cardIds = idsOf(activeCards);
  const cards = (snapshot.cards as unknown[]).map((raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail();
    const record = raw as Record<string, unknown>;
    if (!exactKeys(record, ["card", "deletedAt"]) || !validTime(record.deletedAt) || !record.card || typeof record.card !== "object" || Array.isArray(record.card)) fail();
    const card = record.card as Record<string, unknown>;
    if (!exactKeys(card, ["id", "materialId", "category", "headline", "summary", "details", "links", "tags", "source", "createdAt", "editedAt", "seenAt", "swiped", "isFavorite", "favoritedAt", "reviewCount", "masteryLevel", "lastReviewedAt", "repetition", "intervalDays", "easeFactor", "stability", "difficulty", "subject", "branch", "level", "track", "orderKey", "prereq"]) ||
        typeof card.id !== "string" || !card.id.trim() || cardIds.has(card.id) ||
        card.materialId !== null && typeof card.materialId !== "string" ||
        !["category", "headline", "summary", "details"].every((key) => typeof card[key] === "string") ||
        !Array.isArray(card.links) || !card.links.every((link) => !!link && typeof link === "object" && !Array.isArray(link) &&
          exactKeys(link as Record<string, unknown>, ["title", "url"]) && typeof (link as Record<string, unknown>).title === "string" && typeof (link as Record<string, unknown>).url === "string") ||
        !Array.isArray(card.tags) || !card.tags.every((tag) => typeof tag === "string") ||
        !Array.isArray(card.prereq) || !card.prereq.every((item) => typeof item === "string") ||
        !["seed", "ai", "imported"].includes(card.source as string) ||
        !Number.isSafeInteger(card.createdAt) || (card.createdAt as number) < 0 ||
        !["editedAt", "seenAt", "favoritedAt", "lastReviewedAt"].every((key) => validTime(card[key])) ||
        card.swiped !== null && !["left", "right", "skip"].includes(card.swiped as string) || typeof card.isFavorite !== "boolean" ||
        !["reviewCount", "masteryLevel", "repetition"].every((key) => Number.isSafeInteger(card[key]) && (card[key] as number) >= 0) ||
        !["intervalDays", "easeFactor", "stability", "difficulty"].every((key) => typeof card[key] === "number" && Number.isFinite(card[key])) ||
        !["subject", "branch", "track", "orderKey"].every((key) => card[key] === null || typeof card[key] === "string") ||
        card.level !== null && (!Number.isSafeInteger(card.level) || (card.level as number) < 1 || (card.level as number) > 5)) fail();
    cardIds.add(card.id as string);
    return { card: card as unknown as KnowledgeCard, deletedAt: record.deletedAt as number | null };
  });

  const availableMaterialIds = new Set(materialIds);
  const artifactIds = idsOf(activeArtifacts);
  const artifacts = (snapshot.artifacts as unknown[]).map((raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail();
    const artifact = raw as Record<string, unknown>;
    if (!exactKeys(artifact, ["id", "artifactType", "title", "contentMarkdown", "sourceCardIds", "sourceNoteIds", "dateScopeStart", "dateScopeEnd", "createdAt", "updatedAt", "isDeleted"]) ||
        typeof artifact.id !== "string" || !artifact.id.trim() || artifactIds.has(artifact.id) || artifact.isDeleted !== true ||
        typeof artifact.artifactType !== "string" || typeof artifact.title !== "string" || typeof artifact.contentMarkdown !== "string" ||
        !Array.isArray(artifact.sourceCardIds) || !artifact.sourceCardIds.every((id) => typeof id === "string") ||
        !Array.isArray(artifact.sourceNoteIds) || !artifact.sourceNoteIds.every((id) => typeof id === "string") ||
        !validTime(artifact.dateScopeStart) || !validTime(artifact.dateScopeEnd) ||
        !Number.isSafeInteger(artifact.createdAt) || (artifact.createdAt as number) < 0 ||
        !Number.isSafeInteger(artifact.updatedAt) || (artifact.updatedAt as number) < 0) fail();
    artifactIds.add(artifact.id as string);
    return artifact as unknown as Artifact;
  });
  for (const record of cards) {
    if (record.card.materialId !== null && record.card.materialId !== undefined && !availableMaterialIds.has(record.card.materialId)) fail();
  }
  return { version: 1, materials, cards, artifacts };
}

export interface BackupManifest {
  format: "knowflick-backup";
  /**
   * v2 携带 notes.json / knowledge_bases.json（契约 docs/NOTES_MODEL.md）；
   * v3 校验和升级为 SHA-256（`sha256:<hex>` 前缀；v2 的 8 位裸值是旧 FNV，
   * 读取端仍按 FNV 校验；v4 校验附件字节，v5 增加 R4 快照，v6 增加笔记历史，
   * v7 增加订阅，v8 增加邮箱账号及同步去重状态（不含凭据），
   * v9 增加逐次复习事件历史（不回填旧累计次数），v10 增加桌面搜索历史，v11 增加桌面回收站内容；v12 是只包含浏览器能力集合的分支。
   */
  schemaVersion: number;
  /** v12 浏览器分支；不代表包含桌面 v5–v11 数据。 */
  profile?: "browser";
  appName: string;
  appVersion: string;
  exportedAt: number;
  exportedAtIso: string;
  limitations?: string[];
  stats: {
    cards: number;
    materials: number;
    artifacts: number;
    media: number;
    notes?: number;
    knowledgeBases?: number;
    r4?: Record<string, number>;
    noteRevisions?: number;
    subscriptions?: number;
    subscriptionsExcluded?: number;
    mailAccounts?: number;
    mailSyncStates?: number;
    mailImports?: number;
    mailRejected?: number;
    reviewEvents?: number;
    searchHistory?: number;
    deletedMaterials?: number;
    deletedCards?: number;
    deletedArtifacts?: number;
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
  /** 旧版包未提供字节校验的附件，不能声称这些附件完整性已验证。 */
  uncheckedMediaPaths?: string[];
  r4?: unknown;
  noteRevisions?: NoteRevision[];
  subscriptions?: SubscriptionSnapshot;
  mail?: MailSnapshot;
  reviewHistory?: ReviewHistorySnapshot;
  searchHistory?: string[];
  deletedRecords?: DeletedRecordsSnapshot;
}

/**
 * 旧 v2 包的 FNV-1a 校验和——只在**读取** v2 包时使用（兼容不豁免：
 * 旧包被篡改同样要在恢复前拒绝）。新包一律 SHA-256。
 */
export function legacyFnvChecksum(content: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function computeChecksum(content: string): string {
  return `sha256:${sha256Hex(content)}`;
}

function parseSearchHistoryJson(content: string): string[] {
  try {
    return validateSearchHistorySnapshot(JSON.parse(content) as unknown);
  } catch {
    // JSON parser messages can include nearby text; search terms are private user data.
    throw new Error("搜索历史快照格式无效");
  }
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
  kbMembership: Record<string, number> = {},
  r4: unknown = null,
  noteRevisions: NoteRevision[] | null = null,
  subscriptions: SubscriptionSnapshot | null = null,
  mail: MailSnapshot | null = null,
  reviewHistory: ReviewHistorySnapshot | null = null,
  searchHistory: string[] | null = null,
  deletedRecords: DeletedRecordsSnapshot | null = null,
  browserSearchHistory: string[] | null = null
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
  const r4Str = r4 === null && noteRevisions === null ? null : JSON.stringify(r4, null, 2);
  const counts = r4 === null ? undefined : r4Counts(r4);
  const historyStr = noteRevisions === null ? null : JSON.stringify(validateNoteRevisions(noteRevisions, notes), null, 2);
  if (subscriptions !== null && historyStr === null) throw new Error("订阅备份需要笔记历史快照");
  const subscriptionsStr = subscriptions === null ? null : JSON.stringify(validateSubscriptions(subscriptions), null, 2);
  if (mail !== null && (subscriptionsStr === null || historyStr === null)) throw new Error("邮箱备份需要订阅与笔记历史快照");
  const mailSnapshot = mail === null ? null : validateMailSnapshot(mail, materials);
  const mailStr = mailSnapshot === null ? null : JSON.stringify(mailSnapshot, null, 2);
  if (reviewHistory !== null && (mailStr === null || subscriptionsStr === null || historyStr === null)) throw new Error("逐次复习历史备份需要邮箱、订阅与笔记历史快照");
  const reviewHistoryStr = reviewHistory === null ? null : JSON.stringify(validateReviewHistory(reviewHistory), null, 2);
  if (searchHistory !== null && reviewHistoryStr === null) throw new Error("搜索历史备份需要 v9 前置快照");
  const searchHistoryStr = searchHistory === null ? null : JSON.stringify(validateSearchHistorySnapshot(searchHistory), null, 2);
  if (deletedRecords !== null && searchHistoryStr === null) throw new Error("回收站备份需要 v10 前置快照");
  const deletedRecordsSnapshot = deletedRecords === null ? null : validateDeletedRecords(deletedRecords, materials, cards, artifacts);
  const deletedRecordsStr = deletedRecordsSnapshot === null ? null : JSON.stringify(deletedRecordsSnapshot, null, 2);
  if (browserSearchHistory !== null && (searchHistoryStr !== null || r4Str !== null || historyStr !== null || subscriptionsStr !== null || mailStr !== null || reviewHistoryStr !== null || deletedRecordsStr !== null)) {
    throw new Error("浏览器搜索历史必须使用独立的浏览器备份分支");
  }
  const browserSearchHistoryStr = browserSearchHistory === null ? null : JSON.stringify(validateSearchHistorySnapshot(browserSearchHistory), null, 2);
  validateDeletedMailBindings(mailSnapshot ?? undefined, deletedRecordsSnapshot ?? undefined);
  for (const path of media.keys()) {
    if (!/^media\/(audio|image|ink)\/[A-Za-z0-9._-]+$/.test(path)) throw new Error("附件路径无效，无法生成备份");
  }

  const manifest: BackupManifest = {
    format: "knowflick-backup",
    schemaVersion: browserSearchHistoryStr !== null ? 12 : deletedRecordsStr !== null ? 11 : searchHistoryStr !== null ? 10 : reviewHistoryStr !== null ? 9 : mailStr !== null ? 8 : subscriptionsStr !== null ? 7 : historyStr !== null ? 6 : r4Str === null ? 4 : 5,
    ...(browserSearchHistoryStr === null ? {} : { profile: "browser" as const }),
    appName: "KnowFlick",
    appVersion: "0.1.0",
    exportedAt: now,
    exportedAtIso: new Date(now).toISOString(),
    limitations: [browserSearchHistoryStr !== null ? BACKUP_BROWSER_FORMAT_GAP : deletedRecordsStr !== null ? (r4 === null ? BACKUP_V11_NO_R4_GAP : BACKUP_V11_FORMAT_GAP) : searchHistoryStr !== null ? (r4 === null ? BACKUP_V10_NO_R4_GAP : BACKUP_V10_FORMAT_GAP) : reviewHistoryStr !== null ? (r4 === null ? BACKUP_V9_NO_R4_GAP : BACKUP_V9_FORMAT_GAP) : mailStr !== null ? (r4 === null ? BACKUP_V8_NO_R4_GAP : BACKUP_V8_FORMAT_GAP) : subscriptionsStr !== null ? (r4 === null ? BACKUP_V7_NO_R4_GAP : BACKUP_V7_FORMAT_GAP) : historyStr !== null ? (r4 === null ? BACKUP_V6_NO_R4_GAP : BACKUP_V6_FORMAT_GAP) : r4Str === null ? BACKUP_FORMAT_GAP : BACKUP_V5_FORMAT_GAP, ...(subscriptions?.excludedCount ? [`${subscriptions.excludedCount} 条订阅因地址含参数或格式不支持而未纳入`] : []), ...(mailSnapshot && mailSourcesWithoutOriginal(mailSnapshot, deletedRecordsSnapshot) > 0 ? [`${mailSourcesWithoutOriginal(mailSnapshot, deletedRecordsSnapshot)} 条邮箱导入记录指向已删除或缺失且原件未纳入本包的素材`] : [])],
    stats: {
      cards: cards.length,
      materials: materials.length,
      artifacts: artifacts.length,
      media: media.size,
      notes: notes.length,
      knowledgeBases: knowledgeBases.length,
      ...(counts ? { r4: counts } : {}),
      ...(noteRevisions === null ? {} : { noteRevisions: noteRevisions.length }),
      ...(subscriptions === null ? {} : { subscriptions: subscriptions.items.length, subscriptionsExcluded: subscriptions.excludedCount }),
      ...(mail === null ? {} : { mailAccounts: mail.accounts.length, mailSyncStates: mail.syncStates.length, mailImports: mail.imports.length, mailRejected: mail.rejected.length }),
      ...(reviewHistory === null ? {} : { reviewEvents: reviewHistory.events.length }),
      ...(searchHistoryStr === null && browserSearchHistoryStr === null ? {} : { searchHistory: (browserSearchHistory ?? searchHistory)!.length }),
      ...(deletedRecords === null ? {} : { deletedMaterials: deletedRecords.materials.length, deletedCards: deletedRecords.cards.length, deletedArtifacts: deletedRecords.artifacts.length }),
    },
    checksums: {
      "cards.json": computeChecksum(cardsStr),
      "materials.json": computeChecksum(materialsStr),
      "settings.json": computeChecksum(settingsStr),
      "artifacts.json": computeChecksum(artifactsStr),
      "notes.json": computeChecksum(notesStr),
      "knowledge_bases.json": computeChecksum(kbsStr),
      ...(r4Str === null ? {} : { "r4.json": computeChecksum(r4Str) }),
      ...(historyStr === null ? {} : { "note_revisions.json": computeChecksum(historyStr) }),
      ...(subscriptionsStr === null ? {} : { "subscriptions.json": computeChecksum(subscriptionsStr) }),
      ...(mailStr === null ? {} : { "mail.json": computeChecksum(mailStr) }),
      ...(reviewHistoryStr === null ? {} : { "review_history.json": computeChecksum(reviewHistoryStr) }),
      ...(searchHistoryStr === null ? {} : { "search_history.json": computeChecksum(searchHistoryStr) }),
      ...(deletedRecordsStr === null ? {} : { "deleted_records.json": computeChecksum(deletedRecordsStr) }),
      ...(browserSearchHistoryStr === null ? {} : { "browser_search_history.json": computeChecksum(browserSearchHistoryStr) }),
      ...Object.fromEntries([...media].map(([path, bytes]) => [path, `sha256:${sha256Hex(bytes)}`])),
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
    ...(r4Str === null ? [] : [{ path: "r4.json", data: r4Str }]),
    ...(historyStr === null ? [] : [{ path: "note_revisions.json", data: historyStr }]),
    ...(subscriptionsStr === null ? [] : [{ path: "subscriptions.json", data: subscriptionsStr }]),
    ...(mailStr === null ? [] : [{ path: "mail.json", data: mailStr }]),
    ...(reviewHistoryStr === null ? [] : [{ path: "review_history.json", data: reviewHistoryStr }]),
    ...(searchHistoryStr === null ? [] : [{ path: "search_history.json", data: searchHistoryStr }]),
    ...(deletedRecordsStr === null ? [] : [{ path: "deleted_records.json", data: deletedRecordsStr }]),
    ...(browserSearchHistoryStr === null ? [] : [{ path: "browser_search_history.json", data: browserSearchHistoryStr }]),
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
    if (dataStart + compSize > buffer.length) {
      // 截断的包：宁可拒绝恢复也不能把半截附件写进库
      throw new Error(`备份包已截断（条目 ${filename} 不完整），可能传输损坏，拒绝恢复`);
    }

    if (compMethod === 0) {
      // Store 模式 (无压缩)
      if (result.has(filename)) {
        throw new Error(`备份包含重复条目 ${filename}，结构损坏，拒绝恢复`);
      }
      result.set(filename, buffer.slice(dataStart, dataStart + compSize));
    } else {
      // 我们只写 Store 模式；带压缩方式的包可能是别的工具产出的，如实拒绝
      // （不要把「支持我们自己生成的 ZIP」表述成通用 ZIP 支持）。
      throw new Error(`备份包条目 ${filename} 使用了不支持的压缩方式（${compMethod}），拒绝恢复`);
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
  const isBrowserProfile = manifest.profile === "browser";
  if (manifest.profile !== undefined && !isBrowserProfile) throw new Error("备份包 profile 无效");
  const isBrowserV12 = manifest.schemaVersion === 12 && isBrowserProfile;
  if (!Number.isInteger(manifest.schemaVersion) || manifest.schemaVersion < 1 || manifest.schemaVersion > 11 && !isBrowserV12 || isBrowserProfile && !isBrowserV12) {
    throw new Error(`不支持的备份包版本 ${manifest.schemaVersion}（本应用支持 v1–v11 和浏览器 v12）`);
  }
  // 浏览器 v12 是独立能力分支；它保留 v4 基础文件与校验规则，不声称
  // 携带桌面 v5–v11 的项目、历史、订阅、邮箱或回收站数据。
  const contentVersion = isBrowserV12 ? 4 : manifest.schemaVersion;

  // 校验和（T06，审计 KF-009）：恢复写入前逐文件核对，不匹配即整体拒绝。
  // v3 是 sha256:<hex>；v2 的 8 位裸值按旧 FNV 校验——旧包不豁免，
  // 「篡改 notes 仍被接受」的旧行为在这里红转绿。
  const checksumErrors: string[] = [];
  const coreFiles = ["cards.json", "materials.json", "settings.json", "artifacts.json", "notes.json", "knowledge_bases.json"];
  if (contentVersion >= 5) coreFiles.push("r4.json");
  if (contentVersion >= 6) coreFiles.push("note_revisions.json");
  if (contentVersion >= 7) coreFiles.push("subscriptions.json");
  if (contentVersion >= 8) coreFiles.push("mail.json");
  if (contentVersion >= 9) coreFiles.push("review_history.json");
  // 旧 Go 导出在没有搜索历史时生成 v11，且文件、校验和、条数均不声明。
  const legacyMissingSearch = contentVersion === 11 && !rawFiles.has("search_history.json") &&
    !Object.hasOwn(manifest.checksums ?? {}, "search_history.json") && !Object.hasOwn(manifest.stats ?? {}, "searchHistory");
  if (contentVersion >= 10 && !legacyMissingSearch) coreFiles.push("search_history.json");
  if (contentVersion >= 11) coreFiles.push("deleted_records.json");
  if (isBrowserV12) coreFiles.push("browser_search_history.json");
  const isMedia = (name: string) => /^media\/(audio|image|ink)\/[A-Za-z0-9._-]+$/.test(name);
  if (contentVersion >= 3) {
    for (const name of coreFiles) {
      if (!rawFiles.has(name) || !/^sha256:[0-9a-f]{64}$/.test(manifest.checksums?.[name] ?? "")) {
        checksumErrors.push(`${name}：文件或 SHA-256 校验和缺失`);
      }
    }
  }
  if (contentVersion >= 4) {
    for (const name of rawFiles.keys()) {
      if (name === "manifest.json" || coreFiles.includes(name)) continue;
      if (!isMedia(name)) checksumErrors.push(`${name}：备份包含不支持的条目`);
      else if (!/^sha256:[0-9a-f]{64}$/.test(manifest.checksums?.[name] ?? "")) checksumErrors.push(`${name}：附件 SHA-256 校验和缺失`);
    }
  }
  for (const [file, declared] of Object.entries(manifest.checksums ?? {})) {
    const actual = rawFiles.get(file);
    if (actual === undefined) {
      checksumErrors.push(`${file}：manifest 声明了校验和但包里没有该文件`);
      continue;
    }
    const matches = typeof declared === "string" && (declared.startsWith("sha256:")
      ? `sha256:${sha256Hex(actual)}` === declared
      : contentVersion < 3 && legacyFnvChecksum(new TextDecoder("utf-8").decode(actual)) === declared);
    if (!matches) checksumErrors.push(`${file}：校验和不匹配（文件可能已被修改或损坏）`);
  }
  if (checksumErrors.length > 0) {
    throw new Error(`备份包校验失败，拒绝恢复：${checksumErrors.join("；")}`);
  }

  // 计数对账：manifest.stats 声称的条数必须与包内实际一致
  // （先查存在性再解析：缺文件是「结构不完整」，不是解析错误）
  const statsErrors: string[] = [];
  const stats = manifest.stats ?? {};
  const subscriptions = contentVersion >= 7 ? validateSubscriptions(JSON.parse(files.get("subscriptions.json")!)) : undefined;
  const rawMail: unknown = contentVersion >= 8 ? JSON.parse(files.get("mail.json")!) : undefined;
  const reviewHistory = contentVersion >= 9 ? validateReviewHistory(JSON.parse(files.get("review_history.json")!)) : undefined;
  const searchHistory = isBrowserV12
    ? parseSearchHistoryJson(files.get("browser_search_history.json")!)
    : contentVersion >= 10 && !legacyMissingSearch ? parseSearchHistoryJson(files.get("search_history.json")!) : undefined;
  const rawActiveMaterials = JSON.parse(files.get("materials.json") ?? "[]") as unknown;
  const rawActiveCards = JSON.parse(files.get("cards.json") ?? "[]") as unknown;
  const rawActiveArtifacts = JSON.parse(files.get("artifacts.json") ?? "[]") as unknown;
  const deletedRecords = contentVersion >= 11
    ? validateDeletedRecords(JSON.parse(files.get("deleted_records.json")!),
      Array.isArray(rawActiveMaterials) ? rawActiveMaterials as RawMaterial[] : [],
      Array.isArray(rawActiveCards) ? rawActiveCards : [],
      Array.isArray(rawActiveArtifacts) ? rawActiveArtifacts as Artifact[] : [])
    : undefined;
  if (subscriptions && (!Number.isSafeInteger(stats.subscriptions) || stats.subscriptions !== subscriptions.items.length || !Number.isSafeInteger(stats.subscriptionsExcluded) || stats.subscriptionsExcluded !== subscriptions.excludedCount)) statsErrors.push("订阅快照数量不匹配");
  if (reviewHistory && (!Number.isSafeInteger(stats.reviewEvents) || stats.reviewEvents !== reviewHistory.events.length)) statsErrors.push("逐次复习事件数量不匹配");
  if (searchHistory && (!Number.isSafeInteger(stats.searchHistory) || stats.searchHistory !== searchHistory.length)) statsErrors.push("搜索历史数量不匹配");
  if (deletedRecords && (!Number.isSafeInteger(stats.deletedMaterials) || stats.deletedMaterials !== deletedRecords.materials.length ||
      !Number.isSafeInteger(stats.deletedCards) || stats.deletedCards !== deletedRecords.cards.length ||
      !Number.isSafeInteger(stats.deletedArtifacts) || stats.deletedArtifacts !== deletedRecords.artifacts.length)) statsErrors.push("回收站快照数量不匹配");
  let r4: unknown = undefined;
  if (contentVersion >= 5) {
    const rawR4: unknown = JSON.parse(files.get("r4.json")!);
    const declared = stats.r4;
    if (rawR4 === null && contentVersion >= 6) {
      if (declared !== undefined) statsErrors.push("项目与画像快照数量不匹配");
    } else {
      r4 = rawR4;
      const actual = r4Counts(r4);
      if (!declared || typeof declared !== "object" || Array.isArray(declared) || Object.keys(declared).length !== R4_TABLES.length ||
          R4_TABLES.some((name) => !Number.isSafeInteger(declared[name]) || declared[name] !== actual[name])) {
        statsErrors.push("项目与画像快照数量不匹配");
      }
    }
  }
  const notesRawStr = files.get("notes.json");
  const kbsRawStr = files.get("knowledge_bases.json");
  if (contentVersion >= 2) {
    if (!notesRawStr) statsErrors.push("v2+ 备份包缺少 notes.json");
    if (!kbsRawStr) statsErrors.push("v2+ 备份包缺少 knowledge_bases.json");
    if (statsErrors.length > 0) {
      throw new Error(`备份包结构不完整，拒绝恢复：${statsErrors.join("；")}`);
    }
  }
  const rawNotesCheck = JSON.parse(notesRawStr ?? "[]") as unknown;
  const noteRevisions = contentVersion >= 6 ? validateNoteRevisions(JSON.parse(files.get("note_revisions.json")!), rawNotesCheck) : undefined;
  if (noteRevisions && (!Number.isSafeInteger(stats.noteRevisions) || stats.noteRevisions !== noteRevisions.length)) statsErrors.push("笔记历史修订数量不匹配");
  const countOf = (raw: unknown) => (Array.isArray(raw) ? raw.length : null);
  const checks: Array<[string, number | undefined, number | null]> = [
    ["cards", stats.cards, countOf(JSON.parse(files.get("cards.json") ?? "[]"))],
    ["materials", stats.materials, countOf(JSON.parse(files.get("materials.json") ?? "[]"))],
    ["artifacts", stats.artifacts, countOf(JSON.parse(files.get("artifacts.json") ?? "[]"))],
    ["notes", stats.notes, countOf(rawNotesCheck)],
    ["knowledgeBases", stats.knowledgeBases, countOf(((JSON.parse(files.get("knowledge_bases.json") ?? "{}") as { knowledgeBases?: unknown[] }).knowledgeBases) ?? [])],
    ["media", stats.media, [...rawFiles.keys()].filter(isMedia).length],
    ...(deletedRecords ? [
      ["deletedMaterials", stats.deletedMaterials, deletedRecords.materials.length] as [string, number | undefined, number | null],
      ["deletedCards", stats.deletedCards, deletedRecords.cards.length] as [string, number | undefined, number | null],
      ["deletedArtifacts", stats.deletedArtifacts, deletedRecords.artifacts.length] as [string, number | undefined, number | null],
    ] : []),
  ];
  for (const [label, declared, actual] of checks) {
    if (contentVersion >= 4 && (!Number.isSafeInteger(declared) || declared! < 0 || actual === null)) {
      statsErrors.push(`${label} 数量或数据结构无效`);
      continue;
    }
    if (declared !== undefined && actual !== null && declared !== actual) {
      statsErrors.push(`${label} 声称 ${declared} 条、包里实际 ${actual} 条`);
    }
  }
  if (statsErrors.length > 0) {
    throw new Error(`备份包计数对不上，拒绝恢复：${statsErrors.join("；")}`);
  }

  // 1. 读取并校验 cards.json
  const cardsRaw = files.get("cards.json") ?? "[]";
  const rawCards = JSON.parse(cardsRaw) as unknown[];
  const cards = Array.isArray(rawCards) ? rawCards.map((c) => cardFromJson(c)) : [];

  // 2. 读取 materials.json
  const materialsRaw = files.get("materials.json") ?? "[]";
  const rawMaterials = JSON.parse(materialsRaw) as unknown[];
  const materials = Array.isArray(rawMaterials) ? (rawMaterials as RawMaterial[]) : [];
  const mail = rawMail === undefined ? undefined : validateMailSnapshot(rawMail, materials);
  validateDeletedMailBindings(mail, deletedRecords);
  if (mail && (stats.mailAccounts !== mail.accounts.length || stats.mailSyncStates !== mail.syncStates.length || stats.mailImports !== mail.imports.length || stats.mailRejected !== mail.rejected.length)) {
    throw new Error("邮箱备份快照数量不匹配，拒绝恢复");
  }

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
    if (!isMedia(name)) continue;
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
    r4,
    noteRevisions,
    subscriptions,
    mail,
    reviewHistory,
    searchHistory,
    deletedRecords,
    uncheckedMediaPaths: [...media.keys()].filter((name) => !/^sha256:[0-9a-f]{64}$/.test(manifest.checksums?.[name] ?? "")),
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
  kbMembership: Record<string, number> = {},
  r4: unknown = null,
  noteRevisions: NoteRevision[] | null = null,
  subscriptions: SubscriptionSnapshot | null = null,
  mail: MailSnapshot | null = null,
  reviewHistory: ReviewHistorySnapshot | null = null,
  searchHistory: string[] | null = null,
  deletedRecords: DeletedRecordsSnapshot | null = null,
  browserSearchHistory: string[] | null = null
): void {
  const bytes = createKfBackupArchive(materials, cards, settingsFile, artifacts, media, notes, knowledgeBases, kbMembership, r4, noteRevisions, subscriptions, mail, reviewHistory, searchHistory, deletedRecords, browserSearchHistory);
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
