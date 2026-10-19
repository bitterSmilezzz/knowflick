import { useState } from "react";
import type { KnowledgeCard } from "../domain/card";
import { generateCognitiveBriefing, type CognitiveBriefing } from "../domain/briefing";
import { searchCards } from "../domain/search";
import { completeChat, inShell } from "../shell/store";
import type { AiSettings } from "../domain/settings";
import { completionURL, requiresKey } from "../domain/ingest";
import { Icon } from "./workspace/Icon";

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

  const categories = new Set(cards.map((c) => c.category).filter(Boolean));

  return (
    <div className="ws-reader-scroll">
      <div className="ws-reader-inner" style={{ maxWidth: 760 }}>
        <header className="ws-briefing-head">
          <div>
            <span className="ws-briefing-tag">每周认知复盘</span>
            <h1>认知洞察简报 · {briefing.weekLabel}</h1>
            <p className="ws-hint">
              基于三层知识模型自动生成：聚类近期新增、洞察长期趋势、挑选高价值待温故卡片。
            </p>
          </div>
          <div className="ws-editor-actions" style={{ flexWrap: "nowrap" }}>
            <button type="button" className="ws-bordered" onClick={handleRegenerate}>
              <Icon name="brief" size={14} /> 重新分析
            </button>
            <button type="button" className="ws-primary" onClick={() => void handleCopyMarkdown()}>
              <Icon name="check" size={14} /> {copied ? "已复制" : "复制 Markdown"}
            </button>
          </div>
        </header>

        {/* KPI Metrics */}
        <div className="ws-briefing-kpi-row">
          <div className="ws-briefing-kpi-card">
            <span className="kpi-label">已沉淀知识卡</span>
            <strong className="kpi-value">{cards.length}</strong>
            <span className="kpi-sub">当前知识库总卡片</span>
          </div>
          <div className="ws-briefing-kpi-card">
            <span className="kpi-label">近期新增卡片</span>
            <strong className="kpi-value">{briefing.newCapturedCount}</strong>
            <span className="kpi-sub">过去 7 天沉淀记录</span>
          </div>
          <div className="ws-briefing-kpi-card">
            <span className="kpi-label">覆盖分类数</span>
            <strong className="kpi-value">{categories.size}</strong>
            <span className="kpi-sub">活跃知识领域</span>
          </div>
        </div>

        {/* 3 Sections */}
        <div className="ws-briefing-sections">
          {briefing.sections.map((sec, idx) => (
            <section key={idx} className="ws-briefing-card">
              <div className="ws-briefing-card-header">
                <h2>{sec.title}</h2>
              </div>
              <div className="ws-briefing-card-body">
                {sec.items.map((it, itemIdx) => (
                  <div key={itemIdx} className="ws-briefing-item">
                    <div className="ws-briefing-item-info">
                      <strong>{it.title}</strong>
                      {it.subtitle ? <p>{it.subtitle}</p> : null}
                    </div>
                    {it.id ? (
                      <button
                        type="button"
                        className="ws-bordered"
                        style={{ height: 26, fontSize: 12, padding: "0 8px" }}
                        onClick={() => onOpenCard(it.id!)}
                      >
                        查看卡片
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

interface BrainDrawerProps {
  cards: KnowledgeCard[];
  settings: AiSettings;
  apiKey: string;
  onOpenCard: (cardId: string) => void;
  onNavigateSettings?: () => void;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  cited?: KnowledgeCard[];
}

export function BrainAssistantDrawer({
  cards,
  settings,
  apiKey,
  onOpenCard,
  onNavigateSettings,
}: BrainDrawerProps) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "你好！我是你的知识库助手。我会基于你收集的卡片检索事实，回答你的提问并指出引用来源。",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const needsKey = requiresKey(settings.baseURL) && !apiKey.trim();

  const handleAsk = async (textToAsk?: string) => {
    const q = (textToAsk || question).trim();
    if (!q || loading) return;

    if (needsKey && inShell()) {
      setError("请先在设置中配置大模型 API 密钥。");
      return;
    }

    setLoading(true);
    setError("");
    const newMessages: Message[] = [...messages, { role: "user", content: q }];
    setMessages(newMessages);
    setQuestion("");

    // 1. 本地多信号检索相关卡片作为上下文 (RAG 粗筛)
    const matched = searchCards(q, cards).slice(0, 4).map((r) => r.card);

    if (matched.length === 0) {
      setMessages([
        ...newMessages,
        {
          role: "assistant",
          content:
            "知识库中没有检索到与此相关的卡片。请尝试更通用的关键词，或先通过剪藏/导入补充该领域的知识素材。",
        },
      ]);
      setLoading(false);
      return;
    }

    if (!inShell()) {
      // 浏览器环境演示模式：提示并展示检索到的卡片
      setMessages([
        ...newMessages,
        {
          role: "assistant",
          content: `检索到 ${matched.length} 张相关知识卡（在桌面客户端连接大模型可获得智能合成回答）：\n\n${matched
            .map((c, i) => `【卡片 ${i + 1}】${c.headline}\n${c.details.slice(0, 100)}...`)
            .join("\n\n")}`,
          cited: matched,
        },
      ]);
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
      setMessages([
        ...newMessages,
        {
          role: "assistant",
          content: resp,
          cited: matched,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const sampleQuestions = [
    "总结我的主要知识领域",
    "梳理最近沉淀的核心笔记",
    "有哪些关于架构或性能的记录？",
  ];

  return (
    <div className="ws-brain-container">
      <div className="ws-brain-wrapper">
        <header className="ws-brain-header">
          <div>
            <h1>知识问答助手</h1>
            <p className="ws-hint">
              以本地知识库卡片为依据，结合大模型推理回答。检索命中的卡片可直接定位回溯。
            </p>
          </div>
        </header>

        {needsKey ? (
          <div className="ws-brain-key-prompt">
            <Icon name="settings" size={16} />
            <div style={{ flex: 1 }}>
              <strong>尚未配置 API 密钥</strong>
              <p>配置服务商 API Key 后即可开启由模型驱动的智能问答。</p>
            </div>
            {onNavigateSettings ? (
              <button
                type="button"
                className="ws-primary"
                style={{ height: 28, fontSize: 12 }}
                onClick={onNavigateSettings}
              >
                前往设置
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="ws-brain-chat-history">
          {messages.map((m, idx) => (
            <div key={idx} className={`ws-chat-row ${m.role}`}>
              <div className="ws-chat-avatar">
                {m.role === "user" ? "我" : <Icon name="ask" size={14} />}
              </div>
              <div className="ws-chat-content">
                <div className="ws-chat-bubble">{m.content}</div>
                {m.cited && m.cited.length > 0 ? (
                  <div className="ws-chat-citations">
                    <span className="ws-cite-title">参考卡片：</span>
                    {m.cited.map((c, i) => (
                      <button
                        key={c.id}
                        type="button"
                        className="ws-cite-chip"
                        onClick={() => onOpenCard(c.id)}
                      >
                        [{i + 1}] {c.headline}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}

          {loading ? (
            <div className="ws-chat-row assistant">
              <div className="ws-chat-avatar">
                <Icon name="ask" size={14} />
              </div>
              <div className="ws-chat-content">
                <div className="ws-chat-bubble ws-chat-loading">
                  <span>正在检索知识卡并思考中…</span>
                </div>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="ws-feedback" role="alert" style={{ margin: "12px 0" }}>
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        {/* Quick prompt suggestions */}
        {messages.length <= 2 ? (
          <div className="ws-brain-suggestions">
            <span className="ws-hint" style={{ fontSize: 12 }}>推荐提问：</span>
            {sampleQuestions.map((sq) => (
              <button
                key={sq}
                type="button"
                className="ws-suggestion-chip"
                onClick={() => void handleAsk(sq)}
              >
                {sq}
              </button>
            ))}
          </div>
        ) : null}

        <div className="ws-brain-input-box">
          <input
            type="text"
            className="ws-brain-input"
            placeholder="问问你的第二大脑，例如：我记录过哪些关于 SQLite 索引的要点？"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAsk();
            }}
            disabled={loading}
          />
          <button
            type="button"
            className="ws-primary ws-brain-send-btn"
            disabled={!question.trim() || loading}
            onClick={() => void handleAsk()}
          >
            提问 <kbd>↵</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
