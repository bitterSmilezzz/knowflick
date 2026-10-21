import { useState, useEffect } from "react";
import type { KnowledgeCard } from "../domain/card";
import { generateCognitiveBriefing, type CognitiveBriefing } from "../domain/briefing";
import { searchCards } from "../domain/search";
import { reciprocalRankFusion } from "../domain/hybridSearch";
import { completeChat, inShell, dbSaveArtifact, dbListArtifacts, dbSearchCardsHybrid, type Artifact } from "../shell/store";
import { EmbeddingEngine } from "../domain/embeddingEngine";
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
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [savingArtifact, setSavingArtifact] = useState(false);
  const [saveNotice, setSaveNotice] = useState("");

  useEffect(() => {
    let active = true;
    const loadArtifacts = async () => {
      try {
        if (inShell()) {
          const list = await dbListArtifacts(20);
          if (active) setArtifacts(list);
        } else {
          const raw = localStorage.getItem("knowflick.workspace.artifacts");
          if (raw && active) setArtifacts(JSON.parse(raw));
        }
      } catch (err) {
        console.error("读取产物库失败", err);
      }
    };
    void loadArtifacts();
    return () => {
      active = false;
    };
  }, []);

  // 重新分析是纯本地重算（不依赖模型），但卡片没变时结果一样——
  // 没有反馈的话，按钮看起来就是「点了没反应」。
  const [regenerated, setRegenerated] = useState(false);
  const handleRegenerate = () => {
    setBriefing(generateCognitiveBriefing(cards));
    setRegenerated(true);
    window.setTimeout(() => setRegenerated(false), 2400);
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

  const handleSaveArtifact = async () => {
    if (savingArtifact) return;
    setSavingArtifact(true);
    try {
      const now = Date.now();
      const artifact: Artifact = {
        id: crypto.randomUUID(),
        artifactType: "briefing",
        title: `认知简报 · ${briefing.weekLabel}`,
        contentMarkdown: briefing.markdown,
        sourceCardIds: cards.slice(0, 10).map((c) => c.id),
        dateScopeStart: now - 7 * 86400 * 1000,
        dateScopeEnd: now,
        createdAt: now,
        updatedAt: now,
      };

      if (inShell()) {
        await dbSaveArtifact(artifact);
      } else {
        const next = [artifact, ...artifacts.filter((a) => a.id !== artifact.id)];
        localStorage.setItem("knowflick.workspace.artifacts", JSON.stringify(next));
      }
      setArtifacts((prev) => [artifact, ...prev.filter((a) => a.id !== artifact.id)]);
      setSaveNotice("已存入认知产物库");
      setTimeout(() => setSaveNotice(""), 3000);
    } catch (err) {
      console.error("保存产物失败", err);
    } finally {
      setSavingArtifact(false);
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
              <Icon name="brief" size={14} /> {regenerated ? "已按当前卡片重算" : "重新分析"}
            </button>
            <button
              type="button"
              className="ws-bordered"
              disabled={savingArtifact}
              onClick={() => void handleSaveArtifact()}
            >
              <Icon name="archive" size={14} /> {saveNotice || (savingArtifact ? "保存中…" : "存入产物库")}
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
  /** 引用：只留卡片 id 与当时的标题。整张卡存进来会在卡片被删后指向不存在的条目。 */
  cited?: Array<{ id: string; headline: string }>;
}

const CHAT_STORE_KEY = "knowflick.workspace.chat";
/** 只留最近这些轮次：问答是即时应用，不需要把整部历史堆在浏览器存储里。 */
const CHAT_STORE_LIMIT = 40;

const greetingMessage: Message = {
  role: "assistant",
  content: "你好！我是你的知识库助手。我会基于你收集的卡片检索事实，回答你的提问并指出引用来源。",
};

/**
 * 读回上一次的对话。
 *
 * 之前 messages 只是内存状态：问几句、切到别的页面再回来，整段对话就没了。
 * 内容是纯文本 + 引用卡片 id，放在本地存储即可，不涉及隐私外发。
 */
function loadChat(): Message[] {
  try {
    const raw = localStorage.getItem(CHAT_STORE_KEY);
    if (!raw) return [greetingMessage];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [greetingMessage];
    const messages = parsed.flatMap((item): Message[] => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const role = row.role === "user" || row.role === "assistant" ? row.role : null;
      if (!role || typeof row.content !== "string" || !row.content.trim()) return [];
      const cited = Array.isArray(row.cited)
        ? row.cited.flatMap((item): Array<{ id: string; headline: string }> => {
          if (!item || typeof item !== "object") return [];
          const cite = item as Record<string, unknown>;
          if (typeof cite.id !== "string" || !cite.id) return [];
          return [{ id: cite.id, headline: typeof cite.headline === "string" ? cite.headline : "未命名卡片" }];
        })
        : undefined;
      // 旧版本存的是整张卡片对象；按 id/headline 取出来即可，
      // 不能因为格式升级就让用户看不到历史引用。
      return [{ role, content: row.content, cited }];
    });
    return messages.length ? messages : [greetingMessage];
  } catch {
    return [greetingMessage];
  }
}

function saveChat(messages: Message[]): void {
  try {
    localStorage.setItem(CHAT_STORE_KEY, JSON.stringify(messages.slice(-CHAT_STORE_LIMIT)));
  } catch {
    // 存储满了就放弃持久化：对话仍在内存里，不该因此打断问答。
  }
}

export function BrainAssistantDrawer({
  cards,
  settings,
  apiKey,
  onOpenCard,
  onNavigateSettings,
}: BrainDrawerProps) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>(loadChat);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // 每次对话变化就落盘：切页、刷新、重启后都还能接着问。
  useEffect(() => { saveChat(messages); }, [messages]);
  // 用户已知「没配密钥」并选择继续时置真，避免每次提交都被拦。
  const [proceededWithoutKey, setProceededWithoutKey] = useState(false);

  let needsKey = false;
  try {
    needsKey = requiresKey(settings.baseURL) && !apiKey.trim();
  } catch {
    needsKey = !apiKey.trim();
  }

  const handleAsk = async (textToAsk?: string) => {
    const q = (textToAsk || question).trim();
    if (!q || loading) return;

    // 没配密钥时先拦一次并说明原因。原先只在桌面端拦截，浏览器模式下会
    // 直接发出一个注定失败的请求，界面要转到超时才报错——用户看到的就是
    // 「点了提问没反应」。这里两种模式都先提示；若服务端本来就不需要密钥，
    // 再点一次即可继续。
    if (needsKey && !proceededWithoutKey) {
      setProceededWithoutKey(true);
      setError("尚未配置大模型 API 密钥。若你的服务端不需要密钥，再点一次「提问」即可继续。");
      return;
    }

    setLoading(true);
    setError("");
    const newMessages: Message[] = [...messages, { role: "user", content: q }];
    setMessages(newMessages);
    setQuestion("");

    // 1. 本地多信号 RRF 混合检索相关卡片作为上下文 (Reciprocal Rank Fusion)
    let matched: KnowledgeCard[] = [];
    if (inShell()) {
      try {
        const engine = new EmbeddingEngine({
          providerId: settings.providerId,
          baseURL: settings.baseURL,
          apiKey,
        });
        const queryVec = await engine.embedText(q, true);
        const hybridHits = await dbSearchCardsHybrid(q, queryVec, 6);
        if (hybridHits.length > 0) {
          matched = hybridHits.slice(0, 4);
        }
      } catch (err) {
        console.warn("混合向量检索降级至规则检索:", err);
      }
    }

    if (matched.length === 0) {
      const lexicalList = searchCards(q, cards).map((r) => r.card);
      const tokenList = cards.filter((c) => {
        const text = `${c.category} ${(c.tags || []).join(" ")}`.toLowerCase();
        return q.toLowerCase().split(/\s+/).some((t) => t && text.includes(t));
      });
      const priorityList = cards.filter((c) => c.isFavorite || (c.reviewCount && c.reviewCount > 0));

      const ranked = reciprocalRankFusion([lexicalList, tokenList, priorityList], (c) => c.id, 60);
      matched = ranked.slice(0, 4).map((r) => r.item);
    }

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
          cited: matched.map((card) => ({ id: card.id, headline: card.headline })),
        },
      ]);
      setLoading(false);
      return;
    }

    try {
      const endpoint = completionURL(settings.baseURL);

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

      // 附带最近会话历史（最多保留最近 4 轮），支持连续追问
      const historyTurns = messages
        .slice(1)
        .slice(-4)
        .map((m) => ({
          role: m.role,
          content: m.content.slice(0, 1500),
        }));

      const body = JSON.stringify({
        model: settings.model || "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          ...historyTurns,
          { role: "user", content: userPrompt },
        ],
        temperature: 0.5,
      });

      const resp = await completeChat(endpoint, apiKey, body);
      if (!resp.trim()) throw new Error("模型未返回有效内容，请检查连接后重试");
      setMessages([
        ...newMessages,
        {
          role: "assistant",
          content: resp,
          cited: matched.map((card) => ({ id: card.id, headline: card.headline })),
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
                    {m.cited.map((c, i) => {
                      // 卡片可能已被删除。点击不存在的 id 会静默跳到别的卡片，
                      // 比报错更糟——所以这里标出来并禁用。
                      const alive = cards.find((card) => card.id === c.id);
                      if (!alive) {
                        return (
                          <span key={c.id} className="ws-cite-chip ws-cite-gone" aria-disabled="true">
                            [{i + 1}] {c.headline}（已删除）
                          </span>
                        );
                      }
                      return (
                        <button
                          key={c.id}
                          type="button"
                          className="ws-cite-chip"
                          onClick={() => onOpenCard(c.id)}
                        >
                          [{i + 1}] {alive.headline}
                        </button>
                      );
                    })}
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

        {/* 有对话就要能清空：持久化之后历史会一直留着 */}
        {messages.length > 1 ? (
          <div className="ws-brain-chat-actions">
            <span className="ws-hint" style={{ fontSize: 12 }}>
              对话会保存在本机，切页或重启后仍在
            </span>
            <button
              type="button"
              className="ws-bordered"
              aria-label="清空对话"
              disabled={loading}
              onClick={() => { setMessages([greetingMessage]); setError(""); }}
            >
              清空对话
            </button>
          </div>
        ) : null}

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
