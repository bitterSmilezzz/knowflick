import type { KnowledgeCard } from "./card";
import type { RawMaterial } from "../shell/store";

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
  error?: { code: number; message: string; data?: unknown };
}

/**
 * 未接入生产宿主的嵌入式协议处理器。
 *
 * 旧版接受整库数组和写回调，没有可以逐请求验证的授权边界。
 * 在接入受限数据访问层之前，除握手外一律拒绝，不能借回调绕过授权。
 * 实际外部 stdio 服务由 tools/mcp-server.mjs 提供。
 */
export async function handleMcpRequest(
  request: McpRpcRequest,
  context: {
    cards: KnowledgeCard[];
    materials: RawMaterial[];
    onAddCard?: (card: KnowledgeCard) => Promise<void> | void;
    onAddMaterial?: (material: RawMaterial) => Promise<void> | void;
    enabled?: boolean;
    store?: { materials: RawMaterial[]; cards: KnowledgeCard[]; settings: unknown | null };
  },
): Promise<McpRpcResponse> {
  const { method, id = null } = request;
  if (method === "initialize") {
    return {
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "knowflick-second-brain", version: "0.1.0" },
        capabilities: {},
      },
    };
  }
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  return {
    jsonrpc: "2.0", id,
    error: {
      code: -32000,
      message: context.enabled === false
        ? "KnowFlick MCP 模块已停用。"
        : "嵌入式 MCP 尚未接入项目授权，无法访问数据；请使用桌面设置中的外部接入。",
    },
  };
}

/** MCP 客户端配置；调用方需传已安装脚本的绝对路径与当前库目录。 */
export function generateMcpConfigSnippet(serverScriptPath: string, libraryDir?: string): string {
  const args = libraryDir ? [serverScriptPath, "--dir", libraryDir] : [serverScriptPath];
  return JSON.stringify({ mcpServers: { knowflick: { command: "node", args } } }, null, 2);
}
