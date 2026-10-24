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
  loadStore,
  readMedia,
  noteDelete,
  noteList,
  noteRestore,
  noteUpsert,
  readApiKey,
  saveSettings,
  writeApiKey,
  type RawMaterial,
} from "../../shell/store";
import {
  NoteConflictError,
  addNoteToKb as domainAddToKb,
  createKnowledgeBase as domainCreateKb,
  deleteNote as domainDeleteNote,
  emptyNotesState,
  restoreNote as domainRestoreNote,
  noteFromJson,
  removeNoteFromKb as domainRemoveFromKb,
  upsertNote as domainUpsert,
  type KnowledgeBase,
  type Note,
  type NoteSaveOutcome,
  type NotesState,
} from "../../domain/note";
import type { KnowledgeCard } from "../../domain/card";
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

function browserNotes(): NotesState {
  const raw = localStorage.getItem(notesKey);
  if (!raw) return emptyNotesState();
  try {
    const parsed = JSON.parse(raw) as Partial<NotesState>;
    return {
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      knowledgeBases: Array.isArray(parsed.knowledgeBases) ? parsed.knowledgeBases : [],
      membership: parsed.membership ?? {},
    };
  } catch {
    return emptyNotesState();
  }
}

function browserNotesWrite(state: NotesState) {
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

export async function readNotes(dir: string): Promise<NotesState> {
  if (!inShell()) return browserNotes();
  const [notes, kbs, membership] = await Promise.all([noteList(false, dir, 10000), kbList(dir), kbMembership(dir)]);
  return {
    notes: notes.map(noteFromJson),
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

export async function deleteNoteById(id: string, dir: string): Promise<void> {
  if (inShell()) { await noteDelete(id, dir); return; }
  browserNotesWrite(domainDeleteNote(browserNotes(), id));
}

export async function restoreNoteById(id: string, dir: string): Promise<void> {
  if (inShell()) { await noteRestore(id, dir); return; }
  browserNotesWrite(domainRestoreNote(browserNotes(), id));
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
