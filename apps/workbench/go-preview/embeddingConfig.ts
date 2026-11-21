/** go-preview 共享的向量身份与接口端点规则（与 apps/workbench/src/domain/embeddingEngine.ts 同口径）。
 *  不能直接引共享模块：它经 shell/store 依赖 Tauri 壳，Wails 预览没有那层。 */
export const HASH_IDENTITY = { provider: "hash", model: "char-ngram-128" };

export const DEFAULT_EMBEDDING_MODELS: Record<string, string> = {
  openai: "text-embedding-3-small",
  siliconflow: "BAAI/bge-m3",
  zhipu: "embedding-3",
  qwen: "text-embedding-v3",
  ollama: "bge-m3",
};

export function embeddingEndpoint(baseURL: string): string {
  const clean = baseURL.trim().replace(/\/+$/, "");
  if (!clean) return "";
  if (clean.endsWith("/embeddings")) return clean;
  if (clean.endsWith("/v1")) return clean + "/embeddings";
  return clean + "/v1/embeddings";
}

export function cardText(content: { category: string; headline: string; summary: string; details: string; tags?: string[] | null }): string {
  return [
    content.category ? "[" + content.category + "]" : "",
    content.headline,
    content.summary,
    content.details,
    content.tags?.length ? content.tags.map((tag) => "#" + tag).join(" ") : "",
  ].filter(Boolean).join(" ");
}

export type ApiEmbeddingConfig = { endpoint: string; provider: string; model: string };

/** 只有同时具备接口地址与密钥才启用 API 向量；设置不是合法 JSON 时视为未配置。 */
export function apiEmbeddingConfig(settingsRaw: string | null | undefined, apiKey: string): ApiEmbeddingConfig | null {
  let parsed: { providerId?: string; baseURL?: string; embeddingModel?: string };
  try {
    parsed = JSON.parse(settingsRaw || "{}") as typeof parsed;
  } catch {
    return null;
  }
  const baseURL = (parsed.baseURL ?? "").trim();
  if (!baseURL || !apiKey.trim()) return null;
  return {
    endpoint: embeddingEndpoint(baseURL),
    provider: parsed.providerId || "api",
    model: parsed.embeddingModel || DEFAULT_EMBEDDING_MODELS[parsed.providerId ?? ""] || "text-embedding-3-small",
  };
}
