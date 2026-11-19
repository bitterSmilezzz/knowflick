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
  /** 用户明确选择后，不把这篇笔记用于个人画像提案。 */
  excludeFromProfile: boolean;
}

export interface NoteRevision {
  noteId: string;
  revision: number;
  title: string;
  bodyMd: string;
  savedAt: number;
}

/** 历史列表用的元信息：不带正文（正文可能几十万字，列表只要「第几版、什么时候」）。 */
export interface NoteRevisionSummary {
  revision: number;
  title: string;
  savedAt: number;
  chars: number;
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
    excludeFromProfile: false,
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

// ---------- 备份恢复专用写入（T04，审计 KF-003） ----------

/** 与 Rust `note_restore_upsert` 同名的处置结果（同一契约的两份实现）。 */
export type NoteRestoreAction = "created" | "updated" | "skippedLocalNewer" | "skippedDivergent" | "current";

/**
 * 恢复落库：按包内当前态**原样**写入（修订号、时间、删除态全部保留），
 * 不追加修订、不重置时间、不复活回收站。恢复是显式用户动作，
 * 与普通编辑（upsertNote）是两个入口——审计 KF-003 的根因就是恢复走了
 * 普通编辑：revision=9 的包落库变成修订 1、回收站内容自动复活。
 */
export function restoreNoteRaw(
  state: NotesState,
  note: Note,
  now = Date.now()
): { state: NotesState; action: NoteRestoreAction } {
  void now;
  const revision = Math.max(1, note.currentRevision);
  const existing = state.notes.find((n) => n.id === note.id);
  if (existing) {
    if (existing.currentRevision > revision) {
      return { state, action: "skippedLocalNewer" };
    }
    if (existing.currentRevision === revision) {
      const same =
        existing.title === note.title &&
        existing.bodyMd === note.bodyMd &&
        existing.notebook === note.notebook &&
        existing.tags.join("\n") === note.tags.join("\n") &&
        existing.isPinned === note.isPinned &&
        existing.isFavorite === note.isFavorite &&
        existing.archivedAt === note.archivedAt &&
        existing.sourceMaterialId === note.sourceMaterialId &&
        existing.excludeFromProfile === note.excludeFromProfile &&
        existing.isDeleted === note.isDeleted &&
        existing.deletedAt === note.deletedAt;
      return { state, action: same ? "current" : "skippedDivergent" };
    }
    const updated: Note = { ...note, currentRevision: revision };
    return {
      state: { ...state, notes: state.notes.map((n) => (n.id === note.id ? updated : n)) },
      action: "updated",
    };
  }
  const created: Note = { ...note, currentRevision: revision };
  return {
    state: { ...state, notes: [created, ...state.notes] },
    action: "created",
  };
}

export function restoreNote(state: NotesState, id: string): NotesState {
  return {
    ...state,
    notes: state.notes.map((n) => (n.id === id && n.isDeleted ? { ...n, isDeleted: false, deletedAt: null } : n)),
  };
}

/**
 * 列表读取。
 *
 * 归档与回收站是两件事，默认都**不进**主列表（契约见 docs/NOTES_MODEL.md：
 * `archived_at` 非空=已归档，`is_deleted`=回收站）。之前 `archived_at` 只写不读：
 * 界面上没有归档入口、列表也不按它过滤，这个字段等于不存在。
 * 置顶排在最前，其余按更新时间倒序。
 */
export function listNotes(
  state: NotesState,
  opts: { includeDeleted?: boolean; includeArchived?: boolean } = {}
): Note[] {
  const all = [...state.notes].sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.updatedAt - a.updatedAt);
  return all.filter((n) => {
    if (!opts.includeDeleted && n.isDeleted) return false;
    if (!opts.includeArchived && n.archivedAt !== null) return false;
    return true;
  });
}

/** 已归档且未删除的笔记（「已归档」视图用；按归档时间倒序）。 */
export function archivedNotes(state: NotesState): Note[] {
  return listNotes(state, { includeArchived: true })
    .filter((n) => n.archivedAt !== null && !n.isDeleted)
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
}

/**
 * 复制一篇笔记（B02）。
 *
 * 语义上是一次**新建**，不是「同一篇的两个版本」：新 id、修订 1、当前时间。
 * 保留正文 / 标题 / 笔记本 / 标签 / 画像排除偏好；清掉的是「属于原来那一篇」的状态——
 * 置顶、收藏、归档、回收站，以及 `source_material_id`（否则同一份素材会被两篇笔记声明
 * 为「已转笔记」，界面与索引都会给出错误结论）。
 */
/**
 * 复制一篇笔记（B02）：只产出**草稿**，落库仍走正常的 upsert（两份实现同一语义）。
 *
 * 这里刻意不自己往 state 里塞：修订号、时间与冲突判定都是 upsert 的职责，
 * 复制若自己拼一条「已保存」的记录，就会绕过那份语义（修订从 0 变 1 的规则两处各写一遍）。
 */
export function duplicateNoteDraft(state: NotesState, id: string, now = Date.now()): Note {
  const source = state.notes.find((n) => n.id === id);
  if (!source) throw new Error("笔记不存在");
  return {
    ...createNoteDraft(now),
    title: `${source.title || "无标题"}（副本）`,
    bodyMd: source.bodyMd,
    notebook: source.notebook,
    tags: [...source.tags],
    excludeFromProfile: source.excludeFromProfile,
  };
}

/**
 * 单篇笔记导出为 Markdown。
 *
 * 契约是「导出 Markdown 即正文本身」（docs/NOTES_MODEL.md），所以这里**原样**返回 `body_md`：
 * 不补标题、不包装 front matter——否则导出的文件与库里的正文不再逐字相同。
 * 唯一的例外是正文为空：那种笔记导出一个空文件等于丢内容，于是退化为一行标题。
 */
export function noteToMarkdown(note: Note): string {
  if (note.bodyMd.trim().length > 0) return note.bodyMd;
  return `# ${note.title.trim() || "无标题笔记"}\n`;
}
/**
 * 批量移动到笔记本（B03）。
 *
 * 语义与单篇改笔记本一致：这是**元数据**变化，不追加修订（docs/NOTES_MODEL.md），
 * 所以它不能各写一份——这里做成纯函数，浏览器与桌面两条写入路径共用同一判定。
 * `notebook` 传空串或纯空白 = 移出笔记本（设为 null）。
 * 不存在的 id 收进 `missing` 而不是静默忽略：界面要能说清「有几篇没动」。
 */
export function moveNotesToNotebook(
  state: NotesState,
  ids: readonly string[],
  notebook: string,
  now = Date.now()
): { state: NotesState; moved: string[]; missing: string[]; notebook: string | null } {
  const target = notebook.trim() ? notebook.trim() : null;
  const wanted = new Set(ids);
  const moved: string[] = [];
  const missing: string[] = [];
  for (const id of wanted) {
    if (!state.notes.some((n) => n.id === id)) missing.push(id);
  }
  const notes = state.notes.map((n) => {
    if (!wanted.has(n.id)) return n;
    if (n.notebook === target) {
      // 已经在这个本里：仍然算「移动成功」，但不改时间也不产生写入。
      moved.push(n.id);
      return n;
    }
    moved.push(n.id);
    return { ...n, notebook: target, updatedAt: now };
  });
  return { state: { ...state, notes }, moved, missing, notebook: target };
}

/** 把用户输入的一串标签拆成规范形式：逗号（中英文）分隔、去掉开头 `#`、去空、去重。 */
export function parseTagInput(raw: string): string[] {
  const out: string[] = [];
  for (const piece of raw.split(/[,，\s]+/)) {
    const tag = piece.trim().replace(/^#/, "").trim();
    if (!tag) continue;
    // 输入里重复写同一个标签只算一次（用户手快写了两遍不该出现两次）。
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

/**
 * 批量给笔记加标签（B03）。
 *
 * 与「批量移动」同一口径：这是**元数据**变化，不追加修订（见 docs/NOTES_MODEL.md），
 * 所以做成纯函数，浏览器与桌面两条写入路径共用同一判定。
 *
 * 三条规则都是为了不白写：
 * - 已经有这个标签的不重复加（否则同篇里出现两遍，计数与筛选都会偏）；
 * - 没有任何新增的笔记**不进** `tagged`，也不改 `updatedAt`——没变化就不该多一次写入、
 *   更不该把「最近编辑」的时间往后推；
 * - 找不到的 id 收进 `missing`，界面才能说清「有几篇没动」。
 */
export function addTagsToNotes(
  state: NotesState,
  ids: readonly string[],
  rawTags: string,
  now = Date.now()
): { state: NotesState; tagged: string[]; missing: string[]; added: string[] } {
  const tags = parseTagInput(rawTags);
  const wanted = new Set(ids);
  const tagged: string[] = [];
  const missing: string[] = [];
  for (const id of wanted) {
    if (!state.notes.some((n) => n.id === id)) missing.push(id);
  }
  if (tags.length === 0) return { state, tagged, missing, added: [] };
  const notes = state.notes.map((n) => {
    if (!wanted.has(n.id)) return n;
    const fresh = tags.filter((tag) => !n.tags.includes(tag));
    if (fresh.length === 0) return n;
    tagged.push(n.id);
    return { ...n, tags: [...n.tags, ...fresh], updatedAt: now };
  });
  return { state: { ...state, notes }, tagged, missing, added: tags };
}

/**
 * 批量去掉笔记上的标签（B03 的收尾）。
 *
 * 与加标签对称：仍然只动元数据、不追加修订；仍然「没有任何一篇真的变了就不写」。
 * 匹配用**完全相等**而不是包含关系：去掉「工作」不该把「工作流」一起删掉。
 */
export function removeTagsFromNotes(
  state: NotesState,
  ids: readonly string[],
  rawTags: string,
  now = Date.now()
): { state: NotesState; changed: string[]; missing: string[]; removed: string[] } {
  const tags = parseTagInput(rawTags);
  const wanted = new Set(ids);
  const changed: string[] = [];
  const missing: string[] = [];
  for (const id of wanted) {
    if (!state.notes.some((n) => n.id === id)) missing.push(id);
  }
  if (tags.length === 0) return { state, changed, missing, removed: [] };
  const notes = state.notes.map((n) => {
    if (!wanted.has(n.id)) return n;
    const kept = n.tags.filter((tag) => !tags.includes(tag));
    if (kept.length === n.tags.length) return n;
    changed.push(n.id);
    return { ...n, tags: kept, updatedAt: now };
  });
  return { state: { ...state, notes }, changed, missing, removed: tags };
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
  excludeFromProfile?: number | boolean;
  exclude_from_profile?: number | boolean;
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
    excludeFromProfile: truthy(j.excludeFromProfile ?? j.exclude_from_profile),
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
