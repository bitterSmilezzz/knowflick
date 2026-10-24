/**
 * 笔记与知识库的领域语义（R1）——与 `docs/NOTES_MODEL.md` 契约对齐，
 * 与 Rust 侧 `notes.rs` 是同一契约的两份实现（桌面走 SQLite，浏览器体验
 * 走这份纯函数 + localStorage）。两边的语义由各自的测试钉住：
 * 修订冲突拒绝、回收站、库内检索不串库——改语义要两边一起改。
 */

export interface Note {
  id: string;
  title: string;
  bodyMd: string;
  notebook: string | null;
  tags: string[];
  isPinned: boolean;
  isFavorite: boolean;
  archivedAt: number | null;
  sourceMaterialId: string | null;
  currentRevision: number;
  createdAt: number;
  updatedAt: number;
  isDeleted: boolean;
  deletedAt: number | null;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

/** 成员关系单独存放：同一笔记可属多个库，不复制正文。 */
export interface NotesState {
  notes: Note[];
  knowledgeBases: KnowledgeBase[];
  /** `${kbId}\n${noteId}` → addedAt */
  membership: Record<string, number>;
}

export const emptyNotesState = (): NotesState => ({ notes: [], knowledgeBases: [], membership: {} });

/** `note_upsert` 的结果：新修订号 + 是否新建。 */
export interface NoteSaveOutcome {
  id: string;
  revision: number;
  created: boolean;
}

/** 修订冲突：携带当前修订号，界面用它提示「内容已在别处更新」，不是静默覆盖。 */
export class NoteConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super(`内容已在别处更新（当前修订 ${currentRevision}），请刷新后重试`);
    this.name = "NoteConflictError";
  }
}

export function createNoteDraft(now = Date.now()): Note {
  return {
    id: crypto.randomUUID(),
    title: "",
    bodyMd: "",
    notebook: null,
    tags: [],
    isPinned: false,
    isFavorite: false,
    archivedAt: null,
    sourceMaterialId: null,
    currentRevision: 0,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
    deletedAt: null,
  };
}

/** 与 Rust `note_upsert` 同语义：base_revision 校验、内容变化才追加修订、元数据变化不追加。 */
export function upsertNote(
  state: NotesState,
  note: Note,
  baseRevision: number,
  now = Date.now()
): { state: NotesState; outcome: NoteSaveOutcome } {
  const existing = state.notes.find((n) => n.id === note.id);
  if (!existing && baseRevision !== 0) throw new NoteConflictError(0);
  if (existing && baseRevision !== existing.currentRevision) throw new NoteConflictError(existing.currentRevision);

  if (!existing) {
    const created: Note = { ...note, currentRevision: 1, createdAt: now, updatedAt: now, isDeleted: false, deletedAt: null };
    return {
      state: { ...state, notes: [created, ...state.notes] },
      outcome: { id: note.id, revision: 1, created: true },
    };
  }

  const contentChanged = existing.title !== note.title || existing.bodyMd !== note.bodyMd;
  const nextRevision = contentChanged ? existing.currentRevision + 1 : existing.currentRevision;
  const updated: Note = { ...note, currentRevision: nextRevision, createdAt: existing.createdAt, updatedAt: now };
  return {
    state: { ...state, notes: state.notes.map((n) => (n.id === note.id ? updated : n)) },
    outcome: { id: note.id, revision: nextRevision, created: false },
  };
}

/** 回收站软删；`searchNotes` 与 `listNotes` 默认都不再返回它。 */
export function deleteNote(state: NotesState, id: string, now = Date.now()): NotesState {
  return {
    ...state,
    notes: state.notes.map((n) => (n.id === id && !n.isDeleted ? { ...n, isDeleted: true, deletedAt: now } : n)),
  };
}

export function restoreNote(state: NotesState, id: string): NotesState {
  return {
    ...state,
    notes: state.notes.map((n) => (n.id === id && n.isDeleted ? { ...n, isDeleted: false, deletedAt: null } : n)),
  };
}

export function listNotes(state: NotesState, opts: { includeDeleted?: boolean } = {}): Note[] {
  const all = [...state.notes].sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.updatedAt - a.updatedAt);
  return opts.includeDeleted ? all : all.filter((n) => !n.isDeleted);
}

export function createKnowledgeBase(
  state: NotesState,
  kb: Omit<KnowledgeBase, "createdAt" | "updatedAt">,
  now = Date.now()
): NotesState {
  const name = kb.name.trim();
  if (!name) throw new Error("知识库名称不能为空");
  if (state.knowledgeBases.some((k) => k.name === name)) throw new Error(`已有名为「${name}」的知识库，请换个名字`);
  return { ...state, knowledgeBases: [...state.knowledgeBases, { ...kb, name, createdAt: now, updatedAt: now }] };
}

const memberKey = (kbId: string, noteId: string) => `${kbId}\n${noteId}`;

/** 幂等加入（契约：重复加入不报错、不重复）。 */
export function addNoteToKb(state: NotesState, kbId: string, noteId: string, now = Date.now()): NotesState {
  if (!state.knowledgeBases.some((k) => k.id === kbId)) throw new Error("知识库不存在");
  if (!state.notes.some((n) => n.id === noteId)) throw new Error("笔记不存在");
  const key = memberKey(kbId, noteId);
  if (state.membership[key] !== undefined) return state;
  return { ...state, membership: { ...state.membership, [key]: now } };
}

export function removeNoteFromKb(state: NotesState, kbId: string, noteId: string): NotesState {
  const { [memberKey(kbId, noteId)]: _removed, ...rest } = state.membership;
  return { ...state, membership: rest };
}

export function noteKbIds(state: NotesState, noteId: string): string[] {
  return Object.keys(state.membership)
    .filter((k) => k.endsWith(`\n${noteId}`))
    .map((k) => k.split("\n")[0]);
}

function inKb(state: NotesState, noteId: string, kbId: string | null): boolean {
  return kbId === null || state.membership[memberKey(kbId, noteId)] !== undefined;
}

/** 全文检索：命中标题或正文；`kbId` 非空时按库过滤（契约：不串库）。 */
export function searchNotes(state: NotesState, query: string, kbId: string | null = null): Note[] {
  const clean = query.trim().toLowerCase();
  if (!clean) return [];
  const tokens = clean.split(/\s+/).filter(Boolean);
  return listNotes(state).filter((n) => {
    if (!inKb(state, n.id, kbId)) return false;
    const hay = `${n.title}\n${n.bodyMd}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}

// ---------- 序列化（localStorage 与 .kfbackup / Rust 命令边界共用） ----------

interface NoteJson {
  id: string;
  title?: string;
  bodyMd?: string;
  body_md?: string;
  notebook?: string | null;
  tagsJson?: string;
  tags_json?: string;
  tags?: string[];
  isPinned?: number | boolean;
  is_pinned?: number | boolean;
  isFavorite?: number | boolean;
  is_favorite?: number | boolean;
  archivedAt?: number | null;
  archived_at?: number | null;
  sourceMaterialId?: string | null;
  source_material_id?: string | null;
  currentRevision?: number;
  current_revision?: number;
  createdAt?: number;
  created_at?: number;
  updatedAt?: number;
  updated_at?: number;
  isDeleted?: number | boolean;
  is_deleted?: number | boolean;
  deletedAt?: number | null;
  deleted_at?: number | null;
}

/** 兼容 Rust DTO 的 snake_case 与前端 camelCase 两种形状（备份来自 Rust 侧导出）。 */
export function noteFromJson(raw: unknown): Note {
  const j = raw as NoteJson;
  const tagsRaw = j.tagsJson ?? j.tags_json;
  const tags = Array.isArray(j.tags) ? j.tags.map(String) : safeParseTags(tagsRaw);
  return {
    id: String(j.id),
    title: String(j.title ?? ""),
    bodyMd: String(j.bodyMd ?? j.body_md ?? ""),
    notebook: j.notebook ?? null,
    tags,
    isPinned: truthy(j.isPinned ?? j.is_pinned),
    isFavorite: truthy(j.isFavorite ?? j.is_favorite),
    archivedAt: j.archivedAt ?? j.archived_at ?? null,
    sourceMaterialId: j.sourceMaterialId ?? j.source_material_id ?? null,
    currentRevision: Number(j.currentRevision ?? j.current_revision ?? 1),
    createdAt: Number(j.createdAt ?? j.created_at ?? 0),
    updatedAt: Number(j.updatedAt ?? j.updated_at ?? 0),
    isDeleted: truthy(j.isDeleted ?? j.is_deleted),
    deletedAt: j.deletedAt ?? j.deleted_at ?? null,
  };
}

function safeParseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function truthy(v: number | boolean | undefined): boolean {
  return v === true || v === 1;
}
