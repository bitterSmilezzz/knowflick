import type { KnowledgeCard } from "./card";
import { cardFromJson } from "./card";
import type { RawMaterial } from "../shell/store";
import { generateCognitiveBriefing } from "./briefing";
import { searchCards } from "./search";
import { reciprocalRankFusion } from "./hybridSearch";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string; items?: { type: string } }>;
    required?: string[];
  };
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "search_knowledge",
    description: "在 KnowFlick 第二大脑中进行关键词与语义混合检索，返回最匹配的知识卡与素材片段",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索关键词或语义概念" },
        limit: { type: "number", description: "返回结果数量上限，默认 5" },
      },
      required: ["query"],
    },
  },
  {
    name: "create_flash_card",
    description: "在 KnowFlick 知识库中创建一张新的原子知识卡片",
    inputSchema: {
      type: "object",
      properties: {
        headline: { type: "string", description: "卡片核心观点与标题（精炼，≤100字）" },
        summary: { type: "string", description: "卡片核心结论与要点摘要（≤300字）" },
        details: { type: "string", description: "卡片详细正文（Markdown 格式）" },
        category: { type: "string", description: "学科分类（如：计算机、物理、哲学等）" },
        tags: { type: "array", items: { type: "string" }, description: "标签列表" },
      },
      required: ["headline", "summary", "details"],
    },
  },
  {
    name: "add_material",
    description: "向 KnowFlick 收集箱（Inbox）追加一份原始素材（文章、文档、备忘）",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "素材标题或来源说明" },
        text: { type: "string", description: "素材纯文本或 Markdown 全文" },
        source_url: { type: "string", description: "原始网页链接（如有）" },
      },
      required: ["title", "text"],
    },
  },
  {
    name: "search_materials",
    description:
      "在 KnowFlick 的**素材**里检索（邮件 / 网页剪藏 / 导入文档 / 语音与手写笔记）。" +
      "素材是还没变成知识卡之前的内容——搜不到知识卡时用它。结果带 resourceUri，可按它读全文。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索关键词" },
        limit: { type: "number", description: "返回结果数量上限，默认 5" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_weekly_briefing",
    description: "生成基于当前知识库的周度认知简报（包含新收知识聚类、演变趋势与温故推荐）",
    inputSchema: {
      type: "object",
      properties: {
        week_offset: { type: "number", description: "周偏移量，0 表示本周，-1 表示上周" },
      },
    },
  },
  {
    name: "get_knowledge_stats",
    description: "查询 KnowFlick 知识库当前资产总量、分类分布与待复习卡片统计",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

/**
 * 截一段**命中处附近**的文字。
 *
 * 为什么不在开头截：一封长邮件的关键词在第 800 字处，开头 600 字跟问题
 * 毫无关系——Agent 看到的是一段不相干的引文，于是判断「这条不相关」，
 * 而它其实正是答案。
 */
function excerptAround(text: string, query: string, radius = 220): string {
  const raw = text ?? "";
  const trimmed = (query ?? "").trim();
  const head = raw.length > radius * 2 ? `${raw.slice(0, radius * 2)}…` : raw;
  if (!trimmed) return head;
  const lower = raw.toLocaleLowerCase();
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  let at = -1;
  for (const token of tokens) {
    const found = lower.indexOf(token.toLocaleLowerCase());
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }
  if (at < 0) return head;
  const start = Math.max(0, at - radius);
  const end = Math.min(raw.length, at + radius);
  return `${start > 0 ? "…" : ""}${raw.slice(start, end)}${end < raw.length ? "…" : ""}`;
}

export interface McpRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpRpcResponse {
  jsonrpc: "2.0";
  id?: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * 处理标准 MCP JSON-RPC 协议请求
 *
 * T09/KF-012：context.enabled 控制模块开关——停用时返回明确错误，
 * 不静默消失（外部 Agent 猜「工具坏了」比「被拒绝」更糟）。
 */
export async function handleMcpRequest(
  request: McpRpcRequest,
  context: {
    cards: KnowledgeCard[];
    materials: RawMaterial[];
    onAddCard?: (card: KnowledgeCard) => Promise<void> | void;
    onAddMaterial?: (material: RawMaterial) => Promise<void> | void;
    /** T09：嵌入式 MCP 的模块开关——来自 pluginSettings(official-mcp-server)。 */
    enabled?: boolean;
    /** 读传统单文件仓储 */
    store?: { materials: RawMaterial[]; cards: KnowledgeCard[]; settings: unknown | null };
  }
): Promise<McpRpcResponse> {
  const { method, params, id = null } = request;

  // 模块开关（T09）：停用时阻断请求，initialize 和 ping 不受影响
  if (context.enabled === false && method !== "initialize" && method !== "ping") {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32000,
        message: "KnowFlick MCP 服务已被停用（设置中关闭了 official-mcp-server 模块），嵌入式连接已被阻断。",
      },
    };
  }

  switch (method) {
    case "initialize": {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: {
            name: "knowflick-second-brain",
            version: "0.1.0",
          },
          capabilities: {
            tools: {},
            resources: {},
          },
        },
      };
    }

    case "tools/list": {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: MCP_TOOLS,
        },
      };
    }

    case "tools/call": {
      const toolName = (params?.name as string) || "";
      const args = (params?.arguments as Record<string, unknown>) || {};

      switch (toolName) {
        case "search_knowledge": {
          const q = String(args.query || "").trim();
          const limit = typeof args.limit === "number" ? Math.max(1, args.limit) : 5;

          const lexical = searchCards(q, context.cards).map((r) => r.card);
          const tokenList = context.cards.filter((c) => {
            const text = `${c.category} ${(c.tags || []).join(" ")}`.toLowerCase();
            return q.toLowerCase().split(/\s+/).some((t) => t && text.includes(t));
          });

          const ranked = reciprocalRankFusion([lexical, tokenList], (c) => c.id, 60);
          const topCards = ranked.slice(0, limit).map((r) => r.item);

          const cardSummaries = topCards.map((c, i) => ({
            index: i + 1,
            id: c.id,
            headline: c.headline,
            category: c.category,
            summary: c.summary,
            details: c.details,
            tags: c.tags,
            source: c.source,
          }));

          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      query: q,
                      totalFound: topCards.length,
                      cards: cardSummaries,
                    },
                    null,
                    2
                  ),
                },
              ],
            },
          };
        }

        case "create_flash_card": {
          const headline = String(args.headline || "").trim();
          const summary = String(args.summary || "").trim();
          const details = String(args.details || "").trim();
          const category = String(args.category || "未分类").trim();
          const tags = Array.isArray(args.tags) ? (args.tags as string[]) : [];

          if (!headline || !details) {
            return {
              jsonrpc: "2.0",
              id,
              error: { code: -32602, message: "headline and details are required" },
            };
          }

          const newCard = cardFromJson({
            id: crypto.randomUUID(),
            headline,
            summary: summary || headline,
            details,
            category: category || "未分类",
            tags,
            source: "ai",
            createdAt: Date.now(),
          });

          await context.onAddCard?.(newCard);

          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: `知识卡片创建成功！ID: ${newCard.id}\n标题: ${newCard.headline}\n分类: ${newCard.category}`,
                },
              ],
            },
          };
        }

        case "add_material": {
          const title = String(args.title || "").trim();
          const text = String(args.text || "").trim();
          const sourceUrl = args.source_url ? String(args.source_url).trim() : null;

          if (!title || !text) {
            return {
              jsonrpc: "2.0",
              id,
              error: { code: -32602, message: "title and text are required" },
            };
          }

          const now = Date.now();
          const material: RawMaterial = {
            id: crypto.randomUUID(),
            // 「无链接的素材」用 "manual"——与应用内其它入口（闪念、手动保存）
            // 写的是同一个类型。以前这里写 "note"，界面上就显示成英文的 "note"，
            // 而用户在应用里手动记的闪念显示的是「随手灵感」——同一件事两种说法。
            sourceType: sourceUrl ? "web" : "manual",
            title,
            sourceUrl,
            rawText: text,
            contentHash: "",
            metadataJson: "{}",
            inboxStatus: "inbox",
            createdAt: now,
            updatedAt: now,
          };

          await context.onAddMaterial?.(material);

          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: `素材已成功加入 KnowFlick 收件箱！ID: ${material.id}\n标题: ${material.title}`,
                },
              ],
            },
          };
        }

        case "search_materials": {
          const q = String(args.query || "").trim();
          const limit = typeof args.limit === "number" ? Math.max(1, args.limit) : 5;
          const tokens = q.toLocaleLowerCase().split(/\s+/).filter(Boolean);

          // 多词按「每个词都要出现」判定——与 stdio 服务端、SQLite FTS 的 AND 语义一致。
          const matched = tokens.length
            ? context.materials.filter((m) => {
                const haystack = `${m.title}\n${m.rawText}\n${m.sourceUrl ?? ""}`.toLocaleLowerCase();
                return tokens.every((t) => haystack.includes(t));
              })
            : context.materials;

          const materials = matched.slice(0, limit).map((m) => ({
            id: m.id,
            title: m.title,
            sourceType: m.sourceType,
            sourceUrl: m.sourceUrl ?? null,
            inboxStatus: m.inboxStatus,
            /** 命中处附近的片段——开头截断会让「命中在长邮件末尾」看起来毫不相关。 */
            excerpt: excerptAround(m.rawText, q),
            textLength: m.rawText.length,
            createdAt: m.createdAt,
            /** 按这个地址可以读到这条素材的全文。 */
            resourceUri: `knowflick://materials/${m.id}`,
          }));

          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      query: q,
                      totalFound: materials.length,
                      materials,
                      readHint: "按 materials[].resourceUri 调用 resources/read 读原文",
                    },
                    null,
                    2
                  ),
                },
              ],
            },
          };
        }

        case "get_weekly_briefing": {
          const briefing = generateCognitiveBriefing(context.cards);
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: briefing.markdown,
                },
              ],
            },
          };
        }

        case "get_knowledge_stats": {
          const categoriesCount: Record<string, number> = {};
          let favoriteCount = 0;
          for (const c of context.cards) {
            const cat = c.category || "未分类";
            categoriesCount[cat] = (categoriesCount[cat] || 0) + 1;
            if (c.isFavorite) favoriteCount++;
          }

          const inboxMaterials = context.materials.filter((m) => m.inboxStatus === "inbox").length;

          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      totalCards: context.cards.length,
                      favoriteCards: favoriteCount,
                      totalMaterials: context.materials.length,
                      inboxMaterials,
                      categoriesDistribution: categoriesCount,
                    },
                    null,
                    2
                  ),
                },
              ],
            },
          };
        }

        default:
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Tool not found: ${toolName}` },
          };
      }
    }

    case "resources/list": {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          resources: [
            {
              uri: "knowflick://cards",
              name: "所有知识卡片集合",
              mimeType: "application/json",
            },
            {
              uri: "knowflick://materials",
              name: "收件箱与原始素材集合",
              mimeType: "application/json",
            },
            {
              uri: "knowflick://materials/{id}",
              name: "单条素材（含全文与出处）",
              description: "把 {id} 换成素材 id，即可读到那条素材的正文与来源信息。",
              mimeType: "application/json",
            },
          ],
        },
      };
    }

    case "resources/read": {
      const uri = String(params?.uri ?? "");
      // 单条素材：命中之后要能读到原文与出处。
      // 规范里本来就要求 `knowflick://materials/{id}`（PLUGIN_SPECIFICATION §6）。
      const materialMatch = /^knowflick:\/\/materials\/(.+)$/.exec(uri);
      if (materialMatch) {
        const material = context.materials.find((m) => m.id === materialMatch[1]);
        if (!material) {
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: `找不到素材: ${materialMatch[1]}` },
          };
        }
        let provenance: unknown = {};
        try {
          provenance = JSON.parse(material.metadataJson || "{}");
        } catch {
          provenance = {};
        }
        return {
          jsonrpc: "2.0",
          id,
          result: {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(
                  {
                    id: material.id,
                    title: material.title,
                    sourceType: material.sourceType,
                    sourceUrl: material.sourceUrl ?? null,
                    inboxStatus: material.inboxStatus,
                    createdAt: material.createdAt,
                    provenance,
                    text: material.rawText,
                    resourceUri: `knowflick://materials/${material.id}`,
                  },
                  null,
                  2
                ),
              },
            ],
          },
        };
      }
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: `未知资源: ${uri}` },
      };
    }

    default:
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not supported: ${method}` },
      };
  }
}

/**
 * 生成可在 Claude Desktop / Cursor / DeepSeek Harness 中直接配置的 JSON 代码片段。
 *
 * T10（KF-013）：配置必须指向**存在的绝对入口**并显式带上库目录——
 * 外部客户端的工作目录不保证是仓库，仓内相对路径在安装用户机器上必然
 * 「module not found」。库目录用 `--dir` 传过去，避免两个进程各读各的库。
 */
export function generateMcpConfigSnippet(serverScriptPath: string, libraryDir?: string): string {
  const args = libraryDir ? [serverScriptPath, "--dir", libraryDir] : [serverScriptPath];
  return JSON.stringify(
    {
      mcpServers: {
        knowflick: {
          command: "node",
          args,
        },
      },
    },
    null,
    2
  );
}
