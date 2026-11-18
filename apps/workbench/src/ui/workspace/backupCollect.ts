import {
  backupCaptureDatabase,
  inShell,
  loadStore,
  readMedia,
  type Artifact,
  type RawMaterial,
} from "../../shell/store";
import { readArtifacts, readNotes, readWorkspace } from "./repository";
import { parseSettings, type SettingsFile } from "../../domain/settings";
import type { KnowledgeCard } from "../../domain/card";
import { noteFromJson, type KnowledgeBase, type Note, type NoteRevision } from "../../domain/note";
import { BACKUP_BROWSER_FORMAT_GAP, BACKUP_FORMAT_GAP, BACKUP_V5_FORMAT_GAP, BACKUP_V6_FORMAT_GAP, BACKUP_V6_NO_R4_GAP, BACKUP_V7_FORMAT_GAP, BACKUP_V7_NO_R4_GAP, BACKUP_V8_FORMAT_GAP, BACKUP_V8_NO_R4_GAP, BACKUP_V9_FORMAT_GAP, BACKUP_V9_NO_R4_GAP, BACKUP_V10_FORMAT_GAP, BACKUP_V10_NO_R4_GAP, BACKUP_V11_FORMAT_GAP, BACKUP_V11_NO_R4_GAP, mailSourcesWithoutOriginal, type DeletedRecordsSnapshot, type MailSnapshot, type SubscriptionSnapshot } from "../../domain/systemBackup";
import type { ReviewHistorySnapshot } from "../../domain/reviewHistory";
import { noteMediaPaths } from "../../domain/mediaMime";
import { validateSearchHistorySnapshot } from "../../domain/searchHistory";

/**
 * 备份采集的唯一入口（T03，审计 KF-001 / KF-008）。
 *
 * 之前导出直接用 Workspace 的界面缓存 `notesState`——只有用户打开过笔记页
 * 它才有数据，冷启动直接导出会漏掉全部新笔记还报告「完整备份」。现在
 * 导出前从这里读**权威仓储**：分页遍历全部素材/卡片/笔记（含回收站）/
 * 产物/附件，不受界面 limit 限制；界面是否挂载、用户点过哪页都无关。
 */

export interface BackupDraftFlushResult {
  /** 是否真有草稿需要处置（没有则为 false）。 */
  attempted: boolean;
  /** 草稿是否已确认落库；false 时备份回执必须说明「不是完整备份」。 */
  saved: boolean;
}

type DraftFlusher = () => Promise<BackupDraftFlushResult>;

let draftFlusher: DraftFlusher | null = null;

/** NotesView 挂载时注册：导出前把未保存草稿的处置权交给保存会话。 */
export function registerNotesDraftFlusher(fn: DraftFlusher | null): void {
  draftFlusher = fn;
}

/**
 * 导出前先给当前草稿一个明确保存或保留结果。
 * 有 8 秒上限——保存通道挂死时导出不跟着挂死，但回执会如实说草稿没进去。
 */
export async function flushNotesDraftsBeforeBackup(): Promise<BackupDraftFlushResult> {
  if (!draftFlusher) return { attempted: false, saved: true };
  try {
    return await Promise.race([
      draftFlusher(),
      new Promise<BackupDraftFlushResult>((resolve) =>
        setTimeout(() => resolve({ attempted: true, saved: false }), 8000)
      ),
    ]);
  } catch {
    return { attempted: true, saved: false };
  }
}

export interface BackupSnapshot {
  materials: RawMaterial[];
  cards: KnowledgeCard[];
  /** 全量笔记（含回收站里的删除态）。 */
  notes: Note[];
  noteRevisions: NoteRevision[] | null;
  subscriptions: SubscriptionSnapshot | null;
  subscriptionsError: string | null;
  mail: MailSnapshot | null;
  mailError: string | null;
  reviewHistory: ReviewHistorySnapshot | null;
  reviewHistoryError: string | null;
  searchHistory: string[] | null;
  searchHistoryError: string | null;
  deletedRecords: DeletedRecordsSnapshot | null;
  deletedRecordsError: string | null;
  knowledgeBases: KnowledgeBase[];
  membership: Record<string, number>;
  artifacts: Artifact[];
  /** 附件字节，键是库内相对路径。 */
  media: Map<string, Uint8Array>;
  /** 读不到字节的附件路径——「完整」与「部分」按这份清单区分。 */
  mediaFailures: string[];
  /** 产物层读取失败原因。 */
  artifactsError: string | null;
  /** 可安全随 v5/v6 包携带的项目、目标与画像快照。 */
  r4: unknown | null;
  r4Error: string | null;
  draft: BackupDraftFlushResult;
}

/**
 * 导出回执的唯一口径（T11：顶栏与设置页共用同一句判定）。
 *
 * 完整备份与部分备份的措辞此前在两处各写一遍——改一处就漂移，
 * 用户会在不同入口看到不同的说法。这里收敛成一个函数。
 */
export function backupReceipt(snapshot: BackupSnapshot, opts: { detailed?: boolean } = {}): string {
  const gaps = backupCompleteness(snapshot);
  const deleted = snapshot.deletedRecords;
  const deletedCount = deleted ? deleted.materials.length + deleted.cards.length + deleted.artifacts.length : 0;
  const scale = opts.detailed
    ? `${snapshot.notes.length} 篇笔记、${snapshot.cards.length} 张卡片、${snapshot.materials.length} 份素材、${snapshot.artifacts.length} 条产物、${snapshot.media.size} 个附件`
    : `${snapshot.cards.length} 张卡片、${snapshot.materials.length} 份素材、${snapshot.artifacts.length} 条认知产物、${snapshot.notes.length} 篇笔记、${snapshot.media.size} 个附件`;
  const trash = snapshot.deletedRecords !== null ? `，含回收站 ${deletedCount} 条` : "";
  if (gaps.length === 0) {
    return `已导出完整备份包 (.kfbackup)：${scale}${trash}，不含 API 密钥`;
  }
  return `已导出部分备份包：${scale}${trash}。${gaps.join("；")}——不是完整备份。备份格式为 v${backupVersion(snapshot)}，旧版工作台无法恢复。`;
}

export function backupVersion(snapshot: BackupSnapshot): number {
  if (snapshot.noteRevisions === null && snapshot.searchHistory !== null) return 12;
  return snapshot.noteRevisions === null ? (snapshot.r4 === null ? 4 : 5) : snapshot.subscriptions === null ? 6 : snapshot.mail === null ? 7 : snapshot.reviewHistory === null ? 8 : snapshot.searchHistory === null ? 9 : snapshot.deletedRecords === null ? 10 : 11;
}

/** 与设置页/顶栏共用的回执判定：任一项不为空就是「部分备份」。 */
export function backupCompleteness(snapshot: BackupSnapshot): string[] {
  // v3 包没有这些权威数据的序列化与恢复路径；即使没有读取错误也不能称完整。
  const browserSearchProfile = snapshot.noteRevisions === null && snapshot.searchHistory !== null;
  const gaps: string[] = [browserSearchProfile ? BACKUP_BROWSER_FORMAT_GAP : snapshot.noteRevisions === null ? (snapshot.r4 === null ? BACKUP_FORMAT_GAP : BACKUP_V5_FORMAT_GAP) : snapshot.subscriptions === null ? (snapshot.r4 === null ? BACKUP_V6_NO_R4_GAP : BACKUP_V6_FORMAT_GAP) : snapshot.mail === null ? (snapshot.r4 === null ? BACKUP_V7_NO_R4_GAP : BACKUP_V7_FORMAT_GAP) : snapshot.reviewHistory === null ? (snapshot.r4 === null ? BACKUP_V8_NO_R4_GAP : BACKUP_V8_FORMAT_GAP) : snapshot.searchHistory === null ? (snapshot.r4 === null ? BACKUP_V9_NO_R4_GAP : BACKUP_V9_FORMAT_GAP) : snapshot.deletedRecords === null ? (snapshot.r4 === null ? BACKUP_V10_NO_R4_GAP : BACKUP_V10_FORMAT_GAP) : (snapshot.r4 === null ? BACKUP_V11_NO_R4_GAP : BACKUP_V11_FORMAT_GAP)];
  if (snapshot.r4Error) gaps.push(`项目、目标和画像未纳入备份（${snapshot.r4Error}）`);
  if (snapshot.subscriptionsError) gaps.push(`订阅未纳入备份（${snapshot.subscriptionsError}）`);
  if (snapshot.subscriptions?.excludedCount) gaps.push(`${snapshot.subscriptions.excludedCount} 条订阅因地址含参数或格式不支持而未纳入`);
  if (snapshot.mailError) gaps.push(`邮箱账号与同步状态未纳入备份（${snapshot.mailError}）`);
  if (snapshot.reviewHistoryError) gaps.push(`逐次复习历史未纳入备份（${snapshot.reviewHistoryError}）`);
  else if (!snapshot.reviewHistory) gaps.push("逐次复习历史未纳入备份");
  else if (snapshot.reviewHistory && backupVersion(snapshot) < 9) gaps.push("逐次复习历史已读取，但前置备份快照不完整，未写入包");
  if (snapshot.searchHistoryError) gaps.push(`搜索历史未纳入备份（${snapshot.searchHistoryError}）`);
  else if (snapshot.searchHistory === null) gaps.push("搜索历史未纳入备份");
  else if (backupVersion(snapshot) < 10) gaps.push("搜索历史已读取，但前置备份快照不完整，未写入包");
  if (snapshot.deletedRecordsError) gaps.push(`回收站内容未纳入备份（${snapshot.deletedRecordsError}）`);
  else if (snapshot.deletedRecords === null) gaps.push("回收站内容未纳入备份");
  else if (backupVersion(snapshot) < 11) gaps.push("回收站内容已读取，但前置备份快照不完整，未写入包");
  if (snapshot.mail) {
    const unavailable = mailSourcesWithoutOriginal(snapshot.mail, backupVersion(snapshot) === 11 ? snapshot.deletedRecords : null);
    if (unavailable) gaps.push(`${unavailable} 条邮箱导入记录指向已删除或缺失的素材，原件不在本包`);
  }
  if (!snapshot.draft.saved) gaps.push("当前草稿未能落库，这次备份不含它的最新内容");
  if (snapshot.artifactsError) gaps.push(`认知产物读取失败（${snapshot.artifactsError}），这次备份不含产物`);
  if (snapshot.mediaFailures.length > 0) gaps.push(`${snapshot.mediaFailures.length} 个附件读取失败`);
  return gaps;
}

export function webdavBackupReceipt(result: { fileName: string; sha256: string; bytes: number; gaps: string[]; version?: number }): string {
  const scope = result.gaps.length ? `部分备份：${result.gaps.join("；")}。` : "备份快照。";
  return `已上传 ${result.fileName}（${(result.bytes / 1024 / 1024).toFixed(1)} MB，SHA-256 ${result.sha256.slice(0, 12)}…）——${scope}备份格式为 v${result.version ?? 4}，旧版工作台无法恢复。这是单向备份，不是双向同步。`;
}

/** 素材附件 + 笔记正文引用的附件都算备份对象（删过素材但笔记还引用的场景不丢字节）。 */
function collectMediaPaths(materials: RawMaterial[], notes: Note[], history: NoteRevision[], deletedMaterials: RawMaterial[] = []): string[] {
  const wanted = new Set<string>();
  for (const m of materials) if (m.mediaPath) wanted.add(m.mediaPath);
  for (const m of deletedMaterials) if (m.mediaPath) wanted.add(m.mediaPath);
  for (const n of notes) {
    for (const path of noteMediaPaths(n.bodyMd)) wanted.add(path);
  }
  for (const revision of history) for (const path of noteMediaPaths(revision.bodyMd)) wanted.add(path);
  return [...wanted];
}

/**
 * 采集一份备份快照：先处置草稿，再从 SQLite 同一快照读取活动内容与回收站记录。
 * 抛错只可能是仓储本身读不了——部分内容的缺失一律走快照里的失败清单。
 */
export async function collectBackupSnapshot(dir: string): Promise<BackupSnapshot> {
  const draft = await flushNotesDraftsBeforeBackup();

  if (!inShell()) {
    // 浏览器体验：库整体在 localStorage，readWorkspace/readNotes 就是权威层。
    const [ws, state] = await Promise.all([readWorkspace(), readNotes(dir)]);
    let artifacts: Artifact[] = [];
    let artifactsError: string | null = null;
    try {
      artifacts = await readArtifacts(dir);
    } catch (err) {
      artifactsError = err instanceof Error ? err.message : String(err);
    }
    return {
      materials: ws.materials,
      cards: ws.cards,
      notes: state.notes,
      noteRevisions: null,
      subscriptions: null,
      subscriptionsError: null,
      mail: null,
      mailError: null,
      reviewHistory: null,
      reviewHistoryError: "浏览器体验不支持逐次复习历史备份",
      searchHistory: (() => {
        try {
          return ws.searchHistory === null ? [] : validateSearchHistorySnapshot(JSON.parse(ws.searchHistory) as unknown);
        } catch {
          return null;
        }
      })(),
      searchHistoryError: (() => {
        try {
          if (ws.searchHistory !== null) validateSearchHistorySnapshot(JSON.parse(ws.searchHistory) as unknown);
          return null;
        } catch {
          return "搜索历史损坏或无法读取";
        }
      })(),
      deletedRecords: null,
      deletedRecordsError: "浏览器体验不支持回收站内容备份",
      knowledgeBases: state.knowledgeBases,
      membership: state.membership,
      artifacts,
      media: new Map(),
      mediaFailures: [],
      artifactsError,
      r4: null,
      r4Error: null,
      draft,
    };
  }

  const db = await backupCaptureDatabase(dir);
  const { materials, cards, artifacts, artifactsError } = db;
  const notesState = { notes: db.notes.map(noteFromJson), knowledgeBases: db.knowledgeBases, membership: db.membership };

  const noteRevisions = Array.isArray(db.noteRevisions) ? db.noteRevisions : null;
  const subscriptions = noteRevisions === null ? null : db.subscriptions ?? null;
  const mail = subscriptions === null ? null : db.mail ?? null;
  let searchHistory: string[] | null = null;
  let searchHistoryError: string | null = null;
  if (noteRevisions !== null && subscriptions !== null && mail !== null && db.reviewHistory != null) {
    try {
      const store = await loadStore(dir);
      searchHistory = store.searchHistory === null
        ? []
        : validateSearchHistorySnapshot(JSON.parse(store.searchHistory) as unknown);
    } catch {
      searchHistoryError = "搜索历史文件损坏或无法读取";
    }
  } else {
    searchHistoryError = "v10 前置快照不完整，未采集搜索历史";
  }
  const deletedRecords = db.deletedRecords ?? null;
  const deletedRecordsError = db.deletedRecordsError ?? null;
  const canIncludeDeletedRecords = noteRevisions !== null && subscriptions !== null && mail !== null && db.reviewHistory != null && searchHistory !== null && deletedRecords !== null;
  const media = new Map<string, Uint8Array>();
  const mediaFailures: string[] = [];
  for (const rel of collectMediaPaths(materials, notesState.notes, noteRevisions ?? [], canIncludeDeletedRecords ? deletedRecords.materials.map((record) => record.material) : [])) {
    try {
      const bytes = await readMedia(rel, dir);
      if (bytes) media.set(rel, bytes);
      else mediaFailures.push(rel);
    } catch {
      mediaFailures.push(rel);
    }
  }

  return {
    materials,
    cards,
    notes: notesState.notes,
    noteRevisions,
    subscriptions,
    subscriptionsError: db.subscriptionsError ?? null,
    mail,
    mailError: db.mailError ?? (db.mail && subscriptions === null ? "依赖的笔记历史或订阅快照不可用" : null),
    reviewHistory: db.reviewHistory ?? null,
    reviewHistoryError: db.reviewHistoryError ?? null,
    searchHistory,
    searchHistoryError,
    deletedRecords,
    deletedRecordsError,
    knowledgeBases: notesState.knowledgeBases,
    membership: notesState.membership,
    artifacts,
    media,
    mediaFailures,
    artifactsError,
    r4: db.r4,
    r4Error: db.r4Error,
    draft,
  };
}

/** 备份用的设置文件：从权威层现读（工作台内存里的 file 可能落后于落盘值）。 */
export async function readCurrentSettings(dir: string): Promise<SettingsFile> {
  if (!inShell()) {
    const ws = await readWorkspace();
    return ws.file;
  }
  const snapshot = await loadStore(dir);
  return parseSettings(snapshot.settings);
}
