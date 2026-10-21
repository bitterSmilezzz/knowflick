import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { KnowledgeCard } from "../domain/card";

export interface RawMaterial {
  id: string;
  sourceType: string;
  title: string;
  sourceUrl?: string | null;
  rawText: string;
  cleanedMarkdown?: string | null;
  contentHash: string;
  mediaPath?: string | null;
  mediaSizeBytes?: number;
  metadataJson: string;
  inboxStatus: "inbox" | "processed" | "dismissed";
  createdAt: number;
  updatedAt: number;
}

export interface DbStats {
  totalCards: number;
  totalMaterials: number;
  inboxMaterials: number;
  favoriteCards: number;
  seenCards: number;
  dueCards: number;
}

export interface StoreSnapshot {
  dir: string;
  cards: string | null;
  backup: string | null;
  backup2: string | null;
  settings: string | null;
  searchHistory: string | null;
}

export function inShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function loadStore(dir?: string): Promise<StoreSnapshot> {
  return invoke("load_store", { dir: dir ?? null });
}

export function saveCards(dir: string, text: string): Promise<void> {
  return invoke("save_cards", { dir, text });
}

export function saveSettings(dir: string, text: string): Promise<void> {
  return invoke("save_settings", { dir, text });
}

export function saveSearchHistory(dir: string, text: string): Promise<void> {
  return invoke("save_search_history", { dir, text });
}

export function readArchive(path: string): Promise<{ cards: string; settings: string | null }> {
  return invoke("read_archive", { path });
}

export async function pickImportArchive(): Promise<string | null> {
  const selected = await open({
    directory: false,
    multiple: false,
    filters: [{ name: "KnowFlick 归档", extensions: ["zip", "json"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export function readApiKey(dir: string): Promise<string> {
  return invoke("read_api_key", { dir });
}

export function writeApiKey(dir: string, value: string): Promise<void> {
  return invoke("write_api_key", { dir, value });
}

export function readTextFile(path: string): Promise<string> {
  return invoke("read_text_file", { path });
}

export async function pickNoteFile(): Promise<string | null> {
  const selected = await open({
    directory: false,
    multiple: false,
    filters: [{ name: "笔记", extensions: ["md", "markdown", "txt", "json"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function pickLibraryDir(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

export function fetchClip(url: string): Promise<{ text: string; finalUrl: string }> {
  return invoke("fetch_clip", { url });
}

/**
 * 调一次对话补全。桌面端走 Rust（reqwest，规避 webview 的 CORS 限制）；
 * 浏览器体验模式没有 Rust 壳，改用 fetch 直连。
 *
 * 浏览器模式下服务商要放开 CORS 才通；不通时错误信息里说明原因，
 * 不要让用户对着一个网络错误猜。
 */
export async function completeChat(endpoint: string, apiKey: string, body: string): Promise<string> {
  if (inShell()) {
    return invoke("complete_chat", { endpoint, apiKey, body });
  }
  const isAnthropic = endpoint.includes("anthropic.com");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (isAnthropic) {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  let response: Response;
  try {
    // 没有超时的请求会让界面一直停在「处理中」——用户既看不出在等什么，
    // 也没有退出的办法。桌面端 reqwest 已有 120 秒超时，这里对齐。
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new Error(
      timedOut
        ? "模型 120 秒没有响应，已中止。可以先检查网络或换一个更小的模型，已保存的内容不受影响。"
        : `浏览器模式无法直接请求该服务商（跨域被拒绝）：${String(err)}。请在桌面客户端使用，或换一个允许跨域的服务商。`
    );
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`API 返回 ${response.status}：${text.slice(0, 200)}`);
  }
  const parsed = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string } }>;
    content?: Array<{ text?: string }>;
  };
  if (parsed.choices?.[0]?.message?.content) return parsed.choices[0].message.content;
  if (parsed.content?.[0]?.text) return parsed.content[0].text;
  return text;
}

export function exportArchive(dir: string, dest: string): Promise<void> {
  return invoke("export_archive", { dir, dest });
}

export function exportCardsJson(dir: string, dest: string): Promise<void> {
  return invoke("export_cards_json", { dir, dest });
}

export async function openExternalUrl(url: string): Promise<void> {
  if (inShell()) {
    await invoke("open_url", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function pickExportPath(defaultName = "knowflick-backup.zip"): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const selected = await save({
    defaultPath: defaultName,
    filters: [
      { name: "ZIP 备份包（卡片 + 设置）", extensions: ["zip"] },
      { name: "JSON 卡片数据", extensions: ["json"] },
    ],
  });
  return typeof selected === "string" ? selected : null;
}

export function dbLoadCards(dir?: string, limit?: number, offset?: number): Promise<KnowledgeCard[]> {
  return invoke("db_load_cards", { dir: dir ?? null, limit: limit ?? null, offset: offset ?? null });
}

export function dbUpsertCard(card: KnowledgeCard, dir?: string): Promise<void> {
  return invoke("db_upsert_card", { dir: dir ?? null, card });
}

export function dbDeleteCard(id: string, dir?: string): Promise<void> {
  return invoke("db_delete_card", { dir: dir ?? null, id });
}

export function dbSearchCardsFts(query: string, dir?: string, limit?: number): Promise<KnowledgeCard[]> {
  return invoke("db_search_cards_fts", { dir: dir ?? null, query, limit: limit ?? null });
}

export function dbSaveMaterial(material: RawMaterial, dir?: string): Promise<void> {
  return invoke("db_save_material", { dir: dir ?? null, material });
}

export function dbListMaterials(inboxOnly?: boolean, dir?: string, limit?: number): Promise<RawMaterial[]> {
  return invoke("db_list_materials", { dir: dir ?? null, inboxOnly: inboxOnly ?? true, limit: limit ?? null });
}

export function dbUpdateMaterialStatus(id: string, status: string, dir?: string): Promise<void> {
  return invoke("db_update_material_status", { dir: dir ?? null, id, status });
}

export function dbGetStats(dir?: string): Promise<DbStats> {
  return invoke("db_get_stats", { dir: dir ?? null });
}

export interface Artifact {
  id: string;
  artifactType: string;
  title: string;
  contentMarkdown: string;
  sourceCardIds: string[];
  dateScopeStart?: number | null;
  dateScopeEnd?: number | null;
  createdAt: number;
  updatedAt: number;
  isDeleted?: boolean;
}

export function dbDeleteArtifact(id: string, dir?: string): Promise<void> {
  return invoke("db_delete_artifact", { dir: dir ?? null, id });
}

export function dbSaveArtifact(artifact: Artifact, dir?: string): Promise<void> {
  return invoke("db_save_artifact", { dir: dir ?? null, artifact });
}

export function dbListArtifacts(limit?: number, dir?: string): Promise<Artifact[]> {
  return invoke("db_list_artifacts", { dir: dir ?? null, limit: limit ?? 50 });
}

export function dbSaveCardEmbedding(cardId: string, embedding: number[], dir?: string): Promise<void> {
  return invoke("db_save_card_embedding", { dir: dir ?? null, cardId, embedding });
}

export function dbSearchCardsVector(queryEmbedding: number[], limit?: number, dir?: string): Promise<Array<[KnowledgeCard, number]>> {
  return invoke("db_search_cards_vector", { dir: dir ?? null, queryEmbedding, limit: limit ?? 10 });
}

export function dbSearchCardsHybrid(
  queryText: string,
  queryEmbedding?: number[] | null,
  limit?: number,
  dir?: string
): Promise<KnowledgeCard[]> {
  return invoke("db_search_cards_hybrid", {
    dir: dir ?? null,
    queryText,
    queryEmbedding: queryEmbedding ?? null,
    limit: limit ?? 10,
  });
}

export function dbListUnembeddedCardIds(limit?: number, dir?: string): Promise<string[]> {
  return invoke("db_list_unembedded_card_ids", { dir: dir ?? null, limit: limit ?? 100 });
}

export function dbSaveCardEmbeddingsBatch(
  items: Array<{ cardId: string; embedding: number[] }>,
  dir?: string
): Promise<void> {
  const payload = items.map((it) => ({ card_id: it.cardId, embedding: it.embedding }));
  return invoke("db_save_card_embeddings_batch", { dir: dir ?? null, items: payload });
}

export function requestEmbeddings(
  endpoint: string,
  apiKey: string,
  model: string,
  input: string[]
): Promise<number[][]> {
  return invoke("request_embeddings", { endpoint, apiKey, model, input });
}

export function dbSearchMaterialsFts(query: string, limit?: number, dir?: string): Promise<RawMaterial[]> {
  return invoke("db_search_materials_fts", { dir: dir ?? null, query, limit: limit ?? 60 });
}

export function dbBackfillMaterialFts(dir?: string): Promise<number> {
  return invoke("db_backfill_material_fts", { dir: dir ?? null });
}

/** subscriptions 表的线上形状（camelCase，对应 Rust `SubscriptionDto`）。 */
export interface SubscriptionRow {
  id: string;
  type: string;
  title: string;
  targetUrl: string;
  intervalMinutes: number;
  lastPolledAt: number | null;
  isActive: boolean;
  createdAt: number;
}

export function dbListSubscriptions(dir?: string): Promise<SubscriptionRow[]> {
  return invoke("db_list_subscriptions", { dir: dir ?? null });
}

export function dbSaveSubscription(subscription: SubscriptionRow, dir?: string): Promise<void> {
  return invoke("db_save_subscription", { dir: dir ?? null, subscription });
}

export function dbMarkSubscriptionPolled(id: string, polledAt: number, dir?: string): Promise<void> {
  return invoke("db_mark_subscription_polled", { dir: dir ?? null, id, polledAt });
}

export function dbDeleteSubscription(id: string, dir?: string): Promise<void> {
  return invoke("db_delete_subscription", { dir: dir ?? null, id });
}

/** 本地语音转写（official-speech-asr）。 */
export interface AsrModelStatus {
  model: string;
  installed: boolean;
  path: string | null;
  sizeBytes: number;
  expectedBytes: number;
}

export interface TranscriptionResult {
  text: string;
  audioMs: number;
  elapsedMs: number;
  model: string;
}

export function asrModelStatus(model: string): Promise<AsrModelStatus> {
  return invoke("asr_model_status", { model });
}

export function asrDownloadModel(model: string): Promise<AsrModelStatus> {
  return invoke("asr_download_model", { model });
}

export function asrTranscribe(path: string, model?: string): Promise<TranscriptionResult> {
  return invoke("asr_transcribe", { path, model: model ?? null });
}

/**
 * 保存一条笔记附件（录音 / 手写），返回库内相对路径。
 * 文件名由宿主生成，前端只决定类型与内容。
 */
export function saveMedia(kind: "audio" | "ink" | "image", mime: string, data: Uint8Array, dir?: string): Promise<string> {
  return invoke("save_media", { dir: dir ?? null, kind, mime, data: Array.from(data) });
}

export function readMedia(relative: string, dir?: string): Promise<number[]> {
  return invoke("read_media", { dir: dir ?? null, relative });
}

export async function pickAudioFile(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    filters: [{ name: "音频", extensions: ["wav", "m4a", "mp3", "aiff", "aif", "caf", "flac"] }],
  });
  return typeof selected === "string" ? selected : null;
}

/** 本地语义向量（fastembed / multilingual-e5-small，384 维）。 */
export interface LocalEmbedStatus {
  model: string;
  dim: number;
  downloaded: boolean;
  cacheDir: string;
}

export function localEmbedStatus(): Promise<LocalEmbedStatus> {
  return invoke("local_embed_status");
}

export function localEmbedWarmUp(): Promise<LocalEmbedStatus> {
  return invoke("local_embed_warm_up");
}

export function localEmbed(texts: string[], isQuery = false): Promise<number[][]> {
  return invoke("local_embed", { texts, isQuery });
}

export function dbListStaleEmbeddingCardIds(dim: number, limit?: number, dir?: string): Promise<string[]> {
  return invoke("db_list_stale_embedding_card_ids", { dir: dir ?? null, dim, limit: limit ?? 100 });
}
