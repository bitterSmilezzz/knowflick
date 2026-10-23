import { describe, expect, it, vi } from "vitest";
import { handleMcpRequest, MCP_TOOLS, generateMcpConfigSnippet } from "./mcpServer";
import { cardFromJson } from "./card";
import type { RawMaterial } from "../shell/store";

describe("MCP (Model Context Protocol) 外部代理协议服务", () => {
  const cards = [
    cardFromJson({
      id: "mcp-card-1",
      headline: "SQLite FTS5 中文全文检索",
      summary: "利用分词前置与前缀查询实现中文毫秒级检索",
      details: "SQLite 内建 FTS5 模块支持全文索引与 BM25 排序。",
      category: "计算机",
      tags: ["SQLite", "检索"],
      source: "imported",
      createdAt: 1700000000000,
      isFavorite: true,
    }),
    cardFromJson({
      id: "mcp-card-2",
      headline: "光合作用光反应阶段",
      summary: "叶绿体类囊体膜上的光能转化为 ATP 与 NADPH",
      details: "光反应产生氧气并生成同化力供暗反应使用。",
      category: "生物学",
      tags: ["生物"],
      source: "imported",
      createdAt: 1700000000001,
    }),
  ];

  const materials: RawMaterial[] = [
    {
      id: "mcp-mat-1",
      sourceType: "note",
      title: "待整理灵感",
      sourceUrl: null,
      rawText: "一个关于本地优先架构的灵感",
      contentHash: "",
      metadataJson: "{}",
      inboxStatus: "inbox",
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    },
  ];

  it("定义了 6 个标准 MCP 工具且包含规范的 JSON Schema", () => {
    expect(MCP_TOOLS.length).toBe(6);
    for (const tool of MCP_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.type).toBe("object");
    }
    const names = MCP_TOOLS.map((t) => t.name);
    expect(names).toContain("search_knowledge");
    expect(names).toContain("search_materials");
    expect(names).toContain("create_flash_card");
    expect(names).toContain("get_weekly_briefing");
  });

  it("处理 initialize 握手并返回协议版本与服务能力", async () => {
    const resp = await handleMcpRequest(
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      { cards, materials }
    );
    const result = resp.result as { protocolVersion: string; serverInfo: { name: string } };
    expect(result.protocolVersion).toBe("2024-11-05");
    expect(result.serverInfo.name).toBe("knowflick-second-brain");
    expect(resp.error).toBeUndefined();
  });

  it("tools/list 返回所有工具定义", async () => {
    const resp = await handleMcpRequest(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { cards, materials }
    );
    const result = resp.result as { tools: unknown[] };
    expect(result.tools.length).toBe(6);
  });

  it("search_materials 命中素材并给出可回读的地址", async () => {
    const resp = await handleMcpRequest(
      {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "search_materials", arguments: { query: "本地优先", limit: 5 } },
      },
      { cards, materials }
    );
    const result = resp.result as { content: Array<{ text: string }> };
    const payload = JSON.parse(result.content[0].text) as {
      totalFound: number;
      materials: Array<{ id: string; resourceUri: string; excerpt: string }>;
    };
    // 搜不到知识卡时用它——素材也要能被外部 Agent 找到。
    expect(payload.totalFound).toBe(1);
    expect(payload.materials[0].id).toBe("mcp-mat-1");
    expect(payload.materials[0].resourceUri).toBe("knowflick://materials/mcp-mat-1");
  });

  it("多词检索按「每个词都要出现」判定", async () => {
    const resp = await handleMcpRequest(
      {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "search_materials", arguments: { query: "本地 优先", limit: 5 } },
      },
      { cards, materials }
    );
    const result = resp.result as { content: Array<{ text: string }> };
    const payload = JSON.parse(result.content[0].text) as { totalFound: number };
    expect(payload.totalFound).toBe(1);

    const miss = await handleMcpRequest(
      {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "search_materials", arguments: { query: "本地 不存在的词", limit: 5 } },
      },
      { cards, materials }
    );
    const missResult = miss.result as { content: Array<{ text: string }> };
    expect((JSON.parse(missResult.content[0].text) as { totalFound: number }).totalFound).toBe(0);
  });

  it("按 resourceUri 读回素材全文与出处", async () => {
    const resp = await handleMcpRequest(
      { jsonrpc: "2.0", id: 12, method: "resources/read", params: { uri: "knowflick://materials/mcp-mat-1" } },
      { cards, materials }
    );
    const result = resp.result as { contents: Array<{ text: string }> };
    const payload = JSON.parse(result.contents[0].text) as { id: string; text: string };
    expect(payload.id).toBe("mcp-mat-1");
    expect(payload.text).toBe("一个关于本地优先架构的灵感");
  });

  it("读不存在的素材返回标准错误码", async () => {
    const resp = await handleMcpRequest(
      { jsonrpc: "2.0", id: 13, method: "resources/read", params: { uri: "knowflick://materials/nope" } },
      { cards, materials }
    );
    expect(resp.error?.code).toBe(-32602);
  });

  it("search_knowledge 精准命中知识卡并返回结构化文本", async () => {
    const resp = await handleMcpRequest(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "search_knowledge", arguments: { query: "SQLite", limit: 3 } },
      },
      { cards, materials }
    );
    const result = resp.result as { content: Array<{ type: string; text: string }> };
    const payload = JSON.parse(result.content[0].text) as { totalFound: number; cards: Array<{ id: string }> };
    expect(payload.totalFound).toBeGreaterThan(0);
    expect(payload.cards[0].id).toBe("mcp-card-1");
  });

  it("create_flash_card 调用宿主回调创建卡片", async () => {
    const onAddCard = vi.fn();
    const resp = await handleMcpRequest(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "create_flash_card",
          arguments: {
            headline: "外部 Agent 创建的知识卡",
            summary: "来自 Cursor 的自动总结",
            details: "通过 MCP 协议无缝写回个人知识库。",
            category: "AI",
            tags: ["MCP", "外部代理"],
          },
        },
      },
      { cards, materials, onAddCard }
    );

    expect(onAddCard).toHaveBeenCalledTimes(1);
    const created = onAddCard.mock.calls[0][0];
    expect(created.headline).toBe("外部 Agent 创建的知识卡");
    expect(created.category).toBe("AI");

    const result = resp.result as { content: Array<{ text: string }> };
    expect(result.content[0].text).toContain("知识卡片创建成功");
  });

  it("add_material 写入收件箱素材", async () => {
    const onAddMaterial = vi.fn();
    await handleMcpRequest(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "add_material",
          arguments: { title: "外部文章", text: "正文内容", source_url: "https://example.com" },
        },
      },
      { cards, materials, onAddMaterial }
    );

    expect(onAddMaterial).toHaveBeenCalledTimes(1);
    const material = onAddMaterial.mock.calls[0][0];
    expect(material.title).toBe("外部文章");
    expect(material.inboxStatus).toBe("inbox");
    expect(material.sourceUrl).toBe("https://example.com");
    expect(material.sourceType).toBe("web");

    onAddMaterial.mockClear();
    await handleMcpRequest(
      {
        jsonrpc: "2.0", id: 15, method: "tools/call",
        params: { name: "add_material", arguments: { title: "随手记录", text: "没有链接的正文" } },
      },
      { cards, materials, onAddMaterial }
    );
    expect(onAddMaterial).toHaveBeenCalledTimes(1);
    const note: RawMaterial = onAddMaterial.mock.calls[0][0];
    expect(note.sourceType).toBe("manual");
    expect(note.sourceUrl).toBeNull();
    expect(note.rawText).toBe("没有链接的正文");
  });

  it("get_knowledge_stats 汇总分类分布与收件箱数量", async () => {
    const resp = await handleMcpRequest(
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "get_knowledge_stats", arguments: {} },
      },
      { cards, materials }
    );
    const result = resp.result as { content: Array<{ text: string }> };
    const stats = JSON.parse(result.content[0].text) as {
      totalCards: number;
      favoriteCards: number;
      inboxMaterials: number;
      categoriesDistribution: Record<string, number>;
    };
    expect(stats.totalCards).toBe(2);
    expect(stats.favoriteCards).toBe(1);
    expect(stats.inboxMaterials).toBe(1);
    expect(stats.categoriesDistribution["计算机"]).toBe(1);
  });

  it("未知方法与未知工具返回标准 JSON-RPC 错误", async () => {
    const resp1 = await handleMcpRequest(
      { jsonrpc: "2.0", id: 7, method: "unknown/method" },
      { cards, materials }
    );
    expect(resp1.error?.code).toBe(-32601);

    const resp2 = await handleMcpRequest(
      {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "not_exist_tool", arguments: {} },
      },
      { cards, materials }
    );
    expect(resp2.error?.code).toBe(-32601);
  });

  it("生成即插即用的 MCP 配置片段", () => {
    const snippet = generateMcpConfigSnippet("/path/to/mcp-server.mjs");
    const parsed = JSON.parse(snippet) as { mcpServers: { knowflick: { command: string; args: string[] } } };
    expect(parsed.mcpServers.knowflick.command).toBe("node");
    expect(parsed.mcpServers.knowflick.args[0]).toBe("/path/to/mcp-server.mjs");
  });
});
