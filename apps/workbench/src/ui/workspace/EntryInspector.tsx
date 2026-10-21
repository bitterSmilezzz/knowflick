import { useEffect, useRef, useState, type RefObject } from "react";
import type { Entry } from "./model";
import { Icon, sourceLabel } from "./Icon";
import { openExternalUrl, type RawMaterial } from "../../shell/store";
import type { KnowledgeCard } from "../../domain/card";
import { estimateTokenCount } from "../../domain/ingest";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { mailMetadata } from "../../domain/mail";

interface Props {
  entry: Entry;
  readerRef?: RefObject<HTMLElement | null>;
  onSave: (title: string, text: string, category: string, tags: string[]) => Promise<void>;
  onArchive: () => Promise<void>;
  onConvert: () => Promise<void>;
  onAi: () => Promise<void>;
  onFetch: () => Promise<void>;
  onFavorite: () => Promise<void>;
  busy: boolean;
  onSettings: () => void;
  aiReady: boolean;
}

export function EntryInspector({
  entry,
  readerRef,
  onSave,
  onArchive,
  onConvert,
  onAi,
  onFetch,
  onFavorite,
  busy,
  onSettings,
  aiReady,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(entry.title);
  const [text, setText] = useState(entry.text);
  const [category, setCategory] = useState(entry.category);
  const [tags, setTags] = useState(entry.tags.join(", "));
  const [error, setError] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const resetDraft = () => {
    setTitle(entry.title); setText(entry.text); setCategory(entry.category); setTags(entry.tags.join(", "));
  };
  useEffect(() => {
    const edit = () => { if (!busy) { resetDraft(); setEditing(true); } };
    window.addEventListener("knowflick:edit-entry", edit);
    return () => window.removeEventListener("knowflick:edit-entry", edit);
  }, [entry, busy]);
  useEffect(() => {
    if (editing) titleRef.current?.focus();
  }, [editing]);

  const run = async (action: () => Promise<void>) => {
    setError("");
    try {
      await action();
    } catch (e) {
      setError(String(e));
    }
  };

  const isCard = entry.kind === "card";
  const card = isCard ? (entry.original as KnowledgeCard) : null;
  const material = !isCard ? (entry.original as RawMaterial) : null;
  const mail = material ? mailMetadata(material) : null;
  const archived = material ? material.inboxStatus !== "inbox" : false;
  const meta = sourceLabel(isCard ? "card" : material?.sourceType ?? "", entry.url);

  return (
    <article ref={readerRef} tabIndex={-1} className="ws-reader" data-workspace-pane="inspector" aria-label="内容详情">
      <div className="ws-reader-scroll">
        {error ? (
          <div className="ws-feedback" role="alert">
            <span>{error}</span>
          </div>
        ) : null}

        {editing ? (
          <form
            className="ws-editor"
            onKeyDown={e => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Escape" && !busy) {
                e.preventDefault(); e.stopPropagation();
                resetDraft(); setEditing(false);
                requestAnimationFrame(() => readerRef?.current?.focus());
              }
            }}
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await onSave(
                  title,
                  text,
                  category,
                  tags
                    .split(/[,，]/)
                    .map((t) => t.trim())
                    .filter(Boolean)
                );
                setEditing(false);
              });
            }}
          >
            <label className="ws-field">
              标题
              <input ref={titleRef} aria-label="标题" required value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            {isCard ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label className="ws-field">
                  分类
                  <input value={category} onChange={(e) => setCategory(e.target.value)} />
                </label>
                <label className="ws-field">
                  标签（逗号分隔）
                  <input value={tags} onChange={(e) => setTags(e.target.value)} />
                </label>
              </div>
            ) : null}
            <label className="ws-field">
              正文
              <textarea aria-label="正文" required value={text} onChange={(e) => setText(e.target.value)} />
            </label>
            <div className="ws-editor-actions">
              <button className="ws-primary" type="submit" disabled={busy}>
                保存修改
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  resetDraft();
                  setEditing(false);
                }}
              >
                取消
              </button>
            </div>
          </form>
        ) : (
          <div className="ws-reader-inner">
            <div className="ws-reader-meta">
              <Icon name={meta.icon} size={14} />
              <span>{meta.label}</span>
            </div>
            <h1>{entry.title}</h1>
            <div className="ws-byline">
              {new Date(entry.date).toLocaleDateString("zh-CN", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </div>
            {(entry.tags.length > 0 || entry.category) && (
              <div className="ws-tags">
                <span>
                  <Icon name="folder" size={14} />
                  {entry.category}
                </span>
                {entry.tags.map((t) => (
                  <span key={t}># {t}</span>
                ))}
              </div>
            )}
            {mail ? (
              <>
                <dl className="mail-inspector-headers">
                  <dt>发件人</dt><dd>{mail.from || "未提供"}</dd>
                  <dt>收件人</dt><dd>{mail.to || "未提供"}</dd>
                  {mail.date ? <><dt>邮件时间</dt><dd>{mail.date}</dd></> : null}
                  {mail.attachments.length ? <><dt>附件名称</dt><dd>{mail.attachments.join("、")}（仅名称，未导入附件）</dd></> : null}
                </dl>
                <div className="ws-prose" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{entry.text}</div>
              </>
            ) : <MarkdownRenderer text={entry.text} />}
            {entry.url ? (
              <button
                className="ws-source-link"
                onClick={() => void run(() => openExternalUrl(entry.url))}
              >
                <Icon name="external" size={14} />
                查看原始来源
              </button>
            ) : null}

            {!isCard ? (
              <div className="ws-material-box">
                <div className="ws-material-box-info">
                  <Icon name="layers" size={16} />
                  <div>
                    <strong>从素材提炼知识</strong>
                    <p>
                      保留原始记录，将关键结论沉淀为原子知识卡（{estimateTokenCount(entry.text).summary}）。
                    </p>
                  </div>
                </div>
                <div className="ws-material-box-actions">
                  <button className="ws-primary" disabled={busy} onClick={() => void run(onConvert)}>
                    <Icon name="card" size={14} /> 保存为知识卡
                  </button>
                  <button className="ws-bordered" disabled={busy} onClick={() => (aiReady ? void run(onAi) : onSettings())}>
                    <Icon name="ask" size={14} /> {aiReady ? "AI 提炼卡片" : "配置 AI"}
                  </button>
                  {entry.url ? (
                    <button className="ws-bordered" disabled={busy} onClick={() => void run(onFetch)}>
                      <Icon name="note" size={14} /> 抓取正文
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <footer className="ws-reader-foot">
        <span>{busy ? "正在处理…" : `${entry.text.length.toLocaleString()} 字符 · 已保存在本机`}</span>
        <div style={{ display: "flex", gap: 4 }}>
          {!editing ? (
            <button className="ws-icon-button" aria-label="编辑" title="编辑" onClick={() => { resetDraft(); setEditing(true); }} disabled={busy}>
              <Icon name="edit" />
            </button>
          ) : null}
          {card ? (
            <button
              className="ws-icon-button"
              aria-label={card.isFavorite ? "取消收藏" : "收藏此卡片"}
              title={card.isFavorite ? "取消收藏" : "收藏"}
              onClick={() => void run(onFavorite)}
              disabled={busy}
            >
              <Icon name="star" />
            </button>
          ) : null}
          {!isCard ? (
            <button
              className="ws-icon-button"
              aria-label={archived ? "移回收件箱" : "归档素材"}
              title={archived ? "移回收件箱" : "归档"}
              onClick={() => void run(onArchive)}
              disabled={busy || editing}
            >
              <Icon name={archived ? "inbox" : "archive"} />
            </button>
          ) : null}
        </div>
      </footer>
    </article>
  );
}
