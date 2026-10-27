import { describe, expect, it, vi } from "vitest";
import { handleMcpRequest, generateMcpConfigSnippet } from "./mcpServer";
import { cardFromJson } from "./card";
import type { RawMaterial } from "../shell/store";

const cards = [cardFromJson({ id: "private-card", headline: "私人卡片", details: "不应泄露", createdAt: 1 })];
const materials: RawMaterial[] = [{
  id: "private-material", sourceType: "manual", title: "私人素材", rawText: "不应泄露的原文",
  sourceUrl: null, contentHash: "", metadataJson: "{}", inboxStatus: "inbox", createdAt: 1, updatedAt: 1,
}];

describe("未接入授权的嵌入式 MCP", () => {
  it("只允许不含用户数据的握手和 ping", async () => {
    const context = { cards, materials };
    const handshake = await handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }, context);
    expect(handshake.error).toBeUndefined();
    expect(JSON.stringify(handshake)).not.toContain("私人");
    expect((await handleMcpRequest({ jsonrpc: "2.0", id: 2, method: "ping" }, context)).result).toEqual({});
  });

  it.each([
    ["tools/list", {}],
    ["tools/call", { name: "search_knowledge", arguments: { query: "私人" } }],
    ["tools/call", { name: "search_materials", arguments: { query: "私人" } }],
    ["tools/call", { name: "get_knowledge_stats" }],
    ["tools/call", { name: "get_weekly_briefing" }],
    ["resources/list", {}],
    ["resources/read", { uri: "knowflick://materials/private-material" }],
  ])("%s 拒绝旧的全库读取入口", async (method, params) => {
    const result = await handleMcpRequest({ jsonrpc: "2.0", id: 3, method, params }, { cards, materials, enabled: true });
    expect(result.error?.code).toBe(-32000);
    expect(JSON.stringify(result)).not.toContain("不应泄露");
  });

  it.each(["create_flash_card", "add_material"])("即使宿主提供回调，%s 也不能绕过授权", async (name) => {
    const onAddCard = vi.fn();
    const onAddMaterial = vi.fn();
    const result = await handleMcpRequest(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name, arguments: { title: "t", text: "x", headline: "h", details: "d" } } },
      { cards, materials, onAddCard, onAddMaterial },
    );
    expect(result.error?.code).toBe(-32000);
    expect(onAddCard).not.toHaveBeenCalled();
    expect(onAddMaterial).not.toHaveBeenCalled();
  });

  it("模块停用时提供明确提示", async () => {
    const result = await handleMcpRequest({ jsonrpc: "2.0", id: 5, method: "tools/list" }, { cards, materials, enabled: false });
    expect(result.error?.message).toContain("停用");
  });

  it("配置保留已安装的绝对脚本路径和库目录", () => {
    const parsed = JSON.parse(generateMcpConfigSnippet("/installed/mcp-server.mjs", "/library"));
    expect(parsed.mcpServers.knowflick.args).toEqual(["/installed/mcp-server.mjs", "--dir", "/library"]);
  });
});
