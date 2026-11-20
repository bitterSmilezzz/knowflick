import { useEffect, useState } from "react";
import { CaptureMaterial, ConvertMaterialToCard, FetchClipPage, ListMaterials, SearchMaterials, UpdateMaterialStatus } from "./bindings/knowflick.local/workbench-go/previewservice";
import { digest } from "../src/domain/clipEngine";
import type { Material } from "./bindings/knowflick.local/workbench-go/internal/materials/models";

type Props = {
  generation: number;
  writable: boolean;
  busy: boolean;
  onBusy: (busy: boolean) => void;
};

const statusLabels: Record<string, string> = { inbox: "待处理", processed: "已处理", dismissed: "已忽略" };

export function MaterialLibrary({ generation, writable, busy, onBusy }: Props) {
  const [items, setItems] = useState<Material[] | null>(null);
  const [inboxOnly, setInboxOnly] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedID, setSelectedID] = useState("");
  const [confirmConvert, setConfirmConvert] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [capTitle, setCapTitle] = useState("");
  const [capText, setCapText] = useState("");
  const [capURL, setCapURL] = useState("");
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = items?.find((item) => item.id === selectedID) ?? items?.[0] ?? null;

  async function refresh(inbox: boolean, term: string) {
    const rows = term
      ? await SearchMaterials(generation, term, 100)
      : await ListMaterials(generation, inbox, 100, 0);
    setItems(rows ?? []);
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rows = await ListMaterials(generation, true, 100, 0);
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


  async function fetchClipBody() {
    if (!capURL.trim() || busy || fetching) return;
    setFetching(true);
    setError("");
    setNotice("");
    try {
      const page = await FetchClipPage(generation, capURL.trim());
      const result = digest(page.text, page.finalUrl);
      if (!result) {
        setError("未抽取到正文，请手动粘贴正文后再保存");
        return;
      }
      setCapText(result.aiNote);
      if (!capTitle.trim()) setCapTitle(result.title);
      setNotice("已抓取网页正文，可编辑后再保存");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setFetching(false);
    }
  }

  async function saveCapture() {
    if (!writable || busy) return;
    await run(async () => {
      const id = await CaptureMaterial(generation, capTitle, capText, capURL);
      setCaptureOpen(false);
      setCapTitle("");
      setCapText("");
      setCapURL("");
      setNotice("已存入收件箱");
      setSelectedID(id);
      await refresh(inboxOnly, "");
      setQuery("");
    });
  }

  async function search(event: { preventDefault: () => void }) {
    event.preventDefault();
    await run(() => refresh(inboxOnly, query.trim()));
  }

  async function convert() {
    if (!selected || !writable || busy || !confirmConvert) return;
    await run(async () => {
      const created = await ConvertMaterialToCard(generation, selected.id);
      setConfirmConvert(false);
      setNotice(created ? "已转为卡片，原始素材保留并标为已处理" : "这条素材已有卡片，只把状态标为已处理");
      await refresh(inboxOnly, query.trim());
    });
  }

  async function mark(status: "processed" | "dismissed") {
    if (!selected || !writable || busy) return;
    await run(async () => {
      await UpdateMaterialStatus(generation, selected.id, status);
      setNotice(status === "processed" ? "已标为已处理" : "已忽略这条素材");
      await refresh(inboxOnly, query.trim());
    });
  }

  return (
    <div className="preview-workspace" aria-label="素材库">
      <section className="preview-list" aria-label="素材列表">
        <form role="search" onSubmit={(event) => void search(event)}>
          <input type="search" aria-label="搜索素材" placeholder="搜索标题或正文" value={query} disabled={busy} onChange={(event) => setQuery(event.target.value)} />
          <button type="submit" disabled={busy}>搜索</button>
        </form>

        {writable && <details className="preview-knowledge-bases" open={captureOpen} onToggle={(event) => setCaptureOpen(event.currentTarget.open)}>
          <summary>记录素材</summary>
          <form onSubmit={(event) => { event.preventDefault(); void saveCapture(); }}>
            <label>标题（可留空）<input value={capTitle} disabled={busy || fetching} onChange={(event) => setCapTitle(event.target.value)} /></label>
            <label>正文<textarea required value={capText} disabled={busy || fetching} onChange={(event) => setCapText(event.target.value)} /></label>
            <label>链接（可留空）<input value={capURL} disabled={busy || fetching} onChange={(event) => setCapURL(event.target.value)} placeholder="https://example.org/article" /></label>
            <div className="preview-actions">
              <button type="button" disabled={busy || fetching || !capURL.trim()} onClick={() => void fetchClipBody()}>{fetching ? "抓取中…" : "从链接抓取正文"}</button>
              <button type="submit" disabled={busy || fetching || !capText.trim()}>保存素材</button>
            </div>
          </form>
        </details>}
        <label className="preview-meta">
          <input type="checkbox" checked={inboxOnly} disabled={busy || query.trim() !== ""} onChange={(event) => { const on = event.target.checked; setInboxOnly(on); void run(() => refresh(on, "")); }} />
          只看待处理
        </label>
        {!items && !error && <p role="status">正在读取素材…</p>}
        {items && items.length === 0 && <p className="preview-meta">没有素材。</p>}
        <ul>
          {items?.map((item) => (
            <li key={item.id}>
              <button type="button" disabled={busy} aria-current={selected?.id === item.id ? "true" : undefined}
                onClick={() => { setSelectedID(item.id); setConfirmConvert(false); }}>
                <strong>{item.title || "无标题素材"}</strong>
                <small>{statusLabels[item.inboxStatus] ?? item.inboxStatus}{item.sourceType ? " · " + item.sourceType : ""}</small>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="preview-note preview-editor" aria-label="素材正文">
        {error && <p className="preview-error" role="alert">{error}</p>}
        {notice && <p className="preview-notice" role="status">{notice}</p>}
        {!selected && <p className="preview-meta">没有可显示的素材。</p>}
        {selected && <>
          <h2>{selected.title || "无标题素材"}</h2>
          <p className="preview-meta">{statusLabels[selected.inboxStatus] ?? selected.inboxStatus} · {selected.sourceType}{selected.sourceUrl ? " · " + selected.sourceUrl : ""}</p>
          <pre className="preview-material-body">{selected.rawText || "（这条素材没有正文）"}</pre>
          {writable && <div className="preview-actions">
            {selected.inboxStatus === "inbox" && <>
              <button type="button" disabled={busy} onClick={() => void mark("processed")}>标为已处理</button>
              <button type="button" disabled={busy} onClick={() => void mark("dismissed")}>忽略</button>
            </>}
            {confirmConvert ? <>
              <button type="button" disabled={busy} onClick={() => void convert()}>确认转为卡片</button>
              <button type="button" disabled={busy} onClick={() => setConfirmConvert(false)}>取消</button>
            </> : <button type="button" disabled={busy} onClick={() => setConfirmConvert(true)}>转为卡片</button>}
          </div>}
        </>}
      </section>
    </div>
  );
}
