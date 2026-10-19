import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ASR_MODELS,
  DEFAULT_ASR_MODEL,
  findAsrModel,
  formatBytes,
  type AsrModelId,
} from "../../domain/asr";
import { asrDownloadModel, asrModelStatus, inShell, type AsrModelStatus } from "../../shell/store";

interface Props {
  /** 当前选中的模型；来自插件偏好。 */
  model: string;
  onModelChange: (model: AsrModelId) => void;
}

/**
 * 语音模型管理（official-speech-asr 的「按需下载」部分）。
 *
 * 只负责「装没装、要不要下、下到哪一步」；真正推理在 Rust 侧。
 * 下载走宿主命令，进度靠 `knowflick:asr-progress` 事件。
 */
export function AsrModelPanel({ model, onModelChange }: Props) {
  const [status, setStatus] = useState<AsrModelStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<{ downloaded: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const spec = findAsrModel(model) ?? findAsrModel(DEFAULT_ASR_MODEL)!;

  useEffect(() => {
    if (!inShell()) return;
    let disposed = false;
    void asrModelStatus(model)
      .then((s) => {
        if (!disposed) setStatus(s);
      })
      .catch((err) => {
        if (!disposed) setError(String(err));
      });
    return () => {
      disposed = true;
    };
  }, [model]);

  useEffect(() => {
    if (!inShell()) return;
    let dispose: (() => void) | undefined;
    void listen<{ model: string; downloaded: number; total: number; done?: boolean }>(
      "knowflick:asr-progress",
      (event) => {
        if (event.payload.model !== model) return;
        setProgress({ downloaded: event.payload.downloaded, total: event.payload.total });
      }
    ).then((unlisten) => {
      dispose = unlisten;
    });
    return () => dispose?.();
  }, [model]);

  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    setError("");
    setProgress({ downloaded: 0, total: spec.approxBytes });
    try {
      const next = await asrDownloadModel(model);
      setStatus(next);
      setProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  };

  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : null;

  return (
    <div className="ws-asr-panel" data-asr-panel>
      <div className="ws-asr-row">
        <label className="ws-field">
          识别模型
          <select
            value={model}
            aria-label="语音识别模型"
            disabled={downloading}
            onChange={(e) => onModelChange(e.target.value as AsrModelId)}
          >
            {ASR_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <div className="ws-asr-status" data-asr-status={status?.installed ? "installed" : "missing"}>
          {!inShell() ? (
            <span>语音转写只在桌面客户端可用</span>
          ) : status?.installed ? (
            <span>
              已安装 · {formatBytes(status.sizeBytes)}
              {status.path ? <code className="ws-asr-path">{status.path}</code> : null}
            </span>
          ) : (
            <span>未安装 · 需要下载约 {formatBytes(spec.approxBytes)}</span>
          )}
        </div>
      </div>

      <p className="ws-plugin-note">{spec.note}</p>

      {inShell() && !status?.installed ? (
        <div className="ws-asr-actions">
          <button
            type="button"
            className="ws-bordered"
            data-action="download-asr-model"
            disabled={downloading}
            onClick={() => void download()}
          >
            {downloading ? "正在下载…" : `下载 ${spec.label} 模型`}
          </button>
          {percent !== null ? (
            <span className="ws-hint" data-asr-progress={percent}>
              {percent}% · {formatBytes(progress?.downloaded ?? 0)} / {formatBytes(progress?.total ?? 0)}
            </span>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="ws-hint" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
