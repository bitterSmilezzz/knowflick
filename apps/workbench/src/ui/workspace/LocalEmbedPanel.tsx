import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { localEmbedStatus, localEmbedWarmUp, inShell, type LocalEmbedStatus } from "../../shell/store";
import { userError } from "./userError";

/**
 * 本地语义模型管理（M3「本地轻量 Embedding 推理」）。
 *
 * 模型不随包（约百 MB），首用时下载；下载完会真的跑一次推理验证可用性，
 * 避免「文件下完了但模型跑不起来」被当成安装成功。
 */
export function LocalEmbedPanel() {
  const [status, setStatus] = useState<LocalEmbedStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!inShell()) return;
    let disposed = false;
    void localEmbedStatus()
      .then((s) => {
        if (!disposed) setStatus(s);
      })
      .catch((err) => {
        if (!disposed) setError(userError(err));
      });
    return () => {
      disposed = true;
    };
  }, []);

  const download = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await localEmbedWarmUp();
      setStatus(next);
    } catch (err) {
      setError(userError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ws-settings-card" data-group="embedding">
      <div className="ws-settings-card-head">
        <Icon name="search" size={15} />
        <div>
          <h2>本地语义检索</h2>
          <p className="ws-hint">离线也能按意思找东西；不配 API 时用它替代关键词匹配</p>
        </div>
      </div>

      <div className="ws-settings-body">
        <div className="ws-asr-status" data-embed-status={status?.downloaded ? "installed" : "missing"}>
          {!inShell() ? (
            <span>本地语义模型只在桌面客户端可用（浏览器体验走关键词匹配）</span>
          ) : status?.downloaded ? (
            <span>
              已安装 · {status.model} · {status.dim} 维
              <code className="ws-asr-path">{status.cacheDir}</code>
            </span>
          ) : (
            <span>未安装 · multilingual-e5-small（384 维，约 120 MB）</span>
          )}
        </div>

        {inShell() && !status?.downloaded ? (
          <div className="ws-asr-actions">
            <button
              type="button"
              className="ws-bordered"
              data-action="download-embed-model"
              disabled={busy}
              onClick={() => void download()}
            >
              {busy ? "正在下载并验证…" : "下载本地语义模型"}
            </button>
            <span className="ws-hint">下载后会自动跑一次推理确认可用</span>
          </div>
        ) : null}

        {error ? (
          <p className="ws-hint" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

