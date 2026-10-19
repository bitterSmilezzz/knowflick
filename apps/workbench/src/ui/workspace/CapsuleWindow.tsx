import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { makeMaterial } from "./model";
import { storeMaterial } from "./repository";
import { Icon, useSystemAppearance } from "./Icon";
import { inShell } from "../../shell/store";
import "./workspace.css";

export function CapsuleWindow() {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const savingRef = useRef(false);
  const appearance = useSystemAppearance();
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  useEffect(() => {
    document.body.classList.add("capsule-window");
    const focus = () => requestAnimationFrame(() => inputRef.current?.focus());
    window.addEventListener("knowflick:capsule-open", focus);
    window.addEventListener("focus", focus);
    focus();
    return () => {
      document.body.classList.remove("capsule-window");
      window.removeEventListener("knowflick:capsule-open", focus);
      window.removeEventListener("focus", focus);
    };
  }, []);

  const closeCapsule = async () => {
    if (savingRef.current) return;
    try {
      if (inShell()) await invoke("hide_capsule");
      else setNotice("草稿已保留，桌面客户端中此操作会隐藏窗口。");
    } catch (err) { setError(`无法隐藏窗口：${String(err)}`); }
  };

  const handleSave = async () => {
    if (!text.trim() || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await storeMaterial(makeMaterial({ text, title: "", url: "" }), "");
      setText("");
      setNotice("已存入收件箱");
      if (inShell()) {
        try { await invoke("hide_capsule"); }
        catch (err) { setError(`内容已保存，窗口未能隐藏：${String(err)}`); }
      }
    } catch (err) { setError(`未能保存，草稿已保留：${String(err)}`); }
    finally {
      savingRef.current = false;
      setSaving(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") {
      e.preventDefault();
      void closeCapsule();
    } else if (e.key === "Enter" && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSave();
    }
  };

  return (
    <div className="ws-capsule-backdrop" data-appearance={appearance} onKeyDown={handleKeyDown}>
      <section className="ws-capsule-card" aria-label="闪念胶囊">
        <header className="ws-capsule-header" data-tauri-drag-region="">
          <div className="ws-capsule-brand" data-tauri-drag-region="">
            <Icon name="edit" size={16} />
            <strong>闪念胶囊</strong>
            <span className="ws-capsule-sub">{isMac ? "⌥ Space" : "Alt+Space"}</span>
          </div>
          <button type="button" className="ws-capsule-close" disabled={saving} onClick={() => void closeCapsule()} aria-label="隐藏闪念胶囊">
            <Icon name="close" size={14} />
          </button>
        </header>
        <textarea
          ref={inputRef}
          autoFocus
          className="ws-capsule-textarea"
          aria-label="闪念正文"
          placeholder="记下此刻的想法，回车存入收件箱…"
          value={text}
          onChange={(e) => { setText(e.target.value); setNotice(""); }}
          disabled={saving}
        />
        {error ? <p className="ws-capsule-message" role="alert">{error}</p> : null}
        {!error && notice ? <p className="ws-capsule-message" role="status">{notice}</p> : null}
        <footer className="ws-capsule-footer">
          <span className="ws-capsule-tip">Enter 保存 · Shift+Enter 换行 · Esc 隐藏</span>
          <button type="button" className="ws-capsule-submit" disabled={!text.trim() || saving} onClick={() => void handleSave()}>
            {saving ? "正在保存…" : "存入收件箱"}
          </button>
        </footer>
      </section>
    </div>
  );
}
