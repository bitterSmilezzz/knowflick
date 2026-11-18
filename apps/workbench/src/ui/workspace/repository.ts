import { invoke } from "@tauri-apps/api/core";
import {
  dbListMaterials,
  dbListArtifacts,
  dbDeleteArtifact,
  dbSaveArtifact,
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
  SEARCH_HISTORY_STORAGE_KEY,
  readMedia,
  noteDelete,
  goalListActive,
  noteEnsureFromMaterial,
  noteListScope,
  noteRestore,
  noteRestoreUpsert,
  noteHistoryList,
  noteHistoryRead,
  noteUpsert,
  pickMarkdownSavePath,
  writeTextFile,
  readApiKey,
  saveSettings,
  writeApiKey,
  type RawMaterial,
  type Artifact,
} from "../../shell/store";
import { parseImportReport, serializeImportReport, type ImportReport } from "../../domain/importReport";
import {
  NoteConflictError,
  addNoteToKb as domainAddToKb,
  createKnowledgeBase as domainCreateKb,
  deleteNote as domainDeleteNote,
  createNoteDraft,
  duplicateNoteDraft,
  emptyNotesState,
  moveNotesToNotebook,
  noteToMarkdown,
  restoreNote as domainRestoreNote,
  restoreNoteRaw as domainRestoreNoteRaw,
  noteFromJson,
  removeNoteFromKb as domainRemoveFromKb,
  upsertNote as domainUpsert,
  type KnowledgeBase,
  type Note,
  type NoteRestoreAction,
  type NoteRevision,
  type NoteRevisionSummary,
  type NoteSaveOutcome,
  type NotesState,
} from "../../domain/note";
import { cardFromJson, type KnowledgeCard } from "../../domain/card";
import type { Goal } from "../../shell/store";
import { encodeSettings, parseSettings, type SettingsFile } from "../../domain/settings";

interface BrowserData { materials: RawMaterial[]; cards: KnowledgeCard[]; settings: string | null }
const browserKey = "knowflick.workspace.v1";
const browserArtifactsKey = "knowflick.workspace.artifacts";
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
export interface WorkspaceSnapshot { dir: string; materials: RawMaterial[]; cards: KnowledgeCard[]; file: SettingsFile; apiKey: string; searchHistory: string | null }
export async function readWorkspace(): Promise<WorkspaceSnapshot> {
  if (!inShell()) {
    const data = browserData();
    return {
      dir: "",
      ...data,
      file: parseSettings(data.settings),
      apiKey: sessionStorage.getItem("knowflick.workspace.key") || "",
      searchHistory: localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY),
    };
  }
  const snapshot = await loadStore();
  const cards: KnowledgeCard[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await dbLoadCards(snapshot.dir, 200, offset);
    cards.push(...page);
    if (page.length < 200) break;
  }
  return {
    dir: snapshot.dir,
    materials: await dbListMaterials(false, snapshot.dir, 10000),
    cards,
    file: parseSettings(snapshot.settings),
    apiKey: await readApiKey(snapshot.dir),
    searchHistory: snapshot.searchHistory,
  };
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

function isArtifact(value: unknown): value is Artifact {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Partial<Artifact>;
  return typeof item.id === "string" && item.id.length > 0 &&
    typeof item.artifactType === "string" && typeof item.title === "string" &&
    typeof item.contentMarkdown === "string" &&
    Array.isArray(item.sourceCardIds) && item.sourceCardIds.every((id) => typeof id === "string") &&
    (item.sourceNoteIds === undefined || (Array.isArray(item.sourceNoteIds) && item.sourceNoteIds.every((id) => typeof id === "string"))) &&
    typeof item.createdAt === "number" && Number.isFinite(item.createdAt) &&
    typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt) &&
    (item.isDeleted === undefined || typeof item.isDeleted === "boolean");
}

function browserArtifacts(): Artifact[] {
  const raw = localStorage.getItem(browserArtifactsKey);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    throw new Error(`浏览器产物存储无法解析：${err instanceof Error ? err.message : String(err)}`);
  }
  if (!Array.isArray(parsed) || !parsed.every(isArtifact)) {
    throw new Error("浏览器产物存储格式损坏；备份与恢复已停止，原数据未覆盖");
  }
  return parsed;
}

function writeBrowserArtifacts(artifacts: Artifact[]): void {
  try {
    localStorage.setItem(browserArtifactsKey, JSON.stringify(artifacts));
  } catch (err) {
    if (err instanceof DOMException && err.name === "QuotaExceededError") {
      throw new Error("浏览器存储已满，这次产物没有保存。导出备份后清理内容，或改用桌面客户端。");
    }
    throw err;
  }
}

/** 产物库的统一读取入口；浏览器数据损坏会抛错，供备份回执明确报告缺口。 */
export async function readArtifacts(dir: string): Promise<Artifact[]> {
  if (!inShell()) return browserArtifacts();
  const artifacts: Artifact[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await dbListArtifacts(200, dir, offset);
    artifacts.push(...page);
    if (page.length < 200) break;
  }
  return artifacts;
}

/** 保存新产物；浏览器与桌面都通过仓储层写入。 */
export async function storeArtifact(artifact: Artifact, dir: string): Promise<void> {
  if (inShell()) {
    await dbSaveArtifact(artifact, dir);
    return;
  }
  const existing = browserArtifacts();
  writeBrowserArtifacts([artifact, ...existing.filter((item) => item.id !== artifact.id)]);
}

/** 浏览器恢复按稳定 ID 合并：同 ID 完全相同则幂等跳过，冲突时保留本地内容。 */
export async function restoreBrowserArtifact(artifact: Artifact): Promise<boolean> {
  const artifacts = browserArtifacts();
  const matches = artifacts.filter((item) => item.id === artifact.id);
  if (matches.length > 1) throw new Error("本地存在多个同标识产物，未覆盖");
  const existing = matches[0];
  if (existing) {
    if (canonicalJson(existing) !== canonicalJson(artifact)) throw new Error("本地同标识产物内容不同，未覆盖");
    return false;
  }
  writeBrowserArtifacts([artifact, ...artifacts]);
  return true;
}

/** 删除产物：保持浏览器旧版的硬删除语义。 */
export async function deleteArtifact(id: string, dir: string): Promise<void> {
  if (inShell()) {
    await dbDeleteArtifact(id, dir);
    return;
  }
  writeBrowserArtifacts(browserArtifacts().filter((item) => item.id !== id));
}

// Key ordering must not make identical JSON look like a conflict.
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  });
}

/** Browser restore keeps existing records unless they match the backup exactly. */
export async function restoreBrowserMaterial(material: RawMaterial): Promise<boolean> {
  const data = browserData();
  const matches = data.materials.filter((item) => item.id === material.id);
  if (matches.length > 1) throw new Error("本地存在多个同标识素材，未覆盖");
  const existing = matches[0];
  if (existing) {
    if (canonicalJson(existing) !== canonicalJson(material)) throw new Error("本地同标识素材内容不同，未覆盖");
    return false;
  }
  browserWrite({ ...data, materials: [material, ...data.materials] });
  return true;
}

export async function restoreBrowserCard(card: KnowledgeCard): Promise<boolean> {
  const data = browserData();
  const matches = data.cards.filter((item) => item.id === card.id);
  if (matches.length > 1) throw new Error("本地存在多个同标识卡片，未覆盖");
  const existing = matches[0];
  if (existing) {
    if (canonicalJson(cardFromJson(existing)) !== canonicalJson(card)) throw new Error("本地同标识卡片内容或学习进度不同，未覆盖");
    return false;
  }
  browserWrite({ ...data, cards: [card, ...data.cards] });
  return true;
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

/**
 * 复制一篇笔记（B02）。
 *
 * 两份实现同一语义：都只构造草稿，再走各自的 upsert（base=0）——修订号、时间与冲突
 * 判定都留在那一处，复制不自己拼「已保存」的记录。
 */
/** 笔记对象 → Rust 命令入参。两条写入路径（保存、复制）共用一份，避免字段各写一遍。 */
function notePayload(note: Note) {
  return {
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
    excludeFromProfile: note.excludeFromProfile,
  };
}

export async function duplicateNoteById(id: string, dir: string): Promise<Note> {
  // 返回**落库后**的那条记录，不是草稿：草稿的 currentRevision 还是 0，
  // 拿它去开编辑器会让下一次保存的 base 与库里的修订对不上（表现为一编辑就冲突）。
  if (inShell()) {
    const state = await readNotes(dir);
    const draft = duplicateNoteDraft(state, id);
    await noteUpsert(notePayload(draft), 0, dir);
    const after = await readNotes(dir);
    return after.notes.find((n) => n.id === draft.id) ?? draft;
  }
  const state = browserNotes();
  const draft = duplicateNoteDraft(state, id);
  const { state: next } = domainUpsert(state, draft, 0);
  browserNotesWrite(next);
  return next.notes.find((n) => n.id === draft.id) ?? draft;
}

/**
 * 批量把笔记移到某个笔记本（空串 = 移出笔记本）。
 *
 * 元数据变化，不追加修订：两条写入路径都走 upsert（base = 当前修订），语义与单篇改本一致。
 * 返回实际移动的篇数与「找不到的 id」数——界面据此说「N 篇已移动、M 篇没找到」，
 * 而不是笼统的「操作完成」。
 */
export async function moveNotesToNotebookById(
  ids: readonly string[],
  notebook: string,
  dir: string
): Promise<{ moved: number; missing: number; notebook: string | null }> {
  const now = Date.now();
  if (inShell()) {
    const state = await readNotes(dir);
    const plan = moveNotesToNotebook(state, ids, notebook, now);
    for (const id of plan.moved) {
      const before = state.notes.find((n) => n.id === id);
      const note = plan.state.notes.find((n) => n.id === id);
      if (!before || !note) continue;
      // 已经是目标笔记本的不再写一次（省一次 IPC，也不白改 updatedAt）。
      if (before.notebook === note.notebook) continue;
      await noteUpsert(notePayload(note), note.currentRevision, dir);
    }
    return { moved: plan.moved.length, missing: plan.missing.length, notebook: plan.notebook };
  }
  const state = browserNotes();
  const plan = moveNotesToNotebook(state, ids, notebook, now);
  browserNotesWrite(plan.state);
  return { moved: plan.moved.length, missing: plan.missing.length, notebook: plan.notebook };
}

/**
 * 一篇笔记的修订历史。
 *
 * 浏览器体验没有修订表（localStorage 只存当前态），返回 `null` 表示「这里读不到」，
 * 与「读了但是空的」区分开——界面据此说真话，而不是显示「暂无历史」骗人。
 */
export async function readNoteHistory(dir: string, id: string): Promise<NoteRevisionSummary[] | null> {
  if (!inShell()) return null;
  return await noteHistoryList(dir, id);
}

/** 读某一版完整内容；浏览器体验返回 null。 */
export async function readNoteRevision(dir: string, id: string, revision: number): Promise<NoteRevision | null> {
  if (!inShell()) return null;
  return await noteHistoryRead(dir, id, revision);
}

/** 导出文件名：去掉路径分隔与控制字符，空标题给个可读的兜底。 */
export function noteExportFileName(note: Note): string {
  const raw = (note.title || "无标题笔记").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim();
  const base = raw.slice(0, 80) || "无标题笔记";
  return `${base}.md`;
}

/**
 * 单篇笔记导出为 Markdown（B02）。
 *
 * 桌面端走原生保存对话框 + `write_text_file`；浏览器体验用下载（同样落成 .md 文件）。
 * 返回实际写到的位置或文件名，取消则返回 null——界面据此决定是否说「已导出」。
 */
export async function exportNoteMarkdown(note: Note): Promise<string | null> {
  const markdown = noteToMarkdown(note);
  const fileName = noteExportFileName(note);
  if (inShell()) {
    const dest = await pickMarkdownSavePath(fileName);
    if (!dest) return null;
    await writeTextFile(dest, markdown);
    return dest;
  }
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return fileName;
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
      return await noteUpsert(notePayload(note), baseRevision, dir);
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
  if (inShell()) return noteRestoreUpsert({ ...note, tagsJson: JSON.stringify(note.tags) }, dir);
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
