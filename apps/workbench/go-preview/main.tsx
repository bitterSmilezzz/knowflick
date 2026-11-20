import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { ChooseLibrary, DeleteNote, EnableEditing, ListDeletedNotes, ListNotes, OpenInitialLibrary, RestoreNote, SaveNote, SearchNotes } from "./bindings/knowflick.local/workbench-go/previewservice";
import type { LibraryView } from "./bindings/knowflick.local/workbench-go/models";
import type { Note } from "./bindings/knowflick.local/workbench-go/internal/library/models";
import { MarkdownRenderer } from "../src/ui/workspace/MarkdownRenderer";
import "../src/ui/workspace/tokens.css";
import "./preview.css";

function Preview() {
  const [lib, setLib] = useState<LibraryView | null>(null);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [trash, setTrash] = useState(false);

  const notes = lib?.page.notes ?? [];
  const selected = notes.find((n) => n.id === selectedId) ?? null;
  const dirty = selected !== null && (draftTitle !== selected.title || draftBody !== selected.body);

  function adopt(result: LibraryView | null, keepId = false) {
    if (!result) return;
    setLib(result);
    const first = result.page.notes?.[0]?.id ?? "";
    const nextId = keepId && result.page.notes?.some((n) => n.id === selectedId) ? selectedId : first;
    const note = result.page.notes?.find((n) => n.id === nextId) ?? null;
    setSelectedId(note?.id ?? "");
    setDraftTitle(note?.title ?? "");
    setDraftBody(note?.body ?? "");
  }

  function fail(cause: unknown) {
    setError(cause instanceof Error ? cause.message : String(cause));
    setNotice("");
  }

  useEffect(() => {
    void OpenInitialLibrary().then((r: LibraryView | null) => adopt(r)).catch(fail).finally(() => setBusy(false));
  }, []);

  async function reload(generation: number, term = submitted, trashMode = trash) {
    const page = trashMode ? await ListDeletedNotes(generation, 0) : term ? await SearchNotes(generation, term) : await ListNotes(generation, 0);
    setLib((prev) => (prev ? { ...prev, page } : prev));
    return page;
  }

  async function choose() {
    setBusy(true); setError(""); setNotice("");
    try { adopt(await ChooseLibrary()); setQuery(""); setSubmitted(""); setTrash(false); }
    catch (fail) {} finally { setBusy(false); }
  }

  async function enableEditing() {
    if (!lib) return;
    setBusy(true); setError(""); setNotice("");
    try { adopt(await EnableEditing(), true); setNotice("已启用编辑：保存会写进这个资料库文件"); }
    catch (fail) {} finally { setBusy(false); }
  }


  async function toggleTrash() {
    if (!lib || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const next = !trash;
      const page = next ? await ListDeletedNotes(lib.generation, 0) : submitted ? await SearchNotes(lib.generation, submitted) : await ListNotes(lib.generation, 0);
      setTrash(next);
      setLib({ ...lib, page });
      setSelectedId(""); setDraftTitle(""); setDraftBody("");
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function createNote() {
    if (!lib || !lib.writable || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const note: Note = { id: crypto.randomUUID(), title: "无标题笔记", body: "", notebook: null, tagsJson: "[]", pinned: false, favorite: false, archivedAt: null, sourceMaterialId: null, revision: 0, createdAt: 0, updatedAt: 0, deleted: false, deletedAt: null, excludeFromProfile: false };
      await SaveNote(lib.generation, note, 0);
      setQuery(""); setSubmitted("");
      await reload(lib.generation, "", false);
      setTrash(false);
      setNotice("已新建笔记");
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function restoreNote(id: string) {
    if (!lib || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const ok = await RestoreNote(lib.generation, id);
      await reload(lib.generation, "", false);
      setTrash(false);
      setNotice(ok ? "已恢复到笔记列表" : "这篇不在回收站里");
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  async function search(event: FormEvent) {
    event.preventDefault();
    if (!lib || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const term = query.trim();
      const page = term ? await SearchNotes(lib.generation, term) : await ListNotes(lib.generation, 0);
      setLib({ ...lib, page });
      setSubmitted(term);
      const first = page.notes?.[0] ?? null;
      setSelectedId(first?.id ?? "");
      setDraftTitle(first?.title ?? "");
      setDraftBody(first?.body ?? "");
    } catch (fail) {} finally { setBusy(false); }
  }

  async function save() {
    if (!lib || !selected || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const note: Note = { ...selected, title: draftTitle, body: draftBody };
      const outcome = await SaveNote(lib.generation, note, selected.revision);
      await reload(lib.generation);
      setNotice(outcome.created ? "已新建" : "已保存（修订 " + outcome.revision + "）");
    } catch (cause) {
      try { await reload(lib.generation); } catch {}
      fail(cause);
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!lib || !selected || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const gone = await DeleteNote(lib.generation, selected.id);
      await reload(lib.generation);
      setNotice(gone ? "已移进回收站" : "这篇已经在回收站里了");
      setSelectedId(""); setDraftTitle(""); setDraftBody("");
    } catch (fail) {} finally { setBusy(false); }
  }

  return (
    <main className="preview-app" aria-busy={busy}>
      <header className="preview-header">
        <div>
          <h1>KnowFlick <small>Go 版预览</small></h1>
          <p>{lib ? lib.name : "未打开资料库"}{lib && !lib.writable ? "（只读）" : ""}</p>
        </div>
        <div className="preview-actions">
          {lib && !lib.writable && <button type="button" disabled={busy} onClick={() => void enableEditing()}>启用编辑</button>}
          {lib && lib.writable && <button type="button" disabled={busy} onClick={() => void createNote()}>新建笔记</button>}
          {lib && <button type="button" disabled={busy} onClick={() => void toggleTrash()}>{trash ? "返回笔记" : "回收站"}</button>}
          <button type="button" disabled={busy} onClick={() => void choose()}>打开资料库</button>
        </div>
      </header>
      {error && <p className="preview-error" role="alert">{error}</p>}
      {notice && <p className="preview-notice" role="status">{notice}</p>}

      {lib && <div className="preview-workspace">
        <section className="preview-list" aria-label="笔记列表">
          <form onSubmit={(e) => void search(e)} role="search">
            <input type="search" aria-label="搜索笔记" placeholder="搜索标题或正文" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button disabled={busy}>搜索</button>
          </form>
          <p className="preview-count" role="status">{submitted ? "找到 " : "已显示 "}{notes.length} 篇</p>
          <ul>
            {notes.map((note) => <li key={note.id}>
              <div className="preview-note-row">
                <button type="button" aria-current={note.id === selectedId ? "true" : undefined} onClick={() => { setSelectedId(note.id); setDraftTitle(note.title); setDraftBody(note.body); }}>
                  <strong>{note.title || "无标题笔记"}</strong>
                  {(note.notebook || note.pinned || note.archivedAt != null) && <small>{[note.pinned ? "置顶" : "", note.notebook, note.archivedAt != null ? "已归档" : ""].filter(Boolean).join(" · ")}</small>}
                </button>
                {trash && <button type="button" className="preview-restore" disabled={busy} onClick={() => void restoreNote(note.id)}>恢复</button>}
              </div>
            </li>)}
          </ul>
        </section>

        <section className="preview-note" aria-label="笔记正文">
          {selected ? <div className="preview-editor">
            {lib.writable ? <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <label htmlFor="note-title">标题</label>
              <input id="note-title" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} />
              <label htmlFor="note-body">正文（Markdown）</label>
              <textarea id="note-body" value={draftBody} onChange={(e) => setDraftBody(e.target.value)} rows={14} />
              <div className="preview-actions">
                <button type="submit" disabled={busy || !dirty}>保存</button>
                <button type="button" disabled={busy} onClick={() => void remove()}>移进回收站</button>
                <span className="preview-meta">{dirty ? "有未保存改动" : "已保存 · 修订 " + selected.revision}</span>
              </div>
            </form> : <div>
              <h2>{selected.title || "无标题笔记"}</h2>
              <p className="preview-meta">修订 {selected.revision} · {new Date(selected.updatedAt).toLocaleString("zh-CN")} · 只读模式</p>
              <MarkdownRenderer text={selected.body} />
            </div>}
          </div> : <p className="preview-meta">{submitted ? "没有匹配的笔记" : "这个资料库还没有笔记"}</p>}
        </section>
      </div>}
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Preview />);
