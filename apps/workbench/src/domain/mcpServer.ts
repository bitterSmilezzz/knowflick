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
 */
export async function handleMcpRequest(
  request: McpRpcRequest,
  context: {
    cards: KnowledgeCard[];
    materials: RawMaterial[];
    onAddCard?: (card: KnowledgeCard) => Promise<void> | void;
    onAddMaterial?: (material: RawMaterial) => Promise<void> | void;
  }
): Promise<McpRpcResponse> {
  const { method, params, id = null } = request;

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
            sourceType: sourceUrl ? "web" : "note",
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
          ],
        },
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

/** 生成可在 Claude Desktop / Cursor / DeepSeek Harness 中直接配置的 JSON 代码片段 */
export function generateMcpConfigSnippet(serverScriptPath: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        knowflick: {
          command: "node",
          args: [serverScriptPath],
        },
      },
    },
    null,
    2
  );
}
