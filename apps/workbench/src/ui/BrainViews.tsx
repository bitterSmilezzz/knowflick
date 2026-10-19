import { useState } from "react";
import type { KnowledgeCard } from "../domain/card";
import { generateCognitiveBriefing, type CognitiveBriefing } from "../domain/briefing";
import { searchCards } from "../domain/search";
import { completeChat } from "../shell/store";
import type { AiSettings } from "../domain/settings";
import { completionURL, requiresKey } from "../domain/ingest";

interface BriefingProps {
  cards: KnowledgeCard[];
  onOpenCard: (cardId: string) => void;
}

export function BriefingView({ cards, onOpenCard }: BriefingProps) {
  const [briefing, setBriefing] = useState<CognitiveBriefing>(() =>
    generateCognitiveBriefing(cards)
  );
  const [copied, setCopied] = useState(false);

  const handleRegenerate = () => {
    setBriefing(generateCognitiveBriefing(cards));
  };

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(briefing.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("复制失败", err);
    }
  };

  return (
    <section className="detail">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>认知洞察简报 · {briefing.weekLabel}</h1>
        <div style={{ display: "flex", gap: "8px" }}>
          <button type="button" onClick={handleRegenerate}>重新生成</button>
          <button type="button" className="primary" onClick={() => void handleCopyMarkdown()}>
            {copied ? "已复制 Markdown" : "复制报告 Markdown"}
          </button>
        </div>
      </div>

      <p className="hint">
        根据三层资产模型自动提炼：聚类近期新增素材、洞察关注趋势、根据时间衰减挑选待温故的高价值旧内容。
      </p>

      {briefing.sections.map((sec, idx) => (
        <div key={idx} style={{ marginTop: "24px" }}>
          <h2 style={{ fontSize: "16px", borderBottom: "1px solid var(--line)", paddingBottom: "6px" }}>
            {sec.title}
          </h2>
          <ul style={{ listStyle: "none", padding: 0, marginTop: "8px" }}>
            {sec.items.map((it, itemIdx) => (
              <li
                key={itemIdx}
                style={{
                  padding: "8px 0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderBottom: "1px dashed var(--line)",
                }}
              >
                <div>
                  <strong>{it.title}</strong>
                  {it.subtitle ? (
                    <p style={{ margin: "2px 0 0", fontSize: "13px", color: "var(--muted)" }}>
                      {it.subtitle}
                    </p>
                  ) : null}
                </div>
                {it.id ? (
                  <button
                    type="button"
                    style={{ fontSize: "12px", padding: "2px 8px" }}
                    onClick={() => onOpenCard(it.id!)}
                  >
                    查看卡片
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

interface BrainDrawerProps {
  cards: KnowledgeCard[];
  settings: AiSettings;
  apiKey: string;
  onOpenCard: (cardId: string) => void;
}

export function BrainAssistantDrawer({ cards, settings, apiKey, onOpenCard }: BrainDrawerProps) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [citedCards, setCitedCards] = useState<KnowledgeCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleAsk = async () => {
    const q = question.trim();
    if (!q || loading) return;

    if (requiresKey(settings.baseURL) && !apiKey) {
      setError("请先在设置中配置大模型 API 密钥。");
      return;
    }

    setLoading(true);
    setError("");
    setAnswer("");

    // 1. 本地多信号检索相关卡片作为上下文 (RAG 粗筛)
    const matched = searchCards(q, cards).slice(0, 4).map((r) => r.card);
    setCitedCards(matched);

    if (matched.length === 0) {
      setAnswer("知识库中没有找到相关内容。请缩短关键词，或先收集相关素材；本次没有向模型发送请求。");
      setLoading(false);
      return;
    }

    // 2. 组装 Prompt
    const contextText = matched
      .map(
        (c, idx) =>
          `[卡片 ${idx + 1}] 标题: ${c.headline}\n分类: ${c.category}\n内容: ${c.details}\n`
      )
      .join("\n---\n");

    const systemPrompt = `你是一个个人知识库第二大脑问答助理。你的职责是根据用户提供的知识库参考资料回答问题。
要求：
1. 优先使用参考资料中的事实进行回答。
2. 回答中如引用了某张卡片，请明确指出【卡片 1】、【卡片 2】等来源。
3. 语言精炼、重点突出。`;

    const userPrompt = `【知识库参考卡片】:\n${contextText || "暂无相关卡片"}\n\n【用户问题】: ${q}`;

    const endpoint = completionURL(settings.baseURL);

    const body = JSON.stringify({
      model: settings.model || "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.5,
    });

    try {
      const resp = await completeChat(endpoint, apiKey, body);
      if (!resp.trim()) throw new Error("模型未返回有效内容，请检查连接后重试");
      setAnswer(resp);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="detail">
      <h1>第二大脑智能问答</h1>
      <p className="hint">
        按关键词检索知识卡后交给模型回答，可点击引用回到原文。当前尚未接入语义检索，模型回答仍需核对来源。
      </p>

      <div style={{ display: "flex", gap: "8px", margin: "16px 0" }}>
        <input
          style={{ flex: 1, padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--line)" }}
          placeholder="问问你的第二大脑，例如：SQLite-vec 在小规模下的性能如何？"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleAsk();
          }}
        />
        <button
          type="button"
          className="primary"
          disabled={!question.trim() || loading}
          onClick={() => void handleAsk()}
        >
          {loading ? "检索思考中..." : "向大脑提问"}
        </button>
      </div>

      {error ? <p className="banner error">{error}</p> : null}

      {citedCards.length > 0 ? (
        <div style={{ marginBottom: "16px", padding: "12px", background: "var(--side)", borderRadius: "8px" }}>
          <strong style={{ fontSize: "13px", color: "var(--muted)" }}>检索命中的上下文卡片：</strong>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "6px" }}>
            {citedCards.map((c, i) => (
              <button
                key={c.id}
                type="button"
                style={{ fontSize: "12px", padding: "3px 8px" }}
                onClick={() => onOpenCard(c.id)}
              >
                [{i + 1}] {c.headline}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {answer ? (
        <div style={{ marginTop: "16px", lineHeight: "1.6", whiteSpace: "pre-wrap" }}>
          <h3>回答：</h3>
          <p>{answer}</p>
        </div>
      ) : null}
    </section>
  );
}
