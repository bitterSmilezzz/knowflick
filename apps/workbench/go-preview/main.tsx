import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { ChooseLibrary, ListNotes, OpenInitialLibrary, SearchNotes } from "./bindings/knowflick.local/workbench-go/previewservice";
import type { LibraryView } from "./bindings/knowflick.local/workbench-go/models";
import { MarkdownRenderer } from "../src/ui/workspace/MarkdownRenderer";
import "../src/ui/workspace/tokens.css";
import "./preview.css";

function Preview() {
  const [library, setLibrary] = useState<LibraryView | null>(null);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  function showLibrary(result: LibraryView | null) {
    if (!result) return;
    setLibrary(result);
    setQuery("");
    setSubmitted("");
    setSelectedId(result.page.notes?.[0]?.id ?? "");
  }

  function reportError(cause: unknown) {
    setError(cause instanceof Error ? cause.message : String(cause));
  }

  useEffect(() => {
    void OpenInitialLibrary().then(showLibrary).catch(reportError).finally(() => setBusy(false));
  }, []);

  async function choose() {
    setBusy(true);
    setError("");
    try { showLibrary(await ChooseLibrary()); }
    catch (cause) { reportError(cause); }
    finally { setBusy(false); }
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!library || busy) return;
    setBusy(true);
    setError("");
    try {
      const term = query.trim();
      const page = term ? await SearchNotes(library.generation, term) : await ListNotes(library.generation, 0);
      setLibrary({ ...library, page });
      setSubmitted(term);
      setSelectedId(page.notes?.[0]?.id ?? "");
    } catch (cause) { reportError(cause); }
    finally { setBusy(false); }
  }

  async function loadMore() {
    if (!library || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await ListNotes(library.generation, (library.page.notes ?? []).length);
      setLibrary({ ...library, page: { ...next, notes: [...(library.page.notes ?? []), ...(next.notes ?? [])] } });
    } catch (cause) { reportError(cause); }
    finally { setBusy(false); }
  }

  const selected = library?.page.notes?.find((note) => note.id === selectedId);
  return (
    <main className="preview-app" aria-busy={busy}>
      <header className="preview-header">
        <div>
          <h1>KnowFlick <small>Go 版只读预览</small></h1>
          <p>{library?.name ?? "未打开资料库"}</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void choose()}>打开资料库</button>
      </header>
      {error && <p className="preview-error" role="alert">{error}</p>}
      {library && <div className="preview-workspace">
        <section className="preview-list" aria-label="笔记列表">
          <form onSubmit={(event) => void search(event)} role="search">
            <input type="search" aria-label="搜索笔记" placeholder="搜索标题或正文" value={query} onChange={(event) => setQuery(event.target.value)} />
            <button disabled={busy}>搜索</button>
          </form>
          <p className="preview-count" role="status">
            {submitted ? "找到 " : "已显示 "}{(library.page.notes ?? []).length} 篇
            {submitted && library.page.hasMore ? "，请缩小搜索范围查看更多" : ""}
          </p>
          <ul>
            {(library.page.notes ?? []).map((note) => <li key={note.id}>
              <button type="button" aria-current={note.id === selectedId ? "true" : undefined} onClick={() => setSelectedId(note.id)}>
                <strong>{note.title || "无标题笔记"}</strong>
                {(note.notebook || note.pinned || note.archivedAt != null) && <small>{[note.pinned ? "置顶" : "", note.notebook, note.archivedAt != null ? "已归档" : ""].filter(Boolean).join(" · ")}</small>}
              </button>
            </li>)}
          </ul>
          {!submitted && library.page.hasMore && <button type="button" disabled={busy} onClick={() => void loadMore()}>加载更多</button>}
        </section>
        <section className="preview-note" aria-label="笔记正文">
          {selected ? <>
            <h2>{selected.title || "无标题笔记"}</h2>
            <p className="preview-meta">修订 {selected.revision} · {new Date(selected.updatedAt).toLocaleString("zh-CN")}</p>
            <MarkdownRenderer text={selected.body} />
          </> : <p className="preview-meta">{submitted ? "没有匹配的笔记" : "这个资料库还没有笔记"}</p>}
        </section>
      </div>}
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Preview />);
