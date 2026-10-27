import {
  dbListArtifacts,
  dbListMaterials,
  dbLoadCards,
  inShell,
  loadStore,
  readMedia,
  type Artifact,
  type RawMaterial,
} from "../../shell/store";
import { readNotes, readWorkspace } from "./repository";
import { parseSettings, type SettingsFile } from "../../domain/settings";
import type { KnowledgeCard } from "../../domain/card";
import type { KnowledgeBase, Note } from "../../domain/note";

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
  knowledgeBases: KnowledgeBase[];
  membership: Record<string, number>;
  artifacts: Artifact[];
  /** 附件字节，键是库内相对路径。 */
  media: Map<string, Uint8Array>;
  /** 读不到字节的附件路径——「完整」与「部分」按这份清单区分。 */
  mediaFailures: string[];
  /** 产物层读取失败原因（浏览器模式没有产物层，为 null）。 */
  artifactsError: string | null;
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
  const scale = opts.detailed
    ? `${snapshot.notes.length} 篇笔记、${snapshot.cards.length} 张卡片、${snapshot.materials.length} 份素材、${snapshot.artifacts.length} 条产物、${snapshot.media.size} 个附件`
    : `${snapshot.cards.length} 张卡片、${snapshot.materials.length} 份素材、${snapshot.artifacts.length} 条认知产物、${snapshot.notes.length} 篇笔记、${snapshot.media.size} 个附件`;
  if (gaps.length === 0) {
    return `已导出完整备份包 (.kfbackup)：${scale}，不含 API 密钥`;
  }
  return `已导出**部分**备份包：${scale}。${gaps.join("；")}——完整度缺口如上，不是完整备份。`;
}

/** 与设置页/顶栏共用的回执判定：任一项不为空就是「部分备份」。 */
export function backupCompleteness(snapshot: BackupSnapshot): string[] {
  const gaps: string[] = [];
  if (!snapshot.draft.saved) gaps.push("当前草稿未能落库，这次备份不含它的最新内容");
  if (snapshot.artifactsError) gaps.push(`认知产物读取失败（${snapshot.artifactsError}），这次备份不含产物`);
  if (snapshot.mediaFailures.length > 0) gaps.push(`${snapshot.mediaFailures.length} 个附件读取失败`);
  return gaps;
}

async function pageLoop<T>(pageSize: number, fetchPage: (offset: number) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchPage(offset);
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}

/** 素材附件 + 笔记正文引用的附件都算备份对象（删过素材但笔记还引用的场景不丢字节）。 */
function collectMediaPaths(materials: RawMaterial[], notes: Note[]): string[] {
  const wanted = new Set<string>();
  for (const m of materials) if (m.mediaPath) wanted.add(m.mediaPath);
  for (const n of notes) {
    for (const match of n.bodyMd.matchAll(/!\[[^\]]*\]\((media\/(?:audio|image|ink)\/[A-Za-z0-9._-]+)\)/g)) {
      wanted.add(match[1]);
    }
  }
  return [...wanted];
}

/**
 * 采集一份完整备份快照：先处置草稿，再分页读权威层。
 * 抛错只可能是仓储本身读不了——部分内容的缺失一律走快照里的失败清单。
 */
export async function collectBackupSnapshot(dir: string): Promise<BackupSnapshot> {
  const draft = await flushNotesDraftsBeforeBackup();

  if (!inShell()) {
    // 浏览器体验：库整体在 localStorage，readWorkspace/readNotes 就是权威层。
    const [ws, state] = await Promise.all([readWorkspace(), readNotes(dir)]);
    return {
      materials: ws.materials,
      cards: ws.cards,
      notes: state.notes,
      knowledgeBases: state.knowledgeBases,
      membership: state.membership,
      artifacts: [],
      media: new Map(),
      mediaFailures: [],
      artifactsError: null,
      draft,
    };
  }

  const [materials, cards, notesState] = await Promise.all([
    pageLoop(500, (offset) => dbListMaterials(false, dir, 500, offset)),
    pageLoop(200, (offset) => dbLoadCards(dir, 200, offset)),
    readNotes(dir),
  ]);

  let artifacts: Artifact[] = [];
  let artifactsError: string | null = null;
  try {
    artifacts = await pageLoop(500, (offset) => dbListArtifacts(500, dir, offset));
  } catch (err) {
    artifactsError = err instanceof Error ? err.message : String(err);
  }

  const media = new Map<string, Uint8Array>();
  const mediaFailures: string[] = [];
  for (const rel of collectMediaPaths(materials, notesState.notes)) {
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
    knowledgeBases: notesState.knowledgeBases,
    membership: notesState.membership,
    artifacts,
    media,
    mediaFailures,
    artifactsError,
    draft,
  };
}

/** 备份用的设置文件：从权威层现读（工作台内存里的 file 可能落后于落盘值）。 */
export async function readCurrentSettings(dir: string): Promise<SettingsFile | null> {
  if (!inShell()) {
    const ws = await readWorkspace();
    return ws.file;
  }
  const snapshot = await loadStore(dir);
  return parseSettings(snapshot.settings);
}
