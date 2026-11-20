import { useEffect, useState } from "react";
import { CaptureMaterial, ConvertMaterialToCard, EnsureNoteFromMaterial, FetchClipPage, ImportAudioMaterial, ImportImages, ListMaterials, SaveInkMaterial, SaveRecordingMaterial, SearchMaterials, TranscribeRecording, UpdateMaterialStatus } from "./bindings/knowflick.local/workbench-go/previewservice";
import { digest } from "../src/domain/clipEngine";
import { formatDuration, parseInk, type InkDocument } from "../src/domain/ink";
import { bytesToBase64 } from "../src/shell/base64";
import { attachmentKindOf } from "../src/domain/attachmentKind";
import { AttachmentView } from "../src/ui/workspace/AttachmentView";
import { useAttachments } from "./attachments";
import { InkPad, VoiceRecorder } from "../src/ui/workspace/NotePads";
import type { Material } from "./bindings/knowflick.local/workbench-go/internal/materials/models";

interface RecordingMetadata {
  durationMs?: number;
  mime?: string;
  ink?: unknown;
  transcript?: string;
  transcribed?: boolean;
}

function recordingMetadataOf(material: Material): RecordingMetadata {
  try {
    const parsed: unknown = JSON.parse(material.metadataJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as RecordingMetadata : {};
  } catch {
    return {};
  }
}

type Props = {
  generation: number;
  writable: boolean;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onChanged: () => void;
};

const statusLabels: Record<string, string> = { inbox: "待处理", processed: "已处理", dismissed: "已忽略" };

export function MaterialLibrary({ generation, writable, busy, onBusy, onChanged }: Props) {
  const [items, setItems] = useState<Material[] | null>(null);
  const [inboxOnly, setInboxOnly] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedID, setSelectedID] = useState("");
  const [confirmConvert, setConfirmConvert] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [capturePad, setCapturePad] = useState<"ink" | "voice" | null>(null);
  const [capTitle, setCapTitle] = useState("");
  const [capText, setCapText] = useState("");
  const [capURL, setCapURL] = useState("");
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const selected = items?.find((item) => item.id === selectedID) ?? items?.[0] ?? null;


  const attachmentPath = selected?.mediaPath?.trim() ?? "";
  const attachmentKind = attachmentKindOf(attachmentPath);
  const attachments = useAttachments(generation, attachmentKind ? attachmentPath : "");
  const attachment = attachments?.get(attachmentPath);
  const recording = selected?.sourceType === "audio" ? recordingMetadataOf(selected) : null;
  const inkSketch = selected?.sourceType === "ink" ? parseInk(recordingMetadataOf(selected).ink) : null;
  const duration = recording?.durationMs;

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

  async function importAudio() {
    if (!writable || busy) return;
    await run(async () => {
      const id = await ImportAudioMaterial(generation);
      if (!id) return;
      setError("");
      setQuery("");
      setSelectedID(id);
      setConfirmConvert(false);
      setNotice("音频已导入，可在详情里转写");
      onChanged();
      await refresh(inboxOnly, "");
    });
  }

  async function importImages() {
    if (!writable || busy) return;
    await run(async () => {
      const result = await ImportImages(generation);
      const imported = result.importedIds ?? [];
      const failures = result.failures ?? [];
      if (imported.length === 0 && result.skipped === 0 && failures.length === 0) return;
      setNotice("导入 " + imported.length + " 张，跳过重复 " + result.skipped + " 张，失败 " + failures.length + " 张");
      if (failures.length > 0) setError(failures.join("\n"));
      if (imported.length > 0) {
        setQuery("");
        setSelectedID(imported[0]);
        setConfirmConvert(false);
        onChanged();
        await refresh(inboxOnly, "");
      }
    });
  }

  async function saveMediaCapture(save: () => Promise<string>, message: string, afterSave?: (id: string) => Promise<void>) {
    if (busy) throw new Error("请等当前操作完成后再保存");
    onBusy(true);
    try {
      const id = await save();
      setCapturePad(null);
      setError("");
      setQuery("");
      setSelectedID(id);
      setConfirmConvert(false);
      setNotice(message);
      onChanged();
      try {
        await refresh(inboxOnly, "");
      } catch (cause) {
        setError("刷新素材列表失败：" + String(cause));
      }
      await afterSave?.(id);
    } finally {
      onBusy(false);
    }
  }

  function saveInk(doc: InkDocument) {
    return saveMediaCapture(
      () => SaveInkMaterial(generation, JSON.stringify(doc)),
      "手写笔记已存入收件箱（" + doc.strokes.length + " 笔）",
    );
  }

  function saveRecording(audio: Blob, durationMs: number) {
    return saveMediaCapture(async () => {
      if (audio.size > 64 * 1024 * 1024) throw new Error("录音附件超过 64 MB 上限，请重录较短的片段");
      const encoded = await bytesToBase64(new Uint8Array(await audio.arrayBuffer()));
      return SaveRecordingMaterial(generation, audio.type || "audio/webm", durationMs, encoded);
    }, "语音笔记已存入收件箱（" + formatDuration(durationMs) + "）", (id) => transcribeRecording(id, ""));
  }

  async function transcribeRecording(id: string, term: string) {
    setTranscribing(true);
    try {
      const status = await TranscribeRecording(generation, id);
      const messages: Record<string, string> = {
        disabled: "自动转写已关闭。可在「更多 → 语音转写」中开启。",
        "missing-model": "语音模型尚未下载。下载后可在此重试转写。",
        empty: "没有识别出文字，录音已保留。",
        already: "这条录音已有转写。",
        saved: "已用本地 Whisper 转写，音频仍保存在本机。",
      };
      setNotice((previous) => [previous, messages[status]].filter(Boolean).join(" "));
      if (status === "saved") {
        try {
          await refresh(inboxOnly, term);
        } catch (cause) {
          setError("转写已保存，刷新素材列表失败：" + String(cause));
        }
      }
    } catch (cause) {
      setError("录音已保留，转写失败：" + String(cause));
    } finally {
      setTranscribing(false);
    }
  }

  function openCapturePad(pad: "ink" | "voice") {
    setError("");
    setNotice("");
    setCapturePad(pad);
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
      onChanged();
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
      onChanged();
      await refresh(inboxOnly, query.trim());
    });
  }

  async function toNote() {
    if (!selected || !writable || busy) return;
    await run(async () => {
      const outcome = await EnsureNoteFromMaterial(generation, selected.id);
      setNotice(outcome.created ? "已转为笔记，素材保留在库里" : "这条素材已有笔记，直接打开即可（幂等）");
    });
  }

  async function mark(status: "processed" | "dismissed") {
    if (!selected || !writable || busy) return;
    await run(async () => {
      await UpdateMaterialStatus(generation, selected.id, status);
      setNotice(status === "processed" ? "已标为已处理" : "已忽略这条素材");
      onChanged();
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

        {writable && <div className="preview-actions">
          <button type="button" disabled={busy || fetching} onClick={() => void importImages()}>导入图片</button>
          <button type="button" disabled={busy || fetching} onClick={() => void importAudio()}>导入音频</button>
        </div>}
        {writable && <details className="preview-knowledge-bases" open={captureOpen} onToggle={(event) => setCaptureOpen(event.currentTarget.open)}>
          <summary>记录素材</summary>
          <div className="preview-actions">
            <button type="button" disabled={busy || fetching || capturePad !== null} aria-expanded={capturePad === "ink"} onClick={() => openCapturePad("ink")}>手写笔记</button>
            <button type="button" disabled={busy || fetching || capturePad !== null} aria-expanded={capturePad === "voice"} onClick={() => openCapturePad("voice")}>语音笔记</button>
          </div>
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
        {error && <p className="preview-error preview-material-error" role="alert">{error}</p>}
        {notice && <p className="preview-notice" role="status">{notice}</p>}
        {transcribing && <p className="preview-meta" role="status">正在本地转写录音…</p>}
        {capturePad && writable && <div className="preview-capture-pad">
          {capturePad === "ink"
            ? <InkPad onCancel={() => setCapturePad(null)} onSave={saveInk} />
            : <VoiceRecorder onCancel={() => setCapturePad(null)} onSave={saveRecording} localStorageHint="录音保存在本机。开启自动转写后，Whisper 会在本机识别。" />}
        </div>}
        {!selected && <p className="preview-meta">没有可显示的素材。</p>}
        {selected && <>
          <h2>{selected.title || "无标题素材"}</h2>
          <p className="preview-meta">{statusLabels[selected.inboxStatus] ?? selected.inboxStatus} · {selected.sourceType}{selected.sourceUrl ? " · " + selected.sourceUrl : ""}</p>
          {attachment && (
            <figure className="preview-material-attachment" data-attachment={selected.sourceType}>
              <AttachmentView payload={attachment} alt={selected.title || "素材附件"} />
              {selected.sourceType === "image" && <figcaption className="preview-meta">图片素材 · 保存在本机</figcaption>}
              {selected.sourceType === "ink" && inkSketch && <figcaption className="preview-meta">手写笔记 · {inkSketch.strokes.length} 笔 · 保存在本机</figcaption>}
              {selected.sourceType === "audio" && <figcaption className="preview-meta">录音 · {duration ? formatDuration(duration) : "时长未知"} · 保存在本机</figcaption>}
            </figure>
          )}
          {attachmentKind && !attachments && <p className="preview-meta" role="status">正在读取附件…</p>}
          {attachmentPath && (!attachmentKind || (attachments && !attachment)) && <p className="preview-meta">附件无法读取：{attachmentPath}</p>}
          {writable && selected.sourceType === "audio" && attachmentKind === "audio" && (
            <button type="button" disabled={busy} onClick={() => void run(() => transcribeRecording(selected.id, query.trim()))}>转写录音</button>
          )}
          {selected.sourceType === "audio" && recording?.transcribed && recording.transcript && (
            <details className="preview-history" open>
              <summary>本地转写</summary>
              <pre className="preview-material-body">{recording.transcript}</pre>
            </details>
          )}
          {selected.sourceType === "audio" && !recording?.transcribed && <p className="preview-meta">这段录音还没有本地转写。</p>}
          {writable && <div className="preview-actions">
            <button type="button" disabled={busy} onClick={() => void toNote()}>转为笔记</button>
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
