import { useEffect, useState } from "react";
import { BrowseCards, DeleteCardContent, SaveCardContent } from "./bindings/knowflick.local/workbench-go/previewservice";
import type { EditableCard } from "./bindings/knowflick.local/workbench-go/internal/cards/models";
import type { CardPage } from "./bindings/knowflick.local/workbench-go/internal/library/models";
import { MarkdownRenderer } from "../src/ui/workspace/MarkdownRenderer";

type Props = {
  generation: number;
  writable: boolean;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onEditing: (editing: boolean) => void;
};

type Draft = { id: string; version: number; headline: string; details: string; category: string; tags: string };

export function CardLibrary({ generation, writable, busy, onBusy, onEditing }: Props) {
  const [page, setPage] = useState<CardPage | null>(null);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [offsets, setOffsets] = useState([0]);
  const [selectedID, setSelectedID] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const cards = page?.cards ?? [];
  const selected = cards.find((card) => card.id === selectedID) ?? cards[0];

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await BrowseCards(generation, "", 0);
        if (active) setPage(result);
      } catch (cause) {
        if (active) setError(String(cause));
      }
    })();
    return () => { active = false; };
  }, [generation]);

  async function loadPage(term: string, nextOffsets: number[]) {
    const result = await BrowseCards(generation, term, nextOffsets[nextOffsets.length - 1]);
    setPage(result);
    setSubmitted(term);
    setOffsets(nextOffsets);
    setConfirmDelete(false);
  }

  async function navigate(term: string, nextOffsets: number[]) {
    if (busy || draft) return;
    onBusy(true);
    setError("");
    setNotice("");
    try {
      await loadPage(term, nextOffsets);
    } catch (cause) {
      setError(String(cause));
    } finally {
      onBusy(false);
    }
  }

  function edit(card?: EditableCard) {
    setError("");
    setNotice("");
    setConfirmDelete(false);
    setDraft(card ? {
      id: card.id, version: card.version, headline: card.content.headline,
      details: card.content.details, category: card.content.category, tags: card.content.tags?.join(", ") ?? "",
    } : { id: crypto.randomUUID(), version: 0, headline: "", details: "", category: "未分类", tags: "" });
    onEditing(true);
  }

  function closeDraft() {
    setDraft(null);
    onEditing(false);
  }

  async function save() {
    if (!draft || busy || !draft.headline.trim() || !draft.details.trim()) return;
    onBusy(true);
    setError("");
    setNotice("");
    try {
      const { id, version, headline, details, category, tags } = draft;
      const original = selected?.id === id ? selected.content : undefined;
      const originalTags = original?.tags ?? [];
      const savedTags = tags === originalTags.join(", ")
        ? originalTags
        : [...new Set(tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))];
      const summary = original?.details === details ? original.summary : [...details].slice(0, 160).join("");
      await SaveCardContent(generation, { id, version, content: {
        headline, details, summary, category: category.trim(), tags: savedTags,
      } });
      closeDraft();
      setSelectedID(id);
      setNotice(version === 0 ? "已新建卡片" : "卡片已保存");
      if (version === 0) setQuery("");
      await loadPage(version === 0 ? "" : submitted, version === 0 ? [0] : offsets);
    } catch (cause) {
      setError(String(cause));
    } finally {
      onBusy(false);
    }
  }

  async function remove() {
    if (!selected || busy || !confirmDelete) return;
    onBusy(true);
    setConfirmDelete(false);
    setError("");
    setNotice("");
    try {
      await DeleteCardContent(generation, selected.id, selected.version);
      setSelectedID("");
      setNotice("卡片已删除");
      await loadPage(submitted, cards.length === 1 && offsets.length > 1 ? offsets.slice(0, -1) : offsets);
    } catch (cause) {
      setError(String(cause));
    } finally {
      onBusy(false);
    }
  }

  return (
    <div className="preview-workspace" aria-label="卡片库">
      <section className="preview-list" aria-label="卡片列表">
        <form role="search" onSubmit={(event) => { event.preventDefault(); void navigate(query.trim(), [0]); }}>
          <input type="search" aria-label="搜索卡片" placeholder="搜索标题、正文或标签" value={query} disabled={busy || !!draft} onChange={(event) => setQuery(event.target.value)} />
          <button type="submit" disabled={busy || !!draft}>搜索</button>
        </form>
        {writable && <button type="button" disabled={busy || !!draft || !page} onClick={() => edit()}>新建卡片</button>}
        {!page && !error && <p role="status">正在读取卡片…</p>}
        {page && cards.length === 0 && <p className="preview-meta">{submitted ? "没有匹配的卡片" : "卡片库为空"}</p>}
        <ul>
          {cards.map((card) => (
            <li key={card.id}>
              <button type="button" disabled={busy || !!draft} aria-current={selected?.id === card.id ? "true" : undefined}
                onClick={() => { setSelectedID(card.id); setConfirmDelete(false); }}>
                <strong>{card.content.headline || "无标题卡片"}</strong>
                {card.content.category && <small>{card.content.category}</small>}
              </button>
            </li>
          ))}
        </ul>
        {(offsets.length > 1 || page?.hasMore) && <div className="preview-actions" aria-label="卡片分页">
          <button type="button" disabled={busy || !!draft || offsets.length === 1} onClick={() => void navigate(submitted, offsets.slice(0, -1))}>上一页</button>
          <button type="button" disabled={busy || !!draft || !page?.hasMore} onClick={() => void navigate(submitted, [...offsets, offsets[offsets.length - 1] + cards.length])}>下一页</button>
        </div>}
      </section>
      <section className="preview-note preview-editor" aria-label="卡片正文">
        {error && <p className="preview-error" role="alert">{error}</p>}
        {notice && <p className="preview-notice" role="status">{notice}</p>}
        {draft ? <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label>标题<input required value={draft.headline} disabled={busy} onChange={(event) => setDraft({ ...draft, headline: event.target.value })} /></label>
          <label>正文（Markdown）<textarea required value={draft.details} disabled={busy} onChange={(event) => setDraft({ ...draft, details: event.target.value })} /></label>
          <label>分类<input value={draft.category} disabled={busy} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /></label>
          <label>标签（逗号分隔）<input value={draft.tags} disabled={busy} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} /></label>
          <div className="preview-actions">
            <button type="submit" disabled={busy || !draft.headline.trim() || !draft.details.trim()}>保存卡片</button>
            <button type="button" disabled={busy} onClick={closeDraft}>取消编辑</button>
          </div>
        </form> : selected && <>
          <h2>{selected.content.headline || "无标题卡片"}</h2>
          <p className="preview-meta">{[selected.content.category, ...(selected.content.tags ?? [])].filter(Boolean).join(" · ")}</p>
          <MarkdownRenderer text={selected.content.details} />
          {writable && <div className="preview-actions">
            <button type="button" disabled={busy} onClick={() => edit(selected)}>编辑卡片</button>
            {confirmDelete ? <>
              <button type="button" disabled={busy} onClick={() => void remove()}>确认删除卡片</button>
              <button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>取消</button>
            </> : <button type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>删除卡片</button>}
          </div>}
        </>}
      </section>
    </div>
  );
}
