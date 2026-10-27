import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addNoteToKnowledgeBase,
  createKnowledgeBaseNamed,
  readNoteMedia,
  deleteNoteById,
  readNotes,
  removeNoteFromKnowledgeBase,
  restoreNoteById,
  saveNote,
} from "./repository";
import {
  createNoteDraft,
  listNotes,
  noteKbIds,
  searchNotes,
  type KnowledgeBase,
  type Note,
  type NotesState,
} from "../../domain/note";
import { emptyNotesState } from "../../domain/note";
import {
  NoteSession,
  clearDraftMirror,
  persistDraftMirror,
  readDraftMirror,
  type SessionIo,
} from "./noteSession";
import { registerNotesDraftFlusher } from "./backupCollect";
import type { RawMaterial } from "../../shell/store";
import {
  applyNoteReference,
  excerptOf,
  extractNoteReferences,
  referenceStatus,
  type ReferenceSource,
} from "../../domain/noteReference";
import { Icon } from "./Icon";
import { useDeleteConfirm } from "./useDeleteConfirm";
import { MarkdownRenderer } from "./MarkdownRenderer";

/**
 * 笔记工作面（R1 首个纵向切片）——契约见 docs/NOTES_MODEL.md「界面契约」：
 * 新建直接可写、停止输入自动保存、重启后内容在、可加入知识库、
 * 全文搜索命中正文、删除进回收站。不需要 AI。
 *
 * 保存并发由每篇笔记一个 NoteSession 拥有（T01）：修订基线、草稿、
 * 元数据补丁、冲突态都收敛在会话里——编辑器只显示会话快照，
 * 冲突时不自动覆盖（KF-002），属性与正文同一份组合状态（KF-004）。
 */

type SaveStatus = "clean" | "dirty" | "saving" | "conflict" | "error";

/** data-save-status 对外的值是稳定契约（冒烟测试断言 `saved`）。 */
const STATUS_ATTR: Record<SaveStatus, string> = {
  clean: "saved",
  saving: "saving",
  dirty: "dirty",
  conflict: "conflict",
  error: "error",
};
const STATUS_LABEL: Record<SaveStatus, string> = {
  clean: "已保存",
  saving: "保存中…",
  dirty: "未保存",
  conflict: "内容冲突",
  error: "保存失败",
};

interface AttachableMedia {
  /** 库内相对路径（media/...），正文引用用的就是它。 */
  path: string;
  /** 界面选择列表里显示的标题。 */
  label: string;
}

interface Props {
  dir: string;
  /** 有媒体附件的素材（库内路径+标题）：「插入附件引用」的选项来源。 */
  attachableMedia: AttachableMedia[];
  /** Workspace 用最新快照来导出备份；笔记状态由本视图自治加载。 */
  onStateChange?: (state: NotesState) => void;
  /** T13/G01：外部（如全局搜索命中）要求打开的笔记 id。 */
  openNoteId?: string | null;
  /** 素材列表：引用可以指向素材（多来源引用），过期判定也要看素材正文。 */
  materials?: RawMaterial[];
}

export function NotesView({ dir, attachableMedia, onStateChange, openNoteId, materials = [] }: Props) {
  const [state, setState] = useState<NotesState>(emptyNotesState);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<SaveStatus>("clean");
  const [statusNote, setStatusNote] = useState("");
  const [metaValues, setMetaValues] = useState<{ notebook: string | null; tags: string[] }>({
    notebook: null,
    tags: [],
  });
  const [listQuery, setListQuery] = useState("");
  const [notebookFilter, setNotebookFilter] = useState("");
  const [showTrash, setShowTrash] = useState(false);
  const [kbFormOpen, setKbFormOpen] = useState(false);
  // T13/G01：应用引用——从别的笔记选一段，插进当前笔记（可回原件）。
  const [refPickerOpen, setRefPickerOpen] = useState(false);
  const [refQuery, setRefQuery] = useState("");
  const [kbName, setKbName] = useState("");
  const [viewError, setViewError] = useState("");

  const sessionsRef = useRef<Map<string, NoteSession>>(new Map());
  const dirRef = useRef(dir);
  dirRef.current = dir;
  const selectedIdRef = useRef<string | null>(null);
  /** 会话 io：仓储绑定当前 dir；草稿镜像走 localStorage（尽力而为）。 */
  const ioRef = useRef<SessionIo>({
    save: (note, base) => saveNote(note, base, dirRef.current),
    persistDraft: persistDraftMirror,
    clearDraft: clearDraftMirror,
  });

  const activeNotes = useMemo(() => listNotes(state), [state]);
  const trashedNotes = useMemo(
    () => listNotes(state, { includeDeleted: true }).filter((n) => n.isDeleted),
    [state]
  );
  const visible = useMemo(() => {
    const base = listQuery.trim() ? searchNotes(state, listQuery) : showTrash ? trashedNotes : activeNotes;
    return notebookFilter ? base.filter((n) => n.notebook === notebookFilter) : base;
  }, [state, listQuery, showTrash, activeNotes, trashedNotes, notebookFilter]);
  const selected = state.notes.find((n) => n.id === selectedId) ?? null;

  const refresh = useCallback(async () => {
    try {
      const next = await readNotes(dirRef.current);
      setState(next);
      onStateChange?.(next);
    } catch (e) {
      setViewError(`读取笔记失败：${String(e)}`);
    } finally {
      setLoaded(true);
    }
  }, [onStateChange]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const currentSession = useCallback(
    () => (selectedIdRef.current ? sessionsRef.current.get(selectedIdRef.current) ?? null : null),
    []
  );

  /** 会话相态 → 状态条。只对当前选中的会话生效（后台会话的状态留在会话里）。 */
  const syncFromSession = useCallback((s: NoteSession) => {
    const snap = s.snapshot();
    setStatus(snap.phase);
    if (snap.phase === "conflict") {
      setStatusNote(
        `内容已在别处更新（当前修订 ${snap.conflictRevision}）。本地草稿仍保留，继续输入不会自动覆盖。`
      );
    } else if (snap.phase === "error") {
      setStatusNote(`保存失败：${snap.errorMessage ?? "未知错误"}。内容还在，稍后重试即可。`);
    } else {
      setStatusNote("");
    }
  }, []);

  /** 会话相态变化：当前编辑中的同步状态条；有会话落库完成就刷新列表。 */
  const attachSession = useCallback(
    (s: NoteSession) => {
      s.onChange = () => {
        if (selectedIdRef.current === s.noteId) syncFromSession(s);
        if (s.snapshot().phase === "clean") void refreshRef.current();
      };
    },
    [syncFromSession]
  );

  useEffect(() => {
    setLoaded(false);
    setSelectedId(null);
    selectedIdRef.current = null;
    for (const s of sessionsRef.current.values()) s.disposeTimer();
    sessionsRef.current.clear();
    void refresh();
  }, [refresh]);


  // 外部改动（MCP、备份恢复、另一窗口）——只在编辑器干净时同步列表：
  // 脏草稿不打扰，等保存时由修订冲突兜底（会话负责拦住，不静默覆盖）。
  useEffect(() => {
    const onChange = () => {
      const s = currentSession();
      if (!s || !s.isDirty) void refresh();
    };
    window.addEventListener("knowflick:library-changed", onChange);
    return () => window.removeEventListener("knowflick:library-changed", onChange);
  }, [currentSession]);

  // 卸载 / 关窗前尽力冲一次未保存的改动。beforeunload 里的异步保存不是
  // 已持久化证明——每次编辑都已写 localStorage 草稿镜像，意外退出后
  // 重新打开这篇笔记会恢复镜像（「已恢复上次未保存的草稿」）。
  useEffect(() => {
    const flush = () => {
      const s = currentSession();
      if (s && s.isDirty) void s.flush();
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [currentSession]);

  // 导出备份前的草稿处置（T03）：把当前脏会话的冲刷权交给备份采集——
  // 冲刷结果如实上报，保存失败/冲突时回执不得声称「完整备份」。
  useEffect(() => {
    registerNotesDraftFlusher(async () => {
      const s = currentSession();
      if (!s || !s.isDirty) return { attempted: false, saved: true };
      const snap = await s.flush();
      return { attempted: true, saved: !snap.dirty && snap.phase !== "error" };
    });
    return () => registerNotesDraftFlusher(null);
  }, [currentSession]);

  const openNote = useCallback(
    (note: Note) => {
      // 点的是正打开的这篇：什么都不动——重置会把未保存的草稿盖回旧内容。
      if (note.id === selectedIdRef.current) return;
      // 切走前冲掉上一篇的脏草稿（后台冲刷；结果与冲突都留在那个会话里）。
      const prev = currentSession();
      if (prev && prev.isDirty && prev.snapshot().phase !== "conflict") void prev.flush();

      let s = sessionsRef.current.get(note.id) ?? null;
      if (
        s &&
        s.snapshot().phase === "clean" &&
        note.currentRevision !== s.snapshot().note.currentRevision
      ) {
        // 会话干净而列表已更新（外部改过）：旧会话没有要保留的东西，换成新基线。
        s.disposeTimer();
        sessionsRef.current.delete(note.id);
        s = null;
      }
      let restoredHint = "";
      if (!s) {
        s = new NoteSession(note, ioRef.current);
        sessionsRef.current.set(note.id, s);
        attachSession(s);
        // 崩溃/意外退出留下的草稿镜像 ≠ 服务器内容 → 恢复成脏草稿（自动保存接力）。
        const mirror = readDraftMirror(note.id);
        if (mirror && (mirror.title !== note.title || mirror.bodyMd !== note.bodyMd)) {
          s.restoreDraft(mirror.title, mirror.bodyMd);
          restoredHint = "已恢复上次未保存的草稿";
        }
      }
      const snap = s.snapshot();
      selectedIdRef.current = note.id;
      setSelectedId(note.id);
      setTitle(snap.draft.title);
      setBody(snap.draft.bodyMd);
      setMetaValues({ notebook: snap.note.notebook, tags: [...snap.note.tags] });
      syncFromSession(s);
      if (restoredHint) setStatusNote(restoredHint);
      setViewError("");
    },
    [attachSession, currentSession, syncFromSession]
  );

  // T13/G01：全局搜索命中笔记后跳到笔记页——按 id 定位并打开那篇。
  const pendingOpenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!openNoteId) return;
    pendingOpenRef.current = openNoteId;
  }, [openNoteId]);
  useEffect(() => {
    if (!loaded || !pendingOpenRef.current) return;
    const target = state.notes.find((n) => n.id === pendingOpenRef.current);
    if (!target) return;
    pendingOpenRef.current = null;
    openNote(target);
  }, [loaded, state.notes, openNote]);

  const createNote = useCallback(() => {
    const prev = currentSession();
    if (prev && prev.isDirty && prev.snapshot().phase !== "conflict") void prev.flush();
    const draft = createNoteDraft();
    const s = new NoteSession(draft, ioRef.current);
    sessionsRef.current.set(draft.id, s);
    attachSession(s);
    selectedIdRef.current = draft.id;
    setSelectedId(draft.id);
    setTitle("");
    setBody("");
    setMetaValues({ notebook: null, tags: [] });
    setStatus("dirty");
    setStatusNote("");
    setViewError("");
    // 空笔记先不落库：等第一段内容进来再保存，避免堆积空笔记。
  }, [attachSession, currentSession]);

  const onEdit = (nextTitle: string, nextBody: string) => {
    const s = currentSession();
    if (!s) return;
    setTitle(nextTitle);
    setBody(nextBody);
    s.edit(nextTitle, nextBody);
  };

  const del = useDeleteConfirm(async (target: string) => {
    try {
      await deleteNoteById(target, dirRef.current);
      const s = sessionsRef.current.get(target);
      if (s) {
        s.discard();
        sessionsRef.current.delete(target);
      }
      if (selectedIdRef.current === target) {
        selectedIdRef.current = null;
        setSelectedId(null);
      }
      await refresh();
    } catch (e) {
      setViewError(`移入回收站失败：${String(e)}`);
    }
  });

  const doRestore = async (id: string) => {
    try {
      await restoreNoteById(id, dirRef.current);
      await refresh();
    } catch (e) {
      setViewError(`恢复失败：${String(e)}`);
    }
  };

  const toggleFavorite = () => {
    const s = currentSession();
    if (!s) return;
    s.patchMeta({ isFavorite: !s.effectiveNote().isFavorite });
  };

  /** 笔记本/标签等元数据编辑：进同一保存队列（内容不变 → 不追加修订）。 */
  const saveMeta = (patch: Partial<Pick<Note, "notebook" | "tags">>) => {
    const s = currentSession();
    if (!s) return;
    setMetaValues((prev) => ({ ...prev, ...patch }));
    s.patchMeta(patch);
  };

  const doCreateKb = async () => {
    const name = kbName.trim();
    if (!name) return;
    try {
      await createKnowledgeBaseNamed(crypto.randomUUID(), name, "", dirRef.current);
      setKbName("");
      setKbFormOpen(false);
      await refresh();
    } catch (e) {
      setViewError(`创建知识库失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const doAddToKb = async (kbId: string) => {
    if (!selected) return;
    try {
      await addNoteToKnowledgeBase(kbId, selected.id, dirRef.current);
      await refresh();
    } catch (e) {
      setViewError(`加入知识库失败：${String(e)}`);
    }
  };

  const doRemoveFromKb = async (kbId: string) => {
    if (!selected) return;
    try {
      await removeNoteFromKnowledgeBase(kbId, selected.id, dirRef.current);
      await refresh();
    } catch (e) {
      setViewError(`移出知识库失败：${String(e)}`);
    }
  };

  /** 引用另一篇笔记的一段到当前笔记（可回原件：knowflick://note/<id>）。 */
  const insertNoteReference = (source: ReferenceSource) => {
    const s = currentSession();
    if (!s) return;
    const excerpt = excerptOf(source);
    const nextBody = applyNoteReference(body, source, excerpt);
    setRefPickerOpen(false);
    setRefQuery("");
    onEdit(title, nextBody);
    setStatusNote(`已引用《${source.title || "无标题笔记"}》——引用块里可点「回原件」跳回来源。`);
  };

  /**
   * 当前正文的引用状态（R2「矛盾与过期提示」）：
   * 源被改过 → changed（可能已过期）；源不在了 → missing（引用已失效）。
   */
  const referenceIssues = useMemo(() => {
    const sources = new Map<string, ReferenceSource>();
    for (const n of state.notes) {
      sources.set(n.id, { id: n.id, title: n.title, bodyMd: n.bodyMd, kind: "note" });
    }
    for (const m of materials) {
      sources.set(m.id, { id: m.id, title: m.title, bodyMd: m.rawText, kind: "material" });
    }
    const issues: { noteId: string; title: string; status: "changed" | "missing" }[] = [];
    for (const ref of extractNoteReferences(body)) {
      const status = referenceStatus(ref, sources);
      if (status !== "ok") issues.push({ noteId: ref.noteId, title: ref.title, status });
    }
    return issues;
  }, [body, state.notes, materials]);

  /** 可引用的来源：其它笔记 + 素材（R2「多来源引用」）。 */
  const referenceCandidates = useMemo(() => {
    const q = refQuery.trim().toLowerCase();
    const fromNotes: ReferenceSource[] = state.notes
      .filter((n) => !n.isDeleted && n.id !== selectedId)
      .filter((n) => !q || `${n.title}\n${n.bodyMd}`.toLowerCase().includes(q))
      .map((n) => ({ id: n.id, title: n.title, bodyMd: n.bodyMd, kind: "note" as const }));
    const fromMaterials: ReferenceSource[] = materials
      .filter((m) => !q || `${m.title}\n${m.rawText}`.toLowerCase().includes(q))
      .map((m) => ({ id: m.id, title: m.title, bodyMd: m.rawText, kind: "material" as const }));
    return [...fromNotes, ...fromMaterials].slice(0, 12);
  }, [state.notes, materials, refQuery, selectedId]);

  const insertAttachment = (path: string) => {
    if (!currentSession()) return;
    const anchor = body;
    const insertAt = anchor.length; // 正文末尾追加（textarea 无 selection 暴露时最不惊讶）
    const nextBody = `${anchor.slice(0, insertAt)}${anchor && !anchor.endsWith("\n") ? "\n\n" : ""}![附件](${path})\n`;
    onEdit(title, nextBody);
  };

  /** 重新从仓储拉权威状态（外部更新 / 冲突处置后）。 */
  const fetchFreshState = async (): Promise<NotesState> => {
    const fresh = await readNotes(dirRef.current);
    setState(fresh);
    onStateChange?.(fresh);
    return fresh;
  };

  // ---------- 冲突处置（三选一，都不自动发生） ----------

  const keepConflictCopy = async () => {
    const s = currentSession();
    if (!s) return;
    const snap = s.snapshot();
    try {
      const copy = createNoteDraft();
      copy.title = snap.draft.title ? `${snap.draft.title}（冲突副本）` : "（冲突副本）";
      copy.bodyMd = snap.draft.bodyMd;
      copy.notebook = snap.note.notebook;
      copy.tags = [...snap.note.tags];
      await saveNote(copy, 0, dirRef.current);
      const fresh = await fetchFreshState();
      const remote = fresh.notes.find((n) => n.id === s.noteId) ?? null;
      if (remote) {
        s.adoptRemote(remote);
        setTitle(s.snapshot().draft.title);
        setBody(s.snapshot().draft.bodyMd);
        setMetaValues({ notebook: s.snapshot().note.notebook, tags: [...s.snapshot().note.tags] });
        syncFromSession(s);
        setStatusNote("本地草稿已另存为新笔记；编辑器已加载远端最新内容。");
      } else {
        setStatusNote("本地草稿已另存为新笔记；远端这篇已被删除，列表不再显示它。");
      }
    } catch (e) {
      setStatusNote(`另存副本失败：${e instanceof Error ? e.message : String(e)}。本地草稿未受影响。`);
    }
  };

  const loadRemoteLatest = async () => {
    const s = currentSession();
    if (!s) return;
    try {
      const fresh = await fetchFreshState();
      const remote = fresh.notes.find((n) => n.id === s.noteId) ?? null;
      if (!remote) {
        setStatusNote("远端已找不到这篇笔记（可能已被删除）。本地草稿仍在编辑器里。");
        return;
      }
      s.adoptRemote(remote);
      setTitle(s.snapshot().draft.title);
      setBody(s.snapshot().draft.bodyMd);
      setMetaValues({ notebook: s.snapshot().note.notebook, tags: [...s.snapshot().note.tags] });
      syncFromSession(s);
      setStatusNote("已加载最新内容（本地草稿被替换）。");
    } catch (e) {
      setStatusNote(`读取远端内容失败：${String(e)}。本地草稿未受影响。`);
    }
  };

  // 正文里引用的库内附件 → objectURL。按内容路径缓存，卸载统一释放；
  // resolver 只认这份缓存：拿不到说明附件缺失，渲染「附件缺失」文案。
  const [objectUrls, setObjectUrls] = useState<Map<string, string | null>>(new Map());
  const mediaRefs = useMemo(
    () => [...new Set([...body.matchAll(/!\[[^\]]*\]\((media\/(?:audio|image|ink)\/[A-Za-z0-9._-]+)\)/g)].map((m) => m[1]))],
    [body]
  );
  useEffect(() => {
    let disposed = false;
    const created: string[] = [];
    void (async () => {
      const next = new Map<string, string | null>();
      for (const ref of mediaRefs) {
        if (objectUrls.has(ref)) next.set(ref, objectUrls.get(ref) ?? null);
        else {
          try {
            const bytes = await readNoteMedia(ref, dirRef.current);
            if (!bytes) next.set(ref, null);
            else {
              const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: ref.endsWith(".json") ? "image/svg+xml" : "application/octet-stream" }));
              created.push(url);
              next.set(ref, url);
            }
          } catch {
            next.set(ref, null);
          }
        }
      }
      if (disposed) { for (const u of created) URL.revokeObjectURL(u); return; }
      for (const [old, url] of objectUrls) if (!next.has(old) && url) URL.revokeObjectURL(url);
      setObjectUrls(next);
    })();
    return () => { disposed = true; };
    // objectUrls 只作为缓存读取（避免重复加载），不作为触发器
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaRefs]);

  const selectedKbIds = selected ? noteKbIds(state, selected.id) : [];
  const notInKbs = state.knowledgeBases.filter((k) => !selectedKbIds.includes(k.id));

  return (
    <div className="nv-root" data-page="notes">
      <section className="nv-list" aria-label="笔记列表">
        <div className="nv-list-head">
          <h1>笔记</h1>
          <button className="ws-primary" type="button" onClick={createNote} disabled={!loaded}>
            <Icon name="plus" size={14} /> 新建笔记
          </button>
        </div>
        <label className="ws-search">
          <Icon name="search" />
          <input
            aria-label="搜索笔记"
            placeholder="搜索标题或正文"
            value={listQuery}
            onChange={(e) => setListQuery(e.target.value)}
          />
        </label>
        <select
          className="nv-notebook-filter"
          aria-label="按笔记本筛选"
          value={notebookFilter}
          onChange={(e) => setNotebookFilter(e.target.value)}
        >
          <option value="">全部笔记本</option>
          {[...new Set(activeNotes.map((n) => n.notebook).filter(Boolean))].map((nb) => (
            <option key={nb} value={nb ?? ""}>{nb}</option>
          ))}
        </select>
        <button
          type="button"
          className="nv-trash-toggle"
          aria-pressed={showTrash}
          onClick={() => { setShowTrash(!showTrash); setListQuery(""); }}
        >
          {showTrash ? `回收站（${trashedNotes.length}）· 点回笔记` : `回收站（${trashedNotes.length}）`}
        </button>
        {viewError ? <p className="nv-error" role="alert">{viewError}</p> : null}
        <div className="nv-entries" role="listbox" aria-label="笔记条目">
          {!loaded ? (
            <p className="ws-hint">正在读取笔记…</p>
          ) : visible.length === 0 ? (
            <div className="ws-list-empty">
              <h2>{showTrash ? "回收站是空的" : listQuery ? "没有匹配的笔记" : "还没有笔记"}</h2>
              <p>{listQuery ? "换个关键词试试。" : "点上面的「新建笔记」开始写。保存后即可全文搜索。"}</p>
            </div>
          ) : (
            visible.map((n) =>
              showTrash ? (
                // 回收站行不是可点开的笔记，是一个带「恢复」按钮的普通行——
                // 按钮嵌按钮是无效 HTML（嵌套交互元素），读屏与键盘都会出问题。
                <div key={n.id} className="nv-entry nv-entry-trash" role="option" aria-selected={n.id === selectedId}>
                  <span className="nv-entry-title">
                    {n.notebook ? <span className="nv-notebook-badge">{n.notebook}</span> : null}
                    {n.title || "(无标题)"}
                  </span>
                  <span className="nv-entry-preview">
                    {n.tags.length ? <span className="nv-tags-line">{n.tags.map((tg) => `#${tg}`).join(" ")}</span> : null}
                    {n.bodyMd.slice(0, 60) || "空笔记"}
                  </span>
                  <span className="nv-entry-meta">
                    <button type="button" className="nv-restore" onClick={() => void doRestore(n.id)}>恢复</button>
                  </span>
                </div>
              ) : (
                <button
                  key={n.id}
                  className="nv-entry"
                  role="option"
                  aria-selected={n.id === selectedId}
                  onClick={() => openNote(n)}
                >
                  <span className="nv-entry-title">
                    {n.notebook ? <span className="nv-notebook-badge">{n.notebook}</span> : null}
                    {n.title || "(无标题)"}
                  </span>
                  <span className="nv-entry-preview">
                    {n.tags.length ? <span className="nv-tags-line">{n.tags.map((tg) => `#${tg}`).join(" ")}</span> : null}
                    {n.bodyMd.slice(0, 60) || "空笔记"}
                  </span>
                  <span className="nv-entry-meta">
                    {new Date(n.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </button>
              )
            )
          )}
        </div>
      </section>

      <section className="nv-editor" aria-label="笔记编辑器">
        {!selectedId ? (
          <div className="ws-empty-guide">
            <p style={{ fontWeight: 500 }}>选一篇笔记，或新建一篇</p>
            <span style={{ fontSize: 12 }}>写下的内容会自动保存；断网、不配模型也都能保存与搜索。</span>
          </div>
        ) : (
          <>
            <div className="nv-editor-head">
              <input
                className="nv-title"
                aria-label="笔记标题"
                placeholder="标题"
                value={title}
                onChange={(e) => onEdit(e.target.value, body)}
              />
              <span className={`nv-status nv-status-${STATUS_ATTR[status]}`} role="status" data-save-status={STATUS_ATTR[status]}>
                {STATUS_LABEL[status]}
              </span>
              <div className="nv-actions">
                {selected ? (
                  <>
                    <button
                      type="button"
                      className="ws-icon-button"
                      aria-label={selected.isFavorite ? "取消收藏" : "收藏笔记"}
                      title={selected.isFavorite ? "取消收藏" : "收藏笔记"}
                      onClick={toggleFavorite}
                    >
                      <Icon name="star" />
                    </button>
                    <button
                      type="button"
                      className={`ws-bordered${del.isArmed(selected.id) ? " nv-confirm" : ""}`}
                      onClick={() => del.request(selected.id)}
                    >
                      {del.isArmed(selected.id) ? "再点一次移入回收站" : "移入回收站"}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
            {referenceIssues.length > 0 ? (
              <div className="nv-ref-issues" role="status" aria-label="引用状态">
                {referenceIssues.map((issue) => (
                  <span key={`${issue.noteId}-${issue.status}`} className="nv-ref-issue">
                    {issue.status === "missing"
                      ? `《${issue.title}》已不在库里——这条引用已失效`
                      : `《${issue.title}》的内容改过了——这条引用可能已过期，请复核`}
                  </span>
                ))}
              </div>
            ) : null}
            {statusNote ? (
              <p className={`nv-status-note${status === "conflict" || status === "error" ? " nv-error" : ""}`} role="status">
                {statusNote}
              </p>
            ) : null}
            {status === "conflict" ? (
              <div className="nv-conflict-actions" role="group" aria-label="冲突处理">
                <button type="button" className="ws-bordered" onClick={() => currentSession()?.resolveOverwrite()}>
                  用我的版本覆盖
                </button>
                <button type="button" className="ws-bordered" onClick={() => void keepConflictCopy()}>
                  本地另存副本
                </button>
                <button type="button" className="ws-bordered" onClick={() => void loadRemoteLatest()}>
                  加载远端内容
                </button>
              </div>
            ) : null}
            <textarea
              className="nv-body"
              aria-label="笔记正文"
              placeholder="开始写…（Markdown：# 标题、- 列表、- [ ] 待办、> 引用、``` 代码）"
              value={body}
              onChange={(e) => onEdit(title, e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") e.currentTarget.blur(); }}
            />
            <div className="nv-insert-row" aria-label="引用其它笔记">
              <span className="nv-kbs-label">引用：</span>
              <button
                type="button"
                className="ws-bordered"
                onClick={() => setRefPickerOpen(!refPickerOpen)}
              >
                {refPickerOpen ? "收起引用列表" : "引用另一篇笔记"}
              </button>
              {refPickerOpen ? (
                <span className="nv-ref-picker">
                  <input
                    aria-label="搜索要引用的笔记"
                    placeholder="搜索笔记标题或正文…"
                    value={refQuery}
                    onChange={(e) => setRefQuery(e.target.value)}
                  />
                  {referenceCandidates.length === 0 ? (
                    <span className="ws-hint">没有可引用的笔记（库里只有这一篇，或没有匹配）。</span>
                  ) : (
                    referenceCandidates.map((n) => (
                      <button
                        key={`${n.kind}-${n.id}`}
                        type="button"
                        className="nv-ref-item"
                        onClick={() => insertNoteReference(n)}
                      >
                        《{n.title || (n.kind === "material" ? "无标题素材" : "无标题笔记")}》
                        <span className="ws-hint">{n.kind === "material" ? "素材" : "笔记"}</span>
                        <span className="ws-hint">{excerptOf(n, 40)}</span>
                      </button>
                    ))
                  )}
                </span>
              ) : null}
            </div>
            {attachableMedia.length > 0 ? (
              <div className="nv-insert-row" aria-label="插入附件引用">
                <span className="nv-kbs-label">插入附件引用：</span>
                <select
                  className="nv-kb-select"
                  aria-label="选择要引用的附件"
                  value=""
                  onChange={(e) => { if (e.target.value) { insertAttachment(e.target.value); } }}
                >
                  <option value="">选择素材附件…</option>
                  {attachableMedia.map((m) => (
                    <option key={m.path} value={m.path}>{m.label}</option>
                  ))}
                </select>
                <span className="ws-hint">插入后以 `![附件](media/…)` 引用，保存即随笔记全文可搜。</span>
              </div>
            ) : null}
            <details className="nv-preview" aria-label="正文预览">
              <summary>预览</summary>
              <MarkdownRenderer
                text={body}
                resolveAttachment={(p) => objectUrls.get(p) ?? null}
                onOpenNote={(noteId) => {
                  // 「回原件」：跳到被引用的那篇笔记（引用带 id，改标题不破坏引用）
                  const target = state.notes.find((n) => n.id === noteId);
                  if (target) {
                    openNote(target);
                    setStatusNote(`已跳到《${target.title || "无标题笔记"}》。`);
                  } else {
                    setStatusNote("引用的原笔记已不在库里（可能被删除）——这条引用已失效。");
                  }
                }}
              />
            </details>
            {selected ? (
              <div className="nv-meta-row" aria-label="笔记属性">
                <label className="nv-meta-field">
                  <span>笔记本</span>
                  <input
                    list="nv-notebooks"
                    aria-label="笔记本名称"
                    placeholder="未分组"
                    value={metaValues.notebook ?? ""}
                    onChange={(e) => saveMeta({ notebook: e.target.value.trim() || null })}
                  />
                  <datalist id="nv-notebooks">
                    {[...new Set(activeNotes.map((n) => n.notebook).filter(Boolean))].map((nb) => (
                      <option key={nb} value={nb ?? ""} />
                    ))}
                  </datalist>
                </label>
                <label className="nv-meta-field">
                  <span>标签</span>
                  <input
                    aria-label="笔记标签，逗号分隔"
                    placeholder="用逗号分隔，如：工作, 灵感"
                    value={metaValues.tags.join(", ")}
                    onChange={(e) =>
                      saveMeta({ tags: e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean) })
                    }
                  />
                </label>
              </div>
            ) : null}
            {selected ? (
              <div className="nv-kbs" aria-label="所属知识库">
                <span className="nv-kbs-label">知识库：</span>
                {selectedKbIds.length === 0 ? <span className="ws-hint">未加入任何库</span> : null}
                {selectedKbIds.map((kbId) => {
                  const kb = state.knowledgeBases.find((k) => k.id === kbId);
                  return (
                    <span key={kbId} className="nv-kb-chip">
                      {kb?.name ?? kbId}
                      <button type="button" aria-label={`移出 ${kb?.name ?? kbId}`} onClick={() => void doRemoveFromKb(kbId)}>
                        <Icon name="close" size={12} />
                      </button>
                    </span>
                  );
                })}
                {notInKbs.length > 0 ? (
                  <select
                    className="nv-kb-select"
                    aria-label="加入知识库"
                    value=""
                    onChange={(e) => { if (e.target.value) void doAddToKb(e.target.value); }}
                  >
                    <option value="">加入…</option>
                    {notInKbs.map((k: KnowledgeBase) => (
                      <option key={k.id} value={k.id}>{k.name}</option>
                    ))}
                  </select>
                ) : null}
                <button type="button" className="ws-bordered" onClick={() => setKbFormOpen(!kbFormOpen)}>新建库</button>
                {kbFormOpen ? (
                  <span className="nv-kb-form">
                    <input
                      autoFocus
                      aria-label="知识库名称"
                      placeholder="例如：项目 A"
                      value={kbName}
                      onChange={(e) => setKbName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); void doCreateKb(); }
                        if (e.key === "Escape") setKbFormOpen(false);
                      }}
                    />
                    <button type="button" className="ws-primary" disabled={!kbName.trim()} onClick={() => void doCreateKb()}>创建</button>
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="ws-hint">这篇还没保存过——写下第一段内容会自动保存并出现在列表里。</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
