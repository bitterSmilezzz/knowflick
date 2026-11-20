import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { ChooseLibrary, DeleteNote, EnableEditing, ListDeletedNotes, ListNotes, OpenInitialLibrary, RestoreNote, SaveNote, SearchChunkHits, SearchNotes } from "./bindings/knowflick.local/workbench-go/previewservice";
import type { LibraryView } from "./bindings/knowflick.local/workbench-go/models";
import type { ChunkHit } from "./bindings/knowflick.local/workbench-go/internal/library/models";
import type { Note } from "./bindings/knowflick.local/workbench-go/internal/library/models";
import { ListMailAccounts, MailAutoSyncStatus, StartMailAutoSync, StopMailAutoSync, SyncMailDueNow } from "./bindings/knowflick.local/workbench-go/mailservice";
import type { Account } from "./bindings/knowflick.local/workbench-go/internal/mail/models";
import type { MailStatus } from "./bindings/knowflick.local/workbench-go/models";
import type { Outcome } from "./bindings/knowflick.local/workbench-go/internal/mailschedule/models";
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
  const [chunkMode, setChunkMode] = useState(false);
  const [hits, setHits] = useState<ChunkHit[]>([]);
  const [mailOpen, setMailOpen] = useState(false);
  const [mailAccounts, setMailAccounts] = useState<Account[]>([]);
  const [mailStatus, setMailStatus] = useState<MailStatus | null>(null);
  const [mailInterval, setMailInterval] = useState("15");
  const [mailBusy, setMailBusy] = useState(false);

  const notes = lib?.page.notes ?? [];
  const selected = notes.find((n) => n.id === selectedId) ?? null;
  const dirty = selected !== null && (draftTitle !== selected.title || draftBody !== selected.body);

  function adopt(result: LibraryView | null, keepId = false) {
    if (!result) return;
    setLib(result);
    const first = result.page.notes?.[0]?.id ?? "";
    const nextId = keepId && result.page.notes?.some((n) => n.id === selectedId) ? selectedId : first;
    const note = result.page.notes?.find((n: Note) => n.id === nextId) ?? null;
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
      if (chunkMode && term) {
        const found = await SearchChunkHits(lib.generation, term, 20);
        setHits(found ?? []);
        setNotice("分块命中 " + (found?.length ?? 0) + " 处，偏移可回原文");
        return;
      }
      setHits([]);
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

  async function refreshMail() {
    setMailBusy(true);
    try {
      const [accounts, status] = await Promise.all([ListMailAccounts(), MailAutoSyncStatus()]);
      setMailAccounts(accounts ?? []);
      setMailStatus(status);
    } catch (fail) {
      setError(String(fail));
    } finally { setMailBusy(false); }
  }

  async function toggleMail() {
    const next = !mailOpen;
    setMailOpen(next);
    if (next) await refreshMail();
  }

  async function syncMailNow() {
    setMailBusy(true);
    try {
      const outcomes = await SyncMailDueNow();
      const list: Outcome[] = outcomes ?? [];
      const imported = list.reduce((sum, item) => sum + item.imported, 0);
      const rejected = list.reduce((sum, item) => sum + item.rejected, 0);
      const failed = list.filter((item) => item.error);
      setNotice(`邮箱同步：导入 ${imported} 封，拒收 ${rejected} 封` + (failed.length ? `，${failed.length} 个账号报错` : ""));
      setError(failed.map((item) => `${item.accountId}: ${item.error}`).join("；"));
      if (lib) await reload(lib.generation);
      await refreshMail();
    } catch (fail) {
      setError(String(fail));
    } finally { setMailBusy(false); }
  }

  async function startAuto() {
    const minutes = Number(mailInterval);
    if (!Number.isFinite(minutes) || minutes <= 0) { setError("自动同步间隔必须是大于 0 的分钟数"); return; }
    setMailBusy(true);
    try {
      setMailStatus(await StartMailAutoSync(minutes));
      setNotice(`已开启自动同步，每 ${minutes} 分钟检查一次`);
    } catch (fail) { setError(String(fail)); } finally { setMailBusy(false); }
  }

  async function stopAuto() {
    setMailBusy(true);
    try {
      setMailStatus(await StopMailAutoSync());
      setNotice("已停止自动同步");
    } catch (fail) { setError(String(fail)); } finally { setMailBusy(false); }
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
          {lib && lib.writable && <button type="button" disabled={busy || mailBusy} aria-pressed={mailOpen} onClick={() => void toggleMail()}>{mailOpen ? "收起邮箱" : "邮箱"}</button>}
          {lib && <button type="button" disabled={busy} onClick={() => void toggleTrash()}>{trash ? "返回笔记" : "回收站"}</button>}
          <button type="button" disabled={busy} onClick={() => void choose()}>打开资料库</button>
        </div>
      </header>
      {error && <p className="preview-error" role="alert">{error}</p>}
      {notice && <p className="preview-notice" role="status">{notice}</p>}

      {mailOpen && lib?.writable && <section className="preview-mail" aria-label="邮箱同步">
        <div className="preview-mail-head">
          <strong>邮箱同步</strong>
          <span>{mailAccounts.length} 个账号 · 自动同步{mailStatus?.running ? "运行中" : "已停止"}</span>
        </div>
        {mailAccounts.length === 0 ? <p className="preview-count">还没有配置邮箱账号</p> : (
          <ul className="preview-mail-list">
            {mailAccounts.map((account) => (
              <li key={account.config.id}>
                <span>{account.config.name || account.config.email}</span>
                <small>{account.hasPassword ? "凭据已保存" : "需要重新输入密码"}{account.lastError ? ` · ${account.lastError}` : ""}</small>
              </li>
            ))}
          </ul>
        )}
        <div className="preview-mail-actions">
          <button type="button" disabled={mailBusy} onClick={() => void syncMailNow()}>立即同步</button>
          <input type="number" min="1" aria-label="自动同步间隔（分钟）" value={mailInterval} onChange={(event) => setMailInterval(event.target.value)} />
          <button type="button" disabled={mailBusy || mailStatus?.running} onClick={() => void startAuto()}>开启自动</button>
          <button type="button" disabled={mailBusy || !mailStatus?.running} onClick={() => void stopAuto()}>停止自动</button>
        </div>
        {mailStatus && mailStatus.lastError && <p className="preview-error" role="status">上次错误：{mailStatus.lastError}</p>}
      </section>}

      {lib && <div className="preview-workspace">
        <section className="preview-list" aria-label="笔记列表">
          <form onSubmit={(e) => void search(e)} role="search">
            <input type="search" aria-label="搜索笔记" placeholder={chunkMode ? "搜索分块（可回原文偏移）" : "搜索标题或正文"} value={query} onChange={(e) => setQuery(e.target.value)} />
            <button type="button" aria-pressed={chunkMode} onClick={() => { setChunkMode(!chunkMode); setHits([]); }}>{chunkMode ? "按整篇" : "按分块"}</button>
            <button disabled={busy}>搜索</button>
          </form>

          {hits.length > 0 && <section className="preview-hits" aria-label="分块命中">
            <p className="preview-count" role="status">分块命中 {hits.length} 处</p>
            <ul>
              {hits.map((hit, i) => <li key={hit.noteId + "-" + hit.chunkIndex + "-" + i}>
                <strong>{hit.noteTitle}</strong>
                <span className="preview-meta">字符 {hit.charStart}–{hit.charEnd} · 块 {hit.chunkIndex}</span>
                <p>{hit.content}</p>
                <button type="button" disabled={busy} onClick={() => void (async () => {
                  const page = await SearchNotes(lib!.generation, hit.noteTitle);
                  setLib({ ...lib!, page });
                  const found = page.notes?.find((n: Note) => n.id === hit.noteId);
                  if (found) { setSelectedId(found.id); setDraftTitle(found.title); setDraftBody(found.body); }
                })()}>打开原文</button>
              </li>)}
            </ul>
          </section>}
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
