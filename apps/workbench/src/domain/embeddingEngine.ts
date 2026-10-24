import type { KnowledgeCard } from "./card";
import {
  inShell,
  dbListUnembeddedCardIds,
  dbListStaleEmbeddingCardIds,
  dbSaveCardEmbeddingsBatch,
  localEmbed,
  localEmbedStatus,
  requestEmbeddings,
} from "../shell/store";

export interface EmbeddingConfig {
  providerId?: string;
  baseURL?: string;
  apiKey?: string;
  embeddingModel?: string;
}

/** 预设厂商的默认向量嵌入模型名称 */
export const DEFAULT_EMBEDDING_MODELS: Record<string, string> = {
  openai: "text-embedding-3-small",
  siliconflow: "BAAI/bge-m3",
  zhipu: "embedding-3",
  qwen: "text-embedding-v3",
  ollama: "bge-m3",
};

/** 解析生成标准的 OpenAI 兼容 embeddings 端点 */
export function embeddingURL(baseURL: string): string {
  const clean = baseURL.trim().replace(/\/+$/, "");
  if (!clean) return "";
  if (clean.endsWith("/embeddings")) return clean;
  if (clean.endsWith("/v1")) return `${clean}/embeddings`;
  return `${clean}/v1/embeddings`;
}

/** 将卡片内容拼接为适合语义索引的富文本表达 */
export function cardToEmbeddingText(card: KnowledgeCard): string {
  const parts = [
    card.category ? `[${card.category}]` : "",
    card.headline,
    card.summary,
    card.details,
    card.tags?.length ? card.tags.map((t) => `#${t}`).join(" ") : "",
  ].filter(Boolean);
  return parts.join(" ");
}

/** 32 位 FNV-1a 哈希函数 */
function fnv1a(str: string, seed = 0x811c9dc5): number {
  let hash = seed;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 本地确定性语义哈希投影（Zero-dependency Local Semantic Feature Projection）
 * 100% 离线、微秒级响应、确定性高斯投影 SimHash 衍生算法：
 * - 提取字符 2-gram、3-gram 与英文分词；
 * - 结合词频饱和加权，将文本投影到固定维度（默认 128 维）；
 * - L2 归一化后具备余弦相似度单调性，共享主题的卡片呈现高相似度，无关文本接近 0。
 */
export function localSemanticHashEmbedding(text: string, dim = 128): number[] {
  const clean = text.toLowerCase().trim();
  if (!clean) {
    return new Array(dim).fill(0);
  }

  // 1. 分词与 n-gram 提取
  const termCounts = new Map<string, number>();

  // 英文与数字单词
  const words = clean.match(/[a-z0-9_]+/g) || [];
  for (const w of words) {
    termCounts.set(w, (termCounts.get(w) || 0) + 1);
  }

  // 中文及其它非 ASCII 字符的 1-gram, 2-gram, 3-gram
  const cjkChars = clean.replace(/[\s\p{P}\p{S}]/gu, "");
  for (let i = 0; i < cjkChars.length; i++) {
    const unigram = cjkChars.slice(i, i + 1);
    termCounts.set(unigram, (termCounts.get(unigram) || 0) + 1);
    if (i + 1 < cjkChars.length) {
      const bigram = cjkChars.slice(i, i + 2);
      termCounts.set(bigram, (termCounts.get(bigram) || 0) + 1);
    }
    if (i + 2 < cjkChars.length) {
      const trigram = cjkChars.slice(i, i + 3);
      termCounts.set(trigram, (termCounts.get(trigram) || 0) + 1);
    }
  }

  // 2. 向量特征投影与加权
  const vec = new Float32Array(dim);
  const SEEDS = [0x811c9dc5, 0x9e3779b9, 0xa0761d64, 0x68bc21eb];

  for (const [term, count] of termCounts.entries()) {
    // 长度特征加权：双字词/三字词与单词权重更高，单字权重较低，抑制噪音
    const lenWeight = term.length >= 3 ? 2.5 : term.length === 2 ? 1.8 : 0.6;
    const weight = lenWeight * (1 + Math.log(count));

    for (let s = 0; s < SEEDS.length; s++) {
      const h = fnv1a(term, SEEDS[s]);
      const index = (h ^ (h >>> 16)) % dim;
      // 符号翻转 (+1 或 -1)
      const sign = (h & 0x1) === 0 ? 1 : -1;
      vec[index] += sign * weight;
    }
  }

  // 3. L2 归一化
  let sumSq = 0;
  for (let i = 0; i < dim; i++) {
    sumSq += vec[i] * vec[i];
  }

  const norm = Math.sqrt(sumSq);
  if (norm < 1e-6) {
    return Array.from(vec);
  }

  const out = new Array<number>(dim);
  for (let i = 0; i < dim; i++) {
    out[i] = Number((vec[i] / norm).toFixed(6));
  }
  return out;
}

/** 向量余弦相似度计算 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom < 1e-6) return 0;
  return dot / denom;
}

/**
 * 统一向量生成引擎：支持 API 远程神经网络嵌入与本地零依赖语义特征哈希平滑回退
 */
export class EmbeddingEngine {
  constructor(private config: EmbeddingConfig = {}) {}

  /**
   * 最近一次 embedTexts 实际使用的向量空间身份。
   * 落库时用它而不是猜测——回退路径（API 失败转本地、本地失败转哈希）
   * 改变了空间，向量与身份必须同步，否则不同空间的向量会混算。
   */
  private lastIdentity: { provider: string; model: string } = { provider: "hash", model: "char-ngram-128" };

  /**
   * 向量空间身份（R2 版本化）：同维度不同 provider/model 的向量不混算，
   * 所以每次落库/检索/标脏都带上「这个引擎用的是谁」。
   * API 路径的 model 是 embeddingModel 或按 providerId 的默认表；
   * 本地路径（whisper 风格的 ONNX 模型）按本地模型名报。
   */
  identity(): { provider: string; model: string } {
    return this.lastIdentity;
  }

  updateConfig(config: EmbeddingConfig) {
    this.config = { ...this.config, ...config };
  }

  canUseApi(): boolean {
    const { baseURL, apiKey } = this.config;
    return !!(baseURL?.trim() && apiKey?.trim() && inShell());
  }

  /**
   * 三档优先级：
   * 1. 配了 API key → 远程模型（质量最好，但要联网、按量计费）；
   * 2. 桌面端且本地语义模型已下载 → fastembed `multilingual-e5-small`（384 维，离线）；
   * 3. 都没有 → 确定性哈希投影（128 维，零依赖兜底）。
   *
   * 三档不在同一向量空间，**维度即引擎标识**：检索只比同维度向量，换档后旧向量由
   * `syncCardEmbeddings` 按维度标脏重算。
   */
  async embedTexts(texts: string[], isQuery = false): Promise<number[][]> {
    if (texts.length === 0) return [];

    if (this.canUseApi()) {
      try {
        const endpoint = embeddingURL(this.config.baseURL!);
        const model =
          this.config.embeddingModel ||
          (this.config.providerId ? DEFAULT_EMBEDDING_MODELS[this.config.providerId] : undefined) ||
          "text-embedding-3-small";
        this.lastIdentity = { provider: this.config.providerId || "api", model };
        return await requestEmbeddings(endpoint, this.config.apiKey!, model, texts);
      } catch (err) {
        console.warn("[EmbeddingEngine] API 嵌入生成失败，尝试本地语义模型:", err);
      }
    }

    if (inShell() && (await this.localModelReady())) {
      try {
        const vectors = await localEmbed(texts, isQuery);
        this.lastIdentity = { provider: "local", model: "multilingual-e5-small" };
        return vectors;
      } catch (err) {
        console.warn("[EmbeddingEngine] 本地语义模型不可用，回退到哈希投影:", err);
      }
    }

    this.lastIdentity = { provider: "hash", model: "char-ngram-128" };
    return texts.map((t) => localSemanticHashEmbedding(t, 128));
  }

  async embedText(text: string, isQuery = false): Promise<number[]> {
    const [vec] = await this.embedTexts([text], isQuery);
    return vec ?? localSemanticHashEmbedding(text, 128);
  }

  /** 本地语义模型是否就绪（只在桌面端有意义）。结果缓存在实例上，避免每次查询都走 IPC。 */
  private localReady: boolean | null = null;
  async localModelReady(): Promise<boolean> {
    if (this.localReady !== null) return this.localReady;
    try {
      const status = await localEmbedStatus();
      this.localReady = status.downloaded;
    } catch {
      this.localReady = false;
    }
    return this.localReady;
  }

  /** 当前引擎输出的维度，用于判断旧向量是否需要重算。 */
  async currentDim(): Promise<number> {
    if (this.canUseApi()) return 0; // 远程维度未知，交给「未嵌入」逻辑处理
    if (inShell() && (await this.localModelReady())) return 384;
    return 128;
  }

  async embedCard(card: KnowledgeCard): Promise<number[]> {
    return this.embedText(cardToEmbeddingText(card));
  }
}

/**
 * 知识库后台向量同步流水线
 * 自动发现未嵌入卡片，分批批量生成向量并写入 SQLite
 */
export async function syncCardEmbeddings(
  cards: KnowledgeCard[],
  engine: EmbeddingEngine,
  options: {
    batchSize?: number;
    dir?: string;
    onProgress?: (indexed: number, total: number) => void;
  } = {}
): Promise<{ indexedCount: number }> {
  if (!cards.length) return { indexedCount: 0 };
  const batchSize = options.batchSize ?? 20;

  if (inShell()) {
    let indexedCount = 0;
    // 先清掉维度对不上的旧向量（换过嵌入引擎），再补没向量化的卡片。
    const dim = await engine.currentDim();
    while (true) {
      const missingIds = await dbListUnembeddedCardIds(batchSize, options.dir);
      if (!missingIds.length) break;

      const toEmbed = missingIds
        .map((id) => cards.find((c) => c.id === id))
        .filter((c): c is KnowledgeCard => !!c);

      if (!toEmbed.length) break;

      const texts = toEmbed.map(cardToEmbeddingText);
      const embeddings = await engine.embedTexts(texts);

      const items = toEmbed.map((card, idx) => ({
        cardId: card.id,
        embedding: embeddings[idx],
      }));

      await dbSaveCardEmbeddingsBatch(items, engine.identity(), options.dir);
      indexedCount += items.length;
      options.onProgress?.(indexedCount, cards.length);
    }

    // 维度已知且与旧向量不同：这些卡片重算一遍，否则它们在检索里永远匹配不到。
    if (dim > 0) {
      const stale = await dbListStaleEmbeddingCardIds(dim, engine.identity(), batchSize, options.dir);
      const staleCards = stale
        .map((id) => cards.find((c) => c.id === id))
        .filter((c): c is KnowledgeCard => !!c);
      if (staleCards.length > 0) {
        const texts = staleCards.map(cardToEmbeddingText);
        const embeddings = await engine.embedTexts(texts);
        await dbSaveCardEmbeddingsBatch(
          staleCards.map((card, idx) => ({ cardId: card.id, embedding: embeddings[idx] })),
          engine.identity(),
          options.dir
        );
        indexedCount += staleCards.length;
      }
    }
    return { indexedCount };
  }

  return { indexedCount: 0 };
}
