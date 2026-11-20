import { useEffect, useState } from "react";
import { ListNoteHistory, ReadNoteHistory } from "./bindings/knowflick.local/workbench-go/previewservice";
import type { Note, NoteRevision, NoteRevisionSummary } from "./bindings/knowflick.local/workbench-go/internal/library/models";

type Props = {
  generation: number;
  note: Note;
  writable: boolean;
  dirty: boolean;
  busy: boolean;
  onRestore: (revision: NoteRevision) => Promise<void>;
};

export function NoteHistory({ generation, note, writable, dirty, busy, onRestore }: Props) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<NoteRevisionSummary[] | null>(null);
  const [preview, setPreview] = useState<NoteRevision | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const { id, revision } = note;

  useEffect(() => {
    if (!open) return;
    let active = true;
    setEntries(null);
    setError("");
    void (async () => {
      try {
        const rows = await ListNoteHistory(generation, id);
        if (active) setEntries(rows ?? []);
      } catch (cause) {
        if (active) setError(String(cause));
      }
    })();
    return () => { active = false; };
  }, [open, generation, id, revision]);

  async function readRevision(number: number) {
    setReading(true);
    setPreview(null);
    setConfirming(false);
    setError("");
    try {
      const result = await ReadNoteHistory(generation, id, number);
      if (result) setPreview(result);
      else setError("找不到这一版修订");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setReading(false);
    }
  }

  async function restoreRevision() {
    if (!preview || busy || dirty || !writable || note.deleted) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setPreview(null);
    await onRestore(preview);
  }

  return (
    <details className="preview-history" aria-label="修订历史" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>修订历史</summary>
      {error && <p className="preview-error" role="alert">{error}</p>}
      {open && !entries && !error && <p role="status">正在读取修订历史…</p>}
      {entries?.length === 0 && <p>这篇笔记还没有修订记录。</p>}
      {entries && entries.length > 0 && (
        <ul>
          {entries.map((entry) => (
            <li key={entry.revision}>
              <button type="button" aria-pressed={preview?.revision === entry.revision} disabled={busy || reading} onClick={() => void readRevision(entry.revision)}>
                第 {entry.revision} 版
              </button>
              <span className="preview-meta">{entry.title || "无标题笔记"} · {entry.chars} 字 · {new Date(entry.savedAt).toLocaleString("zh-CN")}</span>
            </li>
          ))}
        </ul>
      )}
      {reading && <p role="status">正在读取修订正文…</p>}
      {preview && (
        <section aria-label={"第 " + preview.revision + " 版正文"}>
          <h3>{preview.title || "无标题笔记"}</h3>
          <pre>{preview.bodyMd || "这一版正文为空"}</pre>
          {writable && !note.deleted && preview.revision !== revision && (
            <>
              {dirty && <p className="preview-meta">请先保存当前改动。</p>}
              {confirming && <p className="preview-meta">所选内容将保存为新的修订，当前修订仍可在历史中查看。</p>}
              <div className="preview-actions">
                <button type="button" disabled={busy || dirty} onClick={() => void restoreRevision()}>
                  {confirming ? "确认恢复" : "恢复到第 " + preview.revision + " 版"}
                </button>
                {confirming && <button type="button" onClick={() => setConfirming(false)}>取消</button>}
              </div>
            </>
          )}
        </section>
      )}
    </details>
  );
}
