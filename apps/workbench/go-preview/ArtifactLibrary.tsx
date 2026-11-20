import { useEffect, useState } from "react";
import { DeleteArtifact, ListArtifacts, SaveArtifact } from "./bindings/knowflick.local/workbench-go/previewservice";
import type { Artifact } from "./bindings/knowflick.local/workbench-go/internal/artifacts/models";
import { MarkdownRenderer } from "../src/ui/workspace/MarkdownRenderer";

type Props = {
  generation: number;
  writable: boolean;
  busy: boolean;
  onBusy: (busy: boolean) => void;
};

type Draft = {
  id: string;
  artifactType: string;
  title: string;
  content: string;
  sourceCards: string;
  sourceNotes: string;
  createdAt: number;
  isNew: boolean;
};

const typeLabels: Record<string, string> = { note: "备注", briefing: "简报", "创作草稿": "创作草稿" };

function parseIDs(value: string): string[] {
  return [...new Set(value.split(/[,，\s]+/u).map((id) => id.trim()).filter(Boolean))];
}

export function ArtifactLibrary({ generation, writable, busy, onBusy }: Props) {
  const [items, setItems] = useState<Artifact[] | null>(null);
  const [offsets, setOffsets] = useState([0]);
  const [selectedID, setSelectedID] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = items?.find((item) => item.id === selectedID) ?? items?.[0] ?? null;

  async function loadPage(next: number) {
    const rows = await ListArtifacts(generation, 50, next);
    setItems(rows ?? []);
    setOffsets((current) => current.includes(next) ? current : [...current, next]);
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rows = await ListArtifacts(generation, 50, 0);
        if (active) setItems(rows ?? []);
      } catch (cause) {
        if (active) setError(String(cause));
      }
    })();
    return () => { active = false; };
  }, [generation]);

  async function run(action: () => Promise<void>) {
    onBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (cause) {
      setError(String(cause));
    } finally {
      onBusy(false);
    }
  }

  function openDraft(item?: Artifact) {
    setError("");
    setNotice("");
    setConfirmDelete(false);
    setDraft(item ? {
      id: item.id, artifactType: item.artifactType, title: item.title, content: item.contentMarkdown,
      sourceCards: (item.sourceCardIds ?? []).join(", "), sourceNotes: (item.sourceNoteIds ?? []).join(", "),
      createdAt: item.createdAt, isNew: false,
    } : {
      id: crypto.randomUUID(), artifactType: "note", title: "", content: "",
      sourceCards: "", sourceNotes: "", createdAt: Date.now(), isNew: true,
    });
  }

  async function save() {
    if (!draft || busy) return;
    await run(async () => {
      await SaveArtifact(generation, {
        id: draft.id, artifactType: draft.artifactType, title: draft.title.trim(),
        contentMarkdown: draft.content, sourceCardIds: parseIDs(draft.sourceCards),
        sourceNoteIds: parseIDs(draft.sourceNotes), dateScopeStart: null, dateScopeEnd: null,
        createdAt: draft.createdAt, updatedAt: Date.now(), isDeleted: false,
      });
      setDraft(null);
      setNotice(draft.isNew ? "已新建产物" : "产物已保存");
      await loadPage(0);
      setSelectedID(draft.id);
    });
  }

  async function remove() {
    if (!selected || busy || !confirmDelete) return;
    await run(async () => {
      await DeleteArtifact(generation, selected.id);
      setConfirmDelete(false);
      setNotice("产物已删除（软删除，备份仍保留痕迹）");
      await loadPage(offsets[offsets.length - 1]);
      setSelectedID("");
    });
  }

  return (
    <div className="preview-workspace" aria-label="产物库">
      <section className="preview-list" aria-label="产物列表">
        {writable && <button type="button" disabled={busy || !!draft} onClick={() => openDraft()}>新建产物</button>}
        {!items && !error && <p role="status">正在读取产物…</p>}
        {items && items.length === 0 && <p className="preview-meta">还没有产物。</p>}
        <ul>
          {items?.map((item) => (
            <li key={item.id}>
              <button type="button" disabled={busy || !!draft} aria-current={selected?.id === item.id ? "true" : undefined}
                onClick={() => { setSelectedID(item.id); setConfirmDelete(false); }}>
                <strong>{item.title || "无标题产物"}</strong>
                <small>{typeLabels[item.artifactType] ?? item.artifactType} · {new Date(item.createdAt).toLocaleDateString("zh-CN")}</small>
              </button>
            </li>
          ))}
        </ul>
        {(offsets.length > 1 || (items?.length ?? 0) >= 50) && <div className="preview-actions" aria-label="产物分页">
          <button type="button" disabled={busy || !!draft || offsets.length === 1} onClick={() => void run(() => loadPage(offsets[offsets.length - 2]))}>上一页</button>
          <button type="button" disabled={busy || !!draft || (items?.length ?? 0) < 50} onClick={() => void run(() => loadPage(offsets[offsets.length - 1] + (items?.length ?? 0)))}>下一页</button>
        </div>}
      </section>
      <section className="preview-note preview-editor" aria-label="产物正文">
        {error && <p className="preview-error" role="alert">{error}</p>}
        {notice && <p className="preview-notice" role="status">{notice}</p>}
        {draft ? <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label>类型 <select value={draft.artifactType} disabled={busy} onChange={(event) => setDraft({ ...draft, artifactType: event.target.value })}>
            <option value="note">备注</option>
            <option value="briefing">简报</option>
            <option value="创作草稿">创作草稿</option>
          </select></label>
          <label>标题 <input required value={draft.title} disabled={busy} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label>正文（Markdown）<textarea required value={draft.content} disabled={busy} onChange={(event) => setDraft({ ...draft, content: event.target.value })} /></label>
          <label>来源卡片 ID（逗号分隔）<input value={draft.sourceCards} disabled={busy} onChange={(event) => setDraft({ ...draft, sourceCards: event.target.value })} /></label>
          <label>来源笔记 ID（逗号分隔）<input value={draft.sourceNotes} disabled={busy} onChange={(event) => setDraft({ ...draft, sourceNotes: event.target.value })} /></label>
          <div className="preview-actions">
            <button type="submit" disabled={busy || !draft.title.trim() || !draft.content.trim()}>保存产物</button>
            <button type="button" disabled={busy} onClick={() => setDraft(null)}>取消编辑</button>
          </div>
        </form> : selected && <>
          <h2>{selected.title || "无标题产物"}</h2>
          <p className="preview-meta">{typeLabels[selected.artifactType] ?? selected.artifactType}
            {(selected.sourceCardIds?.length ?? 0) > 0 ? " · 来源卡片 " + (selected.sourceCardIds?.length ?? 0) + " 张" : ""}
            {(selected.sourceNoteIds?.length ?? 0) > 0 ? " · 来源笔记 " + (selected.sourceNoteIds?.length ?? 0) + " 篇" : ""}
            {" · " + new Date(selected.updatedAt).toLocaleString("zh-CN")}</p>
          <MarkdownRenderer text={selected.contentMarkdown} />
          {writable && <div className="preview-actions">
            <button type="button" disabled={busy} onClick={() => openDraft(selected)}>编辑产物</button>
            {confirmDelete ? <>
              <button type="button" disabled={busy} onClick={() => void remove()}>确认删除产物</button>
              <button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>取消</button>
            </> : <button type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>删除产物</button>}
          </div>}
        </>}
      </section>
    </div>
  );
}
