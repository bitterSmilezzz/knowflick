import { useEffect, useState } from "react";
import { CompleteChat, ListNotes, LocalEmbed, ReadAPIKey, ReadSettings, SearchCardsHybrid, SearchNoteChunksVector } from "./bindings/knowflick.local/workbench-go/previewservice";
import type { ChunkHit, HybridCardHit, Note } from "./bindings/knowflick.local/workbench-go/internal/library/models";
import { buildKnowledgeChatBody, selectKnowledgeNotes, type KnowledgeChatExtra } from "../src/domain/knowledgeChat";
import { completionURL, requiresKey } from "../src/domain/ingest";
import { parseSettings } from "../src/domain/settings";
import { MarkdownRenderer } from "../src/ui/workspace/MarkdownRenderer";

type Props = {
  generation: number;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onOpenNote: (id: string) => void;
};

type Cited = { id: string; title: string };
type Message = { role: "user" | "assistant"; content: string; cited?: Cited[] };

/** 哈希投影的向量身份，与 Go 端 embed.HashProvider/HashModel 一致（设置页同款）。 */
const HASH_IDENTITY = { provider: "hash", model: "char-ngram-128" };

export function AskPanel({ generation, busy, onBusy, onOpenNote }: Props) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [settingsText, setSettingsText] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [settings, key, page] = await Promise.all([
          ReadSettings(generation), ReadAPIKey(generation), ListNotes(generation, 0),
        ]);
        if (!active) return;
        setSettingsText(settings ?? "");
        setApiKey(key ?? "");
        setNotes(page.notes ?? []);
      } catch (cause) {
        if (active) setError(String(cause));
      }
    })();
    return () => { active = false; };
  }, [generation]);

  const settings = parseSettings(settingsText || null).settings;
  const keyMissing = requiresKey(settings.baseURL) && !apiKey.trim();

  async function ask() {
    const text = question.trim();
    if (!text || busy || keyMissing) return;
    setQuestion("");
    setError("");
    setNotice("");
    const nextMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    const matched = selectKnowledgeNotes(notes ?? [], text);
    // 多信号检索（与桌面端同形）：关键词笔记之外，再用本地向量做卡片混合召回
    // 与笔记分块召回；向量链路不可用时静默降级为纯关键词，不阻断提问。
    let extraCards: KnowledgeChatExtra[] = [];
    let extraChunks: KnowledgeChatExtra[] = [];
    try {
      const vectors = await LocalEmbed([text], true);
      const queryVector = vectors?.[0] ?? null;
      if (queryVector) {
        const [hybridHits, chunkHits] = await Promise.all([
          SearchCardsHybrid(generation, text, queryVector, HASH_IDENTITY.provider, HASH_IDENTITY.model, 6),
          SearchNoteChunksVector(generation, queryVector, HASH_IDENTITY.provider, HASH_IDENTITY.model, 3),
        ]);
        extraCards = (hybridHits ?? []).slice(0, 4).map((hit: HybridCardHit) => ({
          kind: "card" as const,
          title: hit.card.headline || "无标题卡片",
          body: hit.card.details.slice(0, 1200),
        }));
        extraChunks = (chunkHits ?? []).map((hit: ChunkHit) => ({
          kind: "chunk" as const,
          title: hit.noteTitle || "无标题笔记",
          body: hit.content,
        }));
      }
    } catch (cause) {
      console.warn("向量检索不可用，降级为关键词笔记检索:", cause);
    }
    if (matched.length === 0 && extraCards.length === 0 && extraChunks.length === 0) {
      setMessages([...nextMessages, { role: "assistant", content: "当前资料库中没有检索到与此问题相关的资料。可以先补充资料，或换一个更通用的关键词。" }]);
      return;
    }
    onBusy(true);
    try {
      const body = buildKnowledgeChatBody(settings.model, matched, text, messages.slice(-4).map((message) => ({ role: message.role, content: message.content })), [...extraCards, ...extraChunks]);
      const answer = await CompleteChat(generation, completionURL(settings.baseURL), apiKey.trim(), body);
      setMessages([...nextMessages, { role: "assistant", content: answer, cited: matched.map((note) => ({ id: note.id, title: note.title })) }]);
      const parts = [
        matched.length > 0 ? matched.length + " 篇笔记" : "",
        extraCards.length > 0 ? extraCards.length + " 张卡片" : "",
        extraChunks.length > 0 ? extraChunks.length + " 段笔记片段" : "",
      ].filter(Boolean);
      setNotice("回答基于本地检索到的 " + parts.join("、"));
    } catch (cause) {
      setError(String(cause));
      setMessages(nextMessages);
    } finally {
      onBusy(false);
    }
  }

  return (
    <section className="preview-mail" aria-label="知识问答">
      <div className="preview-mail-head">
        <strong>知识问答</strong>
        <span>在当前资料库中检索笔记、卡片与笔记片段</span>
      </div>
      {error && <p className="preview-error" role="alert">{error}</p>}
      {notice && <p className="preview-notice" role="status">{notice}</p>}
      {keyMissing && <p className="preview-meta">尚未配置 API 密钥。到「设置与本地文件」写入密钥后即可问答。</p>}
      {!notes && <p className="preview-meta" role="status">正在读取笔记…</p>}
      <div className="preview-ask-history">
        {messages.map((message, index) => (
          <article key={index} className={"preview-ask-message " + message.role}>
            <strong>{message.role === "user" ? "我" : "助手"}</strong>
            {message.role === "assistant" ? <MarkdownRenderer text={message.content} /> : <p>{message.content}</p>}
            {message.cited && message.cited.length > 0 && (
              <p className="preview-meta">参考来源：
                {message.cited.map((source) => (
                  <button key={source.id} type="button" className="preview-cite" onClick={() => onOpenNote(source.id)}>{source.title}</button>
                ))}
              </p>
            )}
          </article>
        ))}
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void ask(); }}>
        <label>问题
          <input value={question} disabled={busy || keyMissing} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：我的架构笔记里有哪些性能记录？" />
        </label>
        <div className="preview-actions">
          <button type="submit" disabled={busy || keyMissing || !question.trim()}>提问</button>
          <button type="button" disabled={busy || messages.length === 0} onClick={() => { setMessages([]); setNotice(""); setError(""); }}>清空对话</button>
        </div>
      </form>
    </section>
  );
}
