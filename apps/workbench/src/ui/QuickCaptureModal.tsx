import { useState, useEffect, useRef } from "react";
import { dbSaveMaterial, type RawMaterial } from "../shell/store";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (material: RawMaterial) => void;
  dir: string;
}

export function QuickCaptureModal({ open, onClose, onSaved, dir }: Props) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setText("");
      setSaving(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const isUrl = /^https?:\/\/[^\s]+$/i.test(text.trim());

  const handleSave = async () => {
    const trimmed = text.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    const now = Date.now();
    const id = `mat-${now}-${Math.random().toString(36).substring(2, 7)}`;
    const title = isUrl
      ? `网页剪藏: ${trimmed.substring(0, 60)}`
      : trimmed.split("\n")[0].substring(0, 40);

    const material: RawMaterial = {
      id,
      sourceType: isUrl ? "web" : "manual",
      title,
      sourceUrl: isUrl ? trimmed : null,
      rawText: trimmed,
      cleanedMarkdown: null,
      contentHash: `${now}`,
      mediaPath: null,
      mediaSizeBytes: 0,
      metadataJson: "{}",
      inboxStatus: "inbox",
      createdAt: now,
      updatedAt: now,
    };

    try {
      await dbSaveMaterial(material, dir);
      onSaved(material);
      onClose();
    } catch (err) {
      console.error("保存闪念失败", err);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSave();
    }
  };

  return (
    <div className="quick-capture-backdrop" onClick={onClose}>
      <div className="quick-capture-card" onClick={(e) => e.stopPropagation()}>
        <div className="quick-capture-header">
          <span className="badge">闪念胶囊</span>
          <span className="hint">
            {isUrl ? "识别到链接 · 回车存入待提炼" : "⌘ + 回车存入收件箱 · Esc 退出"}
          </span>
        </div>
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="记下突发灵感、粘贴文章链接、或输入备忘..."
          rows={3}
        />
        <div className="quick-capture-footer">
          <span className="source-tag">{isUrl ? "🔗 网页链接" : "💡 碎片闪念"}</span>
          <button
            type="button"
            className="primary"
            disabled={!text.trim() || saving}
            onClick={() => void handleSave()}
          >
            {saving ? "存储中..." : "存入收件箱"}
          </button>
        </div>
      </div>
    </div>
  );
}
