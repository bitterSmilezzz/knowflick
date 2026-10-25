import { invoke } from "@tauri-apps/api/core";
import {
  dbListMaterials,
  dbLoadCards,
  dbSaveMaterial,
  dbUpsertCard,
  inShell,
  kbAddNote,
  kbCreate,
  kbList,
  kbMembership,
  kbRemoveNote,
  kbRestoreMembership,
  loadStore,
  readImportReport,
  saveImportReport,
  readMedia,
  noteDelete,
  goalListActive,
  noteEnsureFromMaterial,
  noteListScope,
  noteRestore,
  noteRestoreUpsert,
  noteUpsert,
  readApiKey,
  saveSettings,
  writeApiKey,
  type RawMaterial,
} from "../../shell/store";
import { parseImportReport, serializeImportReport, type ImportReport } from "../../domain/importReport";
import {
  NoteConflictError,
  addNoteToKb as domainAddToKb,
  createKnowledgeBase as domainCreateKb,
  deleteNote as domainDeleteNote,
  createNoteDraft,
  emptyNotesState,
  restoreNote as domainRestoreNote,
  restoreNoteRaw as domainRestoreNoteRaw,
  noteFromJson,
  removeNoteFromKb as domainRemoveFromKb,
  upsertNote as domainUpsert,
  type KnowledgeBase,
  type Note,
  type NoteRestoreAction,
  type NoteSaveOutcome,
  type NotesState,
} from "../../domain/note";
import type { KnowledgeCard } from "../../domain/card";
import type { Goal } from "../../shell/store";
import { encodeSettings, parseSettings, type SettingsFile } from "../../domain/settings";

interface BrowserData { materials: RawMaterial[]; cards: KnowledgeCard[]; settings: string | null }
const browserKey = "knowflick.workspace.v1";
function browserData(): BrowserData {
  const raw = localStorage.getItem(browserKey);
  if (!raw) return { materials: [], cards: [], settings: null };
  const parsed = JSON.parse(raw) as BrowserData;
  if (!Array.isArray(parsed.materials) || !Array.isArray(parsed.cards)) throw new Error("浏览器存储格式损坏，请先导出数据再处理");
  return parsed;
}
/**
 * 写入浏览器体验库。
 *
 * 整个库只有一个 localStorage key，配额约 6 MB，超了 setItem 直接抛
 * QuotaExceededError——用户看到的是一串英文异常，还可能以为内容存住了。
 * 这里翻译成明确的中文提示，并带上「哪些内容没能存下」的线索。
 */
function browserWrite(data: BrowserData) {
  const payload = JSON.stringify(data);
  try {
    localStorage.setItem(browserKey, payload);
  } catch (err) {
    if (err instanceof DOMException && err.name === "QuotaExceededError") {
      const sizeMb = (payload.length / 1024 / 1024).toFixed(1);
      throw new Error(
        `浏览器存储已满（当前约 ${sizeMb} MB，上限约 6 MB），这次改动没能保存。` +
          "导出备份后清理内容，或改用桌面客户端——那边有完整的本机数据库。"
      );
    }
    throw err;
  }
}
export interface WorkspaceSnapshot { dir: string; materials: RawMaterial[]; cards: KnowledgeCard[]; file: SettingsFile; apiKey: string }
export async function readWorkspace(): Promise<WorkspaceSnapshot> {
  if (!inShell()) {
    const data = browserData();
    return { dir: "", ...data, file: parseSettings(data.settings), apiKey: sessionStorage.getItem("knowflick.workspace.key") || "" };
  }
  const snapshot = await loadStore();
  const cards: KnowledgeCard[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await dbLoadCards(snapshot.dir, 200, offset);
    cards.push(...page);
    if (page.length < 200) break;
  }
  return { dir: snapshot.dir, materials: await dbListMaterials(false, snapshot.dir, 10000), cards, file: parseSettings(snapshot.settings), apiKey: await readApiKey(snapshot.dir) };
}
export async function storeMaterial(material: RawMaterial, dir: string): Promise<void> {
  if (inShell()) { await dbSaveMaterial(material, dir); return; }
  const data = browserData();
  browserWrite({ ...data, materials: [material, ...data.materials.filter(m => m.id !== material.id)] });
}
export async function storeCard(card: KnowledgeCard, dir: string): Promise<void> {
  if (inShell()) { await dbUpsertCard(card, dir); return; }
  const data = browserData();
  browserWrite({ ...data, cards: [card, ...data.cards.filter(c => c.id !== card.id)] });
}
export async function storeCardList(cards: KnowledgeCard[], dir: string): Promise<void> {
  if (inShell()) { await invoke("db_replace_cards", { dir, cards }); return; }
  browserWrite({ ...browserData(), cards });
}
export async function storePreferences(file: SettingsFile, key: string, dir: string): Promise<void> {
  if (inShell()) { await saveSettings(dir, encodeSettings(file)); await writeApiKey(dir, key); return; }
  browserWrite({ ...browserData(), settings: encodeSettings(file) });
  sessionStorage.setItem("knowflick.workspace.key", key);
}

// ---------- 笔记与知识库（R1）：桌面走 SQLite 命令，浏览器体验走领域纯函数 + localStorage ----------

const notesKey = "knowflick.notes.v1";
const notesCorruptedKey = "knowflick.notes.corrupted";

/**
 * 浏览器笔记存储损坏异常（T07，收口审计 KF-010）。
 * 携带损坏的原始字符串与原因，阻止任何后续写操作静默覆盖原始数据。
 */
export class BrowserNotesCorruptError extends Error {
  constructor(readonly rawData: string, readonly reason: string) {
    super(`浏览器笔记存储损坏（${reason}）。已锁定写操作并隔离备份原始数据，请先导出备份或恢复后再进行修改。`);
    this.name = "BrowserNotesCorruptError";
  }
}

let isNotesCorruptedLocked = false;

export function readCorruptedNotesBackup(): string | null {
  try {
    return localStorage.getItem(notesCorruptedKey);
  } catch {
    return null;
  }
}

export function clearCorruptedNotesLockAndReset(): void {
  isNotesCorruptedLocked = false;
  try {
    localStorage.removeItem(notesCorruptedKey);
  } catch {
    /* 忽略 */
  }
}

function preserveCorruptedRaw(raw: string, reason: string): never {
  isNotesCorruptedLocked = true;
  try {
    localStorage.setItem(notesCorruptedKey, raw);
  } catch {
    // 若 localStorage 配额超限无法写入备份 key，依然保持锁定保护，不吞原始 raw
  }
  throw new BrowserNotesCorruptError(raw, reason);
}

function browserNotes(): NotesState {
  if (isNotesCorruptedLocked) {
    const backup = readCorruptedNotesBackup() || localStorage.getItem(notesKey) || "";
    throw new BrowserNotesCorruptError(backup, "存储处于损坏锁定保护状态");
  }
  const raw = localStorage.getItem(notesKey);
  if (!raw || !raw.trim()) return emptyNotesState();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    preserveCorruptedRaw(raw, `JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    preserveCorruptedRaw(raw, "根结构不是有效的对象");
  }

  const p = parsed as Partial<NotesState>;
  if (p.notes !== undefined && !Array.isArray(p.notes)) {
    preserveCorruptedRaw(raw, "notes 字段不是数组");
  }
  if (p.knowledgeBases !== undefined && !Array.isArray(p.knowledgeBases)) {
    preserveCorruptedRaw(raw, "knowledgeBases 字段不是数组");
  }
  if (p.membership !== undefined && (typeof p.membership !== "object" || p.membership === null || Array.isArray(p.membership))) {
    preserveCorruptedRaw(raw, "membership 字段不是键值映射");
  }

  const notesList = p.notes ?? [];
  for (const item of notesList) {
    if (typeof item !== "object" || item === null || !("id" in item) || typeof (item as { id: unknown }).id !== "string") {
      preserveCorruptedRaw(raw, "notes 数组中包含缺少 id 或非对象的条目");
    }
  }

  return {
    notes: notesList,
    knowledgeBases: p.knowledgeBases ?? [],
    membership: p.membership ?? {},
  };
}

function browserNotesWrite(state: NotesState) {
  if (isNotesCorruptedLocked) {
    throw new Error("浏览器笔记数据已损坏且已锁定写入保护。为防止覆盖残留数据，禁止写入。");
  }
  try {
    localStorage.setItem(notesKey, JSON.stringify(state));
  } catch (err) {
    if (err instanceof DOMException && err.name === "QuotaExceededError") {
      throw new Error("浏览器存储已满，这次改动没能保存。导出备份后清理内容，或改用桌面客户端。");
    }
    throw err;
  }
}

/** 读库内附件字节；浏览器体验没有 media/ 文件，返回 null（界面显示「附件缺失」）。 */
export async function readNoteMedia(relative: string, dir: string): Promise<Uint8Array | null> {
  if (!inShell()) return null;
  return await readMedia(relative, dir);
}

export type NoteListScope = "active" | "deleted" | "all";

/**
 * 桌面端按范围分页读笔记（T02，审计 KF-005）。
 *
 * 旧的 `noteList(false, …)` 只列正常笔记，布尔 true 又「只列回收站」——
 * 调用方把它当「包含全部」用，桌面回收站因此一直是空的。现在范围显式
 * 三段，分页走完不设 10000 隐含上限；浏览器仓储本来就是全量数组。
 */
export async function readNotesPage(
  dir: string,
  scope: NoteListScope,
  limit: number,
  offset: number
): Promise<Note[]> {
  if (!inShell()) {
    const all = browserNotes().notes;
    const filtered = scope === "active" ? all.filter((n) => !n.isDeleted) : scope === "deleted" ? all.filter((n) => n.isDeleted) : all;
    return filtered.slice(offset, offset + limit);
  }
  const page = await noteListScope(dir, scope, limit, offset);
  return page.map(noteFromJson);
}

export async function readNotes(dir: string): Promise<NotesState> {
  if (!inShell()) return browserNotes();
  const pageSize = 500;
  const notes: Note[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await readNotesPage(dir, "all", pageSize, offset);
    notes.push(...page);
    if (page.length < pageSize) break;
  }
  const [kbs, membership] = await Promise.all([kbList(dir), kbMembership(dir)]);
  return {
    notes,
    knowledgeBases: kbs as KnowledgeBase[],
    membership,
  };
}

/** 保存笔记：修订冲突统一抛 NoteConflictError（两种实现同一语义）。 */
export async function saveNote(note: Note, baseRevision: number, dir: string): Promise<NoteSaveOutcome> {
  if (inShell()) {
    try {
      return await noteUpsert(
        {
          id: note.id,
          title: note.title,
          bodyMd: note.bodyMd,
          notebook: note.notebook,
          tagsJson: JSON.stringify(note.tags),
          isPinned: note.isPinned,
          isFavorite: note.isFavorite,
          archivedAt: note.archivedAt,
          sourceMaterialId: note.sourceMaterialId,
          currentRevision: note.currentRevision,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
          isDeleted: note.isDeleted,
          deletedAt: note.deletedAt,
        },
        baseRevision,
        dir
      );
    } catch (err) {
      // Rust 侧冲突消息带「当前修订 N」——还原成带结构的错误，界面才能给出
      // 「内容已在别处更新」而不是一句英文异常。
      const message = err instanceof Error ? err.message : String(err);
      const m = message.match(/当前修订 (\d+)/);
      if (m) throw new NoteConflictError(Number(m[1]));
      throw err;
    }
  }
  const { state, outcome } = domainUpsert(browserNotes(), note, baseRevision);
  browserNotesWrite(state);
  return outcome;
}

export async function ensureNoteFromMaterial(
  material: { id: string; title: string; rawText: string; cleanedMarkdown?: string | null },
  dir: string
): Promise<NoteSaveOutcome> {
  if (inShell()) return noteEnsureFromMaterial(material.id, dir);
  const state = browserNotes();
  const existing = state.notes.find((n) => n.sourceMaterialId === material.id && !n.isDeleted);
  if (existing) return { id: existing.id, revision: existing.currentRevision, created: false };
  const note: Note = {
    ...createNoteDraft(Date.now()),
    title: material.title,
    bodyMd: (material.cleanedMarkdown && material.cleanedMarkdown.trim()) || material.rawText,
    sourceMaterialId: material.id,
  };
  const { state: next, outcome } = domainUpsert(state, note, 0);
  browserNotesWrite(next);
  return outcome;
}

// ---------- 导入转换报告（R2 导入向导；桌面 meta 文件，浏览器 localStorage） ----------

const reportKey = "knowflick.importReport.v1";

export async function readLastImportReport(dir: string) {
  const raw = inShell() ? await readImportReport(dir) : localStorage.getItem(reportKey);
  return parseImportReport(raw);
}

export async function saveLastImportReport(report: ImportReport, dir: string): Promise<void> {
  const text = serializeImportReport(report);
  if (inShell()) { await saveImportReport(text, dir); return; }
  localStorage.setItem(reportKey, text);
}

export async function activeGoals(dir: string): Promise<Goal[]> {
  if (inShell()) return goalListActive(dir);
  // 浏览器模式：项目记忆数据层在 R4 尚无浏览器实现——如实返回空
  return [];
}

export async function deleteNoteById(id: string, dir: string): Promise<void> {
  if (inShell()) { await noteDelete(id, dir); return; }
  browserNotesWrite(domainDeleteNote(browserNotes(), id));
}

export async function restoreNoteById(id: string, dir: string): Promise<void> {
  if (inShell()) { await noteRestore(id, dir); return; }
  browserNotesWrite(domainRestoreNote(browserNotes(), id));
}

/**
 * 备份恢复专用写入（T04，审计 KF-003）：按包内当前态原样落库，
 * 修订号/时间/删除态保留，处置结果逐条上报，不与普通编辑混用。
 */
export async function restoreNoteFromBackup(
  note: Note,
  dir: string
): Promise<NoteRestoreAction> {
  if (inShell()) return noteRestoreUpsert(note, dir);
  const { state, action } = domainRestoreNoteRaw(browserNotes(), note);
  if (action !== "skippedLocalNewer" && action !== "skippedDivergent" && action !== "current") {
    browserNotesWrite(state);
  }
  return action;
}

export async function createKnowledgeBaseNamed(id: string, name: string, description: string, dir: string): Promise<void> {
  if (inShell()) { await kbCreate(id, name, description, dir); return; }
  browserNotesWrite(domainCreateKb(browserNotes(), { id, name, description }));
}

export async function addNoteToKnowledgeBase(kbId: string, noteId: string, dir: string): Promise<void> {
  if (inShell()) { await kbAddNote(kbId, noteId, dir); return; }
  browserNotesWrite(domainAddToKb(browserNotes(), kbId, noteId));
}

export async function removeNoteFromKnowledgeBase(kbId: string, noteId: string, dir: string): Promise<void> {
  if (inShell()) { await kbRemoveNote(kbId, noteId, dir); return; }
  browserNotesWrite(domainRemoveFromKb(browserNotes(), kbId, noteId));
}

export interface MembershipRestoreEntry { kbId: string; noteId: string; addedAt: number }
export interface MembershipRestoreOutcome { kbId: string; noteId: string; action: "added" | "existing" | "failed"; error: string | null }

/**
 * 备份恢复专用：按包内 addedAt 挂成员关系（T04，审计 KF-006）。
 * 逐条处置上报；浏览器路径先确认库与笔记都存在（与 Rust 同语义），再幂等写入。
 */
export async function restoreMembershipFromBackup(
  entries: MembershipRestoreEntry[],
  dir: string
): Promise<MembershipRestoreOutcome[]> {
  if (inShell()) {
    const outcomes = await kbRestoreMembership(
      entries.map((e) => ({ kbId: e.kbId, noteId: e.noteId, addedAt: e.addedAt })),
      dir
    );
    return outcomes.map((o) => ({
      kbId: o.kbId,
      noteId: o.noteId,
      action: (["added", "existing", "failed"].includes(o.action) ? o.action : "failed") as MembershipRestoreOutcome["action"],
      error: o.error,
    }));
  }
  const state = browserNotes();
  let next = state;
  let mutated = false;
  const results: MembershipRestoreOutcome[] = [];
  for (const e of entries) {
    if (!next.knowledgeBases.some((k) => k.id === e.kbId)) {
      results.push({ kbId: e.kbId, noteId: e.noteId, action: "failed", error: "知识库不存在" });
      continue;
    }
    if (!next.notes.some((n) => n.id === e.noteId)) {
      results.push({ kbId: e.kbId, noteId: e.noteId, action: "failed", error: "笔记不存在" });
      continue;
    }
    const key = `${e.kbId}\n${e.noteId}`;
    if (next.membership[key] !== undefined) {
      results.push({ kbId: e.kbId, noteId: e.noteId, action: "existing", error: null });
      continue;
    }
    next = domainAddToKb(next, e.kbId, e.noteId, e.addedAt);
    mutated = true;
    results.push({ kbId: e.kbId, noteId: e.noteId, action: "added", error: null });
  }
  if (mutated) browserNotesWrite(next);
  return results;
}
