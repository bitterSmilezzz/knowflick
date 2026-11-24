import { useEffect, useRef, useState } from "react";
import { AsrCatalog, AsrDownloadProgress, AsrModelStatus, AsrTranscribe, ReadRecordingASRSettings, SaveRecordingASRSettings, StartAsrDownload } from "./bindings/knowflick.local/workbench-go/previewservice";
import type { Model, Result, Status } from "./bindings/knowflick.local/workbench-go/internal/asr/models";
import type { AsrDownloadState } from "./bindings/knowflick.local/workbench-go/models";

type Props = {
  generation: number | null;
  writable: boolean;
  busy: boolean;
  onBusy: (busy: boolean) => void;
};

export function AsrPanel({ generation, writable, busy, onBusy }: Props) {
  const [catalog, setCatalog] = useState<Model[]>([]);
  const [model, setModel] = useState("small");
  const [autoTranscribe, setAutoTranscribe] = useState(false);
  const [settingsReady, setSettingsReady] = useState(generation === null);
  const [status, setStatus] = useState<Status | null>(null);
  const [progress, setProgress] = useState<AsrDownloadState | null>(null);
  const [audioPath, setAudioPath] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const timer = useRef<number | null>(null);

  async function refresh(target: string) {
    try {
      setStatus(await AsrModelStatus(target));
    } catch (cause) {
      setError(String(cause));
    }
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [rows, config] = await Promise.all([
          AsrCatalog(),
          generation === null ? null : ReadRecordingASRSettings(generation),
        ]);
        if (!active) return;
        setCatalog(rows ?? []);
        const preferred = config?.model ?? "small";
        const supported = rows?.some((entry: Model) => entry.name === preferred);
        const target = supported ? preferred : "small";
        setModel(target);
        setAutoTranscribe(config?.enabled === true);
        setSettingsReady(true);
        if (!supported) setNotice("资料库所选模型当前不可用。请选择可用模型并保存设置。");
        await refresh(target);
      } catch (cause) {
        if (active) setError(String(cause));
      }
    })();
    return () => {
      active = false;
      if (timer.current) window.clearInterval(timer.current);
    };
  }, []);

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

  async function saveRecordingSettings() {
    if (generation === null || !writable || busy || !settingsReady) return;
    await run(async () => {
      await SaveRecordingASRSettings(generation, autoTranscribe, model);
      setNotice("录音转写设置已保存");
    });
  }

  async function startDownload() {
    if (busy) return;
    await run(async () => {
      await StartAsrDownload(model);
      setNotice("模型下载已开始；完成前不要关闭应用");
      if (timer.current) window.clearInterval(timer.current);
      timer.current = window.setInterval(() => {
        void AsrDownloadProgress(model).then((state: AsrDownloadState) => {
          setProgress(state);
          if (!state.running && (state.done || state.error)) {
            if (timer.current) window.clearInterval(timer.current);
            timer.current = null;
            if (state.error) setError(state.error);
            else setNotice("模型下载完成");
            void refresh(model);
          }
        }).catch(() => undefined);
      }, 400);
    });
  }

  async function transcribe() {
    if (!audioPath.trim() || busy) return;
    await run(async () => {
      setResult(await AsrTranscribe(model, audioPath.trim()));
      setNotice("转写完成");
    });
  }

  const percent = progress && progress.total > 0 ? Math.floor((progress.downloaded * 100) / progress.total) : 0;

  return (
    <section className="preview-mail" aria-label="语音转写">
      <div className="preview-mail-head">
        <strong>语音转写</strong>
        <span>{status?.installed ? "模型已就绪" : "模型未下载"}</span>
      </div>
      {error && <p className="preview-error" role="alert">{error}</p>}
      {notice && <p className="preview-notice" role="status">{notice}</p>}
      <div className="preview-actions">
        <label>模型
          <select value={model} disabled={busy || progress?.running} onChange={(event) => { setModel(event.target.value); void refresh(event.target.value); }}>
            {catalog.map((entry) => <option key={entry.name} value={entry.name}>{entry.name}（{Math.round(entry.expectedBytes / 1024 / 1024)} MB）</option>)}
          </select>
        </label>
        {status?.installed
          ? <span className="preview-meta">已安装 {Math.round((status.sizeBytes ?? 0) / 1024 / 1024)} MB{status.path ? " · " + status.path : ""}</span>
          : <button type="button" disabled={busy || progress?.running} onClick={() => void startDownload()}>
              {progress?.running ? "下载中 " + percent + "%" : "下载模型"}
            </button>}
      </div>
      {generation !== null && <div className="preview-actions">
        <label><input type="checkbox" checked={autoTranscribe} disabled={!writable || !settingsReady || busy}
          onChange={(event) => setAutoTranscribe(event.target.checked)} /> 保存录音后自动转写</label>
        {writable && <button type="button" disabled={!settingsReady || busy || catalog.length === 0} onClick={() => void saveRecordingSettings()}>保存转写设置</button>}
      </div>}
      {progress?.running && <progress aria-label="模型下载进度" value={progress.downloaded} max={progress.total || undefined} />}
      <form onSubmit={(event) => { event.preventDefault(); void transcribe(); }}>
        <label>音频文件路径（其他格式可用 FFmpeg 转换）
          <input required value={audioPath} disabled={busy} placeholder="/Users/you/Voice Note.m4a" onChange={(event) => setAudioPath(event.target.value)} />
        </label>
        <div className="preview-actions">
          <button type="submit" disabled={busy || !audioPath.trim() || !status?.installed}>开始转写</button>
        </div>
      </form>
      {result && <div className="preview-confirm">
        <p className="preview-meta">转写结果（音频 {Math.round(result.audioMs / 1000)} 秒 · 用时 {Math.round(result.elapsedMs / 1000)} 秒 · 模型 {result.model}）：</p>
        <p>{result.text}</p>
      </div>}
    </section>
  );
}
