import {
  useState,
  useEffect,
  useRef,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { Icon } from "./Icon";

export interface CaptureDialogProps {
  onClose: () => void;
  onSave: (input: { title: string; text: string; url: string }) => Promise<void>;
}

export function CaptureDialog({ onClose, onSave }: CaptureDialogProps) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stateRef = useRef({ saving, onClose });
  stateRef.current = { saving, onClose };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        // 防止已处于 open 状态时重复 showModal
      }
    }

    const timer = setTimeout(() => {
      textareaRef.current?.focus();
    }, 30);

    const handleCancel = (e: Event) => {
      if (stateRef.current.saving) {
        e.preventDefault();
        return;
      }
      stateRef.current.onClose();
    };

    dialog.addEventListener("cancel", handleCancel);

    return () => {
      clearTimeout(timer);
      dialog.removeEventListener("cancel", handleCancel);
      if (dialog.open) {
        dialog.close();
      }
    };
  }, []);

  const handleSave = async (e?: FormEvent) => {
    e?.preventDefault();
    if (saving) return;
    const trimmedText = text.trim();
    // HTML5 `required` 只挡「完全空」，一个空格就能过；直接 return 又让点了保存的人
    // 看不到任何反应。所以这里显式给一句错误，别让它静默。
    if (!trimmedText) {
      setError("正文不能为空，记一句话也可以");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        text: trimmedText,
        url: url.trim(),
      });
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err) || "保存失败，请重试";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSave();
    }
  };

  const handleBackdropClick = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) {
      if (saving) return;
      onClose();
    }
  };


  return (
    <dialog
      ref={dialogRef}
      className="ws-dialog"
      aria-labelledby="ws-capture-title"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      data-state={saving ? "saving" : "idle"}
    >
      <header className="ws-dialog-head">
        <h2 id="ws-capture-title">记录闪念</h2>
        <button
          className="ws-icon-button"
          type="button"
          onClick={onClose}
          disabled={saving}
          aria-label="取消并关闭"
        >
          <Icon name="close" />
        </button>
      </header>

      {error && (
        <div role="alert" className="ws-feedback" data-error="true" style={{ border: 0, padding: "6px 0" }}>
          <span>{error}</span>
        </div>
      )}

      {/* noValidate：浏览器原生的 required 气泡在打包后的 webview 里样式不可控，
        而且它挡在 onSubmit 之前，等于把「为什么不能保存」交给系统提示。
        这里自己校验、自己给中文错误，错误文案与位置都可控。 */}
      <form noValidate onSubmit={(e) => void handleSave(e)}>
        <label className="ws-field">
          <span>标题（可选）</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={saving}
            placeholder="简短标题（留空使用正文第一行）"
          />
        </label>

        <label className="ws-field">
          <span>正文</span>
          <textarea
            ref={textareaRef}
            required
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={saving}
            placeholder="记下此刻的想法、观点或待办"
          />
        </label>

        <label className="ws-field">
          <span>来源链接（可选）</span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={saving}
            placeholder="https://..."
          />
        </label>

        <div className="ws-actions">
          <button type="button" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button
            type="submit"
            className="ws-primary"
            disabled={saving}
            title={text.trim() ? undefined : "正文为空，写一句话即可保存"}
          >
            {saving ? "正在存入…" : "存入收件箱"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
