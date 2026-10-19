import { describe, expect, it } from "vitest";
import {
  cardToEmbeddingText,
  embeddingURL,
  localSemanticHashEmbedding,
  cosineSimilarity,
  EmbeddingEngine,
} from "./embeddingEngine";
import { cardFromJson } from "./card";

describe("向量嵌入引擎 (EmbeddingEngine)", () => {
  it("端点 URL 正规化解析正确", () => {
    expect(embeddingURL("https://api.openai.com/v1")).toBe("https://api.openai.com/v1/embeddings");
    expect(embeddingURL("https://api.siliconflow.cn/v1/")).toBe("https://api.siliconflow.cn/v1/embeddings");
    expect(embeddingURL("https://open.bigmodel.cn/api/paas/v4")).toBe("https://open.bigmodel.cn/api/paas/v4/v1/embeddings");
    expect(embeddingURL("http://localhost:11434/v1/embeddings")).toBe("http://localhost:11434/v1/embeddings");
  });

  it("知识卡片富文本拼接覆盖完整特征", () => {
    const card = cardFromJson({
      id: "test-c1",
      category: "计算机",
      headline: "SQLite 架构",
      summary: "轻量单文件数据库",
      details: "B树索引与WAL模式",
      tags: ["数据库", "存储"],
      links: [],
      source: "imported",
      createdAt: 1000,
    });
    const text = cardToEmbeddingText(card);
    expect(text).toContain("[计算机]");
    expect(text).toContain("SQLite 架构");
    expect(text).toContain("轻量单文件数据库");
    expect(text).toContain("B树索引与WAL模式");
    expect(text).toContain("#数据库 #存储");
  });

  describe("本地确定性语义特征投影 (Local Semantic Hash Embedding)", () => {
    it("输出指定维度且满足 L2 归一化为单位向量", () => {
      const vec = localSemanticHashEmbedding("测试一段计算机架构原理文本", 128);
      expect(vec.length).toBe(128);

      const l2Norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
      expect(l2Norm).toBeCloseTo(1.0, 2);
    });

    it("空文本生成零向量", () => {
      const vec = localSemanticHashEmbedding("", 64);
      expect(vec.length).toBe(64);
      expect(vec.every((v) => v === 0)).toBe(true);
    });

    it("确定性：相同文本输入输出逐位一致", () => {
      const text = "深度学习与反向传播算法推导";
      const v1 = localSemanticHashEmbedding(text, 128);
      const v2 = localSemanticHashEmbedding(text, 128);
      expect(v1).toEqual(v2);
    });

    it("余弦相似度呈现明显的概念语义区分度", () => {
      const textA = "SQLite 全文检索与端侧向量数据库架构设计";
      const textB = "在 SQLite 中使用 FTS5 索引与嵌入式向量检索";
      const textC = "高中生物课本：光合作用中光反应与暗反应机制解析";

      const vA = localSemanticHashEmbedding(textA, 128);
      const vB = localSemanticHashEmbedding(textB, 128);
      const vC = localSemanticHashEmbedding(textC, 128);

      const simSameDomain = cosineSimilarity(vA, vB);
      const simDiffDomain = cosineSimilarity(vA, vC);

      // 同领域主题相似度显著高于跨领域主题（至少 3 倍以上区分度）
      expect(simSameDomain).toBeGreaterThan(0.25);
      expect(simDiffDomain).toBeLessThan(0.1);
      expect(simSameDomain).toBeGreaterThan(simDiffDomain * 3);
    });
  });

  describe("统一引擎 EmbeddingEngine 调用与回退", () => {
    it("无 API 配置时自动平滑走本地嵌入生成", async () => {
      const engine = new EmbeddingEngine();
      const texts = ["知识库条目一", "知识库条目二"];
      const embeddings = await engine.embedTexts(texts);

      expect(embeddings.length).toBe(2);
      expect(embeddings[0].length).toBe(128);
      expect(embeddings[1].length).toBe(128);
    });
  });
});
