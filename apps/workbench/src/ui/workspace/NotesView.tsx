import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addNoteToKnowledgeBase,
  createKnowledgeBaseNamed,
  deleteNoteById,
  readNotes,
  removeNoteFromKnowledgeBase,
  restoreNoteById,
  saveNote,
} from "./repository";
import {
  createNoteDraft,
  listNotes,
  NoteConflictError,
  noteKbIds,
  searchNotes,
  type KnowledgeBase,
  type Note,
  type NotesState,
} from "../../domain/note";
import { emptyNotesState } from "../../domain/note";
import { Icon } from "./Icon";
import { useDeleteConfirm } from "./useDeleteConfirm";

/**
 * 笔记工作面（R1 首个纵向切片）——契约见 docs/NOTES_MODEL.md「界面契约」：
 * 新建直接可写、停止输入自动保存、重启后内容在、可加入知识库、
 * 全文搜索命中正文、删除进回收站。不需要 AI。
 *
 * 三入口导航（笔记/知识库/应用）是下一批；本视图先以独立页挂在侧栏「笔记」下。
 */

const AUTOSAVE_DELAY_MS = 800;

type SaveStatus = "saved" | "saving" | "dirty" | "conflict" | "error";

interface Props {
  dir: string;
  /** Workspace 用最新快照来导出备份；笔记状态由本视图自治加载。 */
  onStateChange?: (state: NotesState) => void;
}

export function NotesView({ dir, onStateChange }: Props) {
  const [state, setState] = useState<NotesState>(emptyNotesState);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [statusNote, setStatusNote] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [showTrash, setShowTrash] = useState(false);
  const [kbFormOpen, setKbFormOpen] = useState(false);
  const [kbName, setKbName] = useState("");
  const [viewError, setViewError] = useState("");

  // 修订基线：上次成功保存后服务端的修订号。保存成功即前移；
  // 冲突时被 NoteConflictError 携带的当前修订替换。
  const savedRevision = useRef(0);
  const dirtyRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const noteRef = useRef<Note | null>(null);

  const activeNotes = useMemo(() => listNotes(state), [state]);
  const trashedNotes = useMemo(
    () => listNotes(state, { includeDeleted: true }).filter((n) => n.isDeleted),
    [state]
  );
  const visible = useMemo(
    () => (listQuery.trim() ? searchNotes(state, listQuery) : showTrash ? trashedNotes : activeNotes),
    [state, listQuery, showTrash, activeNotes, trashedNotes]
  );
  const selected = state.notes.find((n) => n.id === selectedId) ?? null;

  const refresh = useCallback(async () => {
    try {
      const next = await readNotes(dir);
      setState(next);
      onStateChange?.(next);
    } catch (e) {
      setViewError(`读取笔记失败：${String(e)}`);
    } finally {
      setLoaded(true);
    }
  }, [dir, onStateChange]);

  useEffect(() => {
    setLoaded(false);
    setSelectedId(null);
    noteRef.current = null;
    void refresh();
  }, [refresh]);

  // 外部改动（MCP、备份恢复、另一窗口）——只在编辑器干净时同步列表，
  // 正在编辑的草稿不打扰；脏保存时由修订冲突兜底。
  useEffect(() => {
    const onChange = () => {
      if (!dirtyRef.current) void refresh();
    };
    window.addEventListener("knowflick:library-changed", onChange);
    return () => window.removeEventListener("knowflick:library-changed", onChange);
  }, [refresh]);

  const flushSave = useCallback(
    async (note: Note, nextTitle: string, nextBody: string) => {
      setStatus("saving");
      try {
        const outcome = await saveNote({ ...note, title: nextTitle, bodyMd: nextBody }, savedRevision.current, dir);
        savedRevision.current = outcome.revision;
        dirtyRef.current = false;
        setStatus("saved");
        setStatusNote(`已保存 · 修订 ${outcome.revision}`);
        await refresh();
      } catch (err) {
        if (err instanceof NoteConflictError) {
          dirtyRef.current = false;
          savedRevision.current = err.currentRevision;
          setStatus("conflict");
          setStatusNote(`内容已在别处更新（当前修订 ${err.currentRevision}）。下面的草稿仍在，可复制后刷新。`);
          return;
        }
        setStatus("error");
        setStatusNote(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        // 保存失败时保持脏标记：下次输入或卸载会再试，内容不会悄悄丢。
        dirtyRef.current = true;
      }
    },
    [dir, refresh]
  );

  const scheduleSave = useCallback(
    (note: Note, nextTitle: string, nextBody: string) => {
      dirtyRef.current = true;
      setStatus("dirty");
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void flushSave(note, nextTitle, nextBody);
      }, AUTOSAVE_DELAY_MS);
    },
    [flushSave]
  );

  // 最新草稿的只读快照：冲保存的地方（卸载/关窗）从这里取值，
  // 不把 title/body 写进 effect 依赖——否则每次按键都会重跑 effect，
  // cleanup 里的一次性冲刷变成「每个字符冲一次」，与防抖双发竞争后
  // 第二发拿着过期的 baseRevision 撞出假冲突（实测踩过）。
  const draftRef = useRef<{ note: Note | null; title: string; body: string }>({ note: null, title: "", body: "" });
  useEffect(() => {
    draftRef.current = { note: noteRef.current, title, body };
  });

  // 卸载 / 关窗前尽力冲一次未保存的改动（自动保存让损失窗口很小，但别白丢最后一段）。
  useEffect(() => {
    const flush = () => {
      const { note, title: t, body: b } = draftRef.current;
      if (dirtyRef.current && note) void flushSave(note, t, b);
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      flush();
    };
  }, [flushSave]);

  const openNote = useCallback((note: Note) => {
    // 点的是正打开的这篇：什么都不动——重置会把未保存的草稿盖回旧内容。
    if (note.id === selectedId) return;
    // 切走前把未保存的草稿冲掉：当前 title/body 就是那份脏草稿。
    if (dirtyRef.current && noteRef.current && noteRef.current.id !== note.id) {
      void flushSave(noteRef.current, title, body);
    }
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setSelectedId(note.id);
    savedRevision.current = note.currentRevision;
    noteRef.current = note;
    dirtyRef.current = false;
    setTitle(note.title);
    setBody(note.bodyMd);
    setStatus("saved");
    setStatusNote("");
    setViewError("");
  }, [selectedId, body, title, flushSave]);

  const createNote = useCallback(() => {
    const draft = createNoteDraft();
    setSelectedId(draft.id);
    savedRevision.current = 0;
    noteRef.current = draft;
    dirtyRef.current = false;
    setTitle("");
    setBody("");
    setStatus("dirty");
    setStatusNote("");
    // 空笔记先不落库：等第一段内容进来再保存，避免堆积空笔记。
  }, []);

  const onEdit = (nextTitle: string, nextBody: string) => {
    if (!noteRef.current) return;
    setTitle(nextTitle);
    setBody(nextBody);
    scheduleSave(noteRef.current, nextTitle, nextBody);
  };

  const del = useDeleteConfirm(async (target: string) => {
    try {
      await deleteNoteById(target, dir);
      if (selectedId === target) {
        setSelectedId(null);
        noteRef.current = null;
      }
      await refresh();
    } catch (e) {
      setViewError(`移入回收站失败：${String(e)}`);
    }
  });

  const doRestore = async (id: string) => {
    try {
      await restoreNoteById(id, dir);
      await refresh();
    } catch (e) {
      setViewError(`恢复失败：${String(e)}`);
    }
  };

  const toggleFavorite = async () => {
    if (!selected) return;
    try {
      await saveNote({ ...selected, isFavorite: !selected.isFavorite }, selected.currentRevision, dir);
      await refresh();
    } catch (e) {
      setViewError(`收藏失败：${String(e)}`);
    }
  };

  const doCreateKb = async () => {
    const name = kbName.trim();
    if (!name) return;
    try {
      await createKnowledgeBaseNamed(crypto.randomUUID(), name, "", dir);
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
      await addNoteToKnowledgeBase(kbId, selected.id, dir);
      await refresh();
    } catch (e) {
      setViewError(`加入知识库失败：${String(e)}`);
    }
  };

  const doRemoveFromKb = async (kbId: string) => {
    if (!selected) return;
    try {
      await removeNoteFromKnowledgeBase(kbId, selected.id, dir);
      await refresh();
    } catch (e) {
      setViewError(`移出知识库失败：${String(e)}`);
    }
  };

  const reloadAfterConflict = () => {
    const fresh = state.notes.find((n) => n.id === selectedId);
    if (fresh) {
      openNote(fresh);
      setStatusNote("已加载最新内容（本地草稿被替换）");
    }
  };

  const selectedKbIds = selected ? noteKbIds(state, selected.id) : [];
  const notInKbs = state.knowledgeBases.filter((k) => !selectedKbIds.includes(k.id));

  const statusLabel: Record<SaveStatus, string> = {
    saved: "已保存",
    saving: "保存中…",
    dirty: "未保存",
    conflict: "内容冲突",
    error: "保存失败",
  };

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
                  <span className="nv-entry-title">{n.title || "(无标题)"}</span>
                  <span className="nv-entry-preview">{n.bodyMd.slice(0, 60) || "空笔记"}</span>
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
                  <span className="nv-entry-title">{n.title || "(无标题)"}</span>
                  <span className="nv-entry-preview">{n.bodyMd.slice(0, 60) || "空笔记"}</span>
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
        {!selected && !noteRef.current ? (
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
              <span className={`nv-status nv-status-${status}`} role="status" data-save-status={status}>
                {statusLabel[status]}
              </span>
              <div className="nv-actions">
                {selected ? (
                  <>
                    <button
                      type="button"
                      className="ws-icon-button"
                      aria-label={selected.isFavorite ? "取消收藏" : "收藏笔记"}
                      title={selected.isFavorite ? "取消收藏" : "收藏笔记"}
                      onClick={() => void toggleFavorite()}
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
            {statusNote ? (
              <p className={`nv-status-note${status === "conflict" ? " nv-error" : ""}`} role="status">
                {statusNote}
                {status === "conflict" ? (
                  <button type="button" className="ws-bordered" onClick={reloadAfterConflict}>加载最新内容</button>
                ) : null}
              </p>
            ) : null}
            <textarea
              className="nv-body"
              aria-label="笔记正文"
              placeholder="开始写…（Markdown：# 标题、- 列表、- [ ] 待办、> 引用、``` 代码）"
              value={body}
              onChange={(e) => onEdit(title, e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") e.currentTarget.blur(); }}
            />
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
