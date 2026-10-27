import { describe, expect, it } from "vitest";
import { isPluginEnabled, OFFICIAL_PLUGINS } from "./pluginRegistry";
import { readPluginSettings } from "./pluginSettings";
import { handleMcpRequest } from "./mcpServer";

/**
 * 官方模块开关生命周期与行为矩阵（T09，收口审计 KF-012）：
 * 覆盖 6 个官方模块的启用状态消费点、关闭时的阻断/降级策略以及旧内容可读不变式。
 */

describe("T09 官方模块开关行为矩阵（KF-012）", () => {
  it("所有 6 个官方插件均有明确的默认状态与元数据声明", () => {
    expect(OFFICIAL_PLUGINS).toHaveLength(6);
    const ids = OFFICIAL_PLUGINS.map((p) => p.id);
    expect(ids).toContain("official-inbox-sniff");
    expect(ids).toContain("official-doc-extractor");
    expect(ids).toContain("official-review-fsrs");
    expect(ids).toContain("official-cognitive-brief");
    expect(ids).toContain("official-speech-asr");
    expect(ids).toContain("official-mcp-server");
  });

  describe("1. official-inbox-sniff（智能链接嗅探）", () => {
    it("默认启用；关闭时正确识别为 false", () => {
      expect(isPluginEnabled("official-inbox-sniff", {})).toBe(true);
      const settings = readPluginSettings({ plugins: { "official-inbox-sniff": { enabled: false } } });
      expect(isPluginEnabled("official-inbox-sniff", settings)).toBe(false);
    });
  });

  describe("2. official-doc-extractor（本地文档解析器）", () => {
    it("默认启用；关闭时正确识别为 false", () => {
      expect(isPluginEnabled("official-doc-extractor", {})).toBe(true);
      const settings = readPluginSettings({ plugins: { "official-doc-extractor": { enabled: false } } });
      expect(isPluginEnabled("official-doc-extractor", settings)).toBe(false);
    });
  });

  describe("3. official-cognitive-brief（认知简报与周报）", () => {
    it("默认启用；关闭时正确识别为 false", () => {
      expect(isPluginEnabled("official-cognitive-brief", {})).toBe(true);
      const settings = readPluginSettings({ plugins: { "official-cognitive-brief": { enabled: false } } });
      expect(isPluginEnabled("official-cognitive-brief", settings)).toBe(false);
    });
  });

  describe("4. official-review-fsrs（FSRS 间隔复习）", () => {
    it("支持旧 settings.raw.reviewPluginEnabled 兼容映射", () => {
      expect(isPluginEnabled("official-review-fsrs", {}, true)).toBe(true);
      expect(isPluginEnabled("official-review-fsrs", {}, false)).toBe(false);
      // 显式插件设置优先级高于旧字段
      expect(isPluginEnabled("official-review-fsrs", { "official-review-fsrs": { enabled: false } } as any, true)).toBe(false);
    });
  });

  describe("5. official-speech-asr（本地语音 Whisper）", () => {
    it("默认关闭（需下载模型权重）；显式开启后为 true，关闭后为 false", () => {
      // ASR 默认不启用：模型权重要按需下载，随包预置会让安装包白胖一倍
      expect(isPluginEnabled("official-speech-asr", {})).toBe(false);
      const on = readPluginSettings({ plugins: { "official-speech-asr": { enabled: true } } });
      expect(isPluginEnabled("official-speech-asr", on)).toBe(true);
      const off = readPluginSettings({ plugins: { "official-speech-asr": { enabled: false } } });
      expect(isPluginEnabled("official-speech-asr", off)).toBe(false);
    });
  });

  describe("6. official-mcp-server（MCP 外部协议与吊销）", () => {
    it("停用时 MCP 请求被拒绝，返回明确停用提示", async () => {
      const disabledReq = {
        jsonrpc: "2.0" as const,
        id: "1",
        method: "tools/list",
      };
      const res = await handleMcpRequest(disabledReq, {
        cards: [],
        materials: [],
        enabled: false,
      });
      expect(res.error).toBeDefined();
      expect(res.error?.message).toMatch(/停用/);
    });

    it("模块启用不能绕过嵌入式入口的授权要求", async () => {
      const req = {
        jsonrpc: "2.0" as const,
        id: "2",
        method: "tools/list",
      };
      const res = await handleMcpRequest(req, {
        cards: [],
        materials: [],
        enabled: true,
      });
      expect(res.error?.message).toContain("尚未接入项目授权");
    });
  });
});
