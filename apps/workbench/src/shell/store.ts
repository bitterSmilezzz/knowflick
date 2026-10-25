import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { base64ToBytes, bytesToBase64 } from "./base64";
import type { KnowledgeCard } from "../domain/card";

// 形状定义在 domain/dto.ts（T11）：宿主从领域层取，domain 不再依赖宿主。
export type { RawMaterial } from "../domain/dto";
import type { RawMaterial } from "../domain/dto";

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
/**
 * 抹掉服务端错误原文里可能出现的凭据。
 *
 * 邮箱侧早就定了原则：「错误不回显密钥——不把服务端原文透给界面」
 * （见 docs/EMAIL_INTEGRATION.md）。AI 侧此前把响应原文前 200 字符直接显示，
 * 而部分服务商在 401 里会回显 API key（OpenAI 会截断，自建网关常常不截）。
 * 界面上的密钥一旦被截图或分享就泄露了，所以这里统一抹掉。
 */
export function redactSecrets(text: string): string {
  return text
    // 常见 key 前缀：sk-、sk-proj-、gsk_、xai-、Bearer 后面的整串
    .replace(/\b(sk|rk|gsk|xai|api)[-_][A-Za-z0-9_-]{8,}/gi, "[已隐藏的密钥]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer [已隐藏的密钥]")
    // 长随机串（32 位以上）多半是凭据，一并抹掉
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[已隐藏的长串]");
}

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
    throw new Error(`API 返回 ${response.status}：${redactSecrets(text).slice(0, 200)}`);
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

// ---------- 笔记与知识库（R1，契约 docs/NOTES_MODEL.md） ----------

export interface NoteSaveOutcomeShell { id: string; revision: number; created: boolean }

export function noteUpsert(note: object, baseRevision: number, dir?: string): Promise<NoteSaveOutcomeShell> {
  return invoke("note_upsert", { dir: dir ?? null, note, baseRevision });
}

export function noteEnsureFromMaterial(materialId: string, dir?: string): Promise<NoteSaveOutcomeShell> {
  return invoke("note_ensure_from_material", { dir: dir ?? null, materialId });
}

export interface BackupCopyResult {
  fileName: string;
  sha256: string;
  bytes: number;
  sidecar: string;
}

/** R3：把打包好的备份字节写到用户指定目录（版本化文件名 + SHA-256 sidecar）。 */
export function backupCopyToDirectory(targetDir: string, archiveBytes: Uint8Array): Promise<BackupCopyResult> {
  return invoke("backup_copy_to_directory", {
    targetDir,
    archiveBytes: Array.from(archiveBytes),
  });
}

// ---------- 项目记忆（R4/D06 最小闭环） ----------

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

// ---------- 个人画像（R4/D05：可治理的声明） ----------

export interface ProfileClaim {
  id: string;
  kind: "fact" | "inference" | "statistic";
  content: string;
  evidenceJson: string;
  scope: string;
  createdAt: number;
  confirmedAt: number | null;
  expiresAt: number | null;
  deniedAt: number | null;
  supersededBy: string | null;
  status: "active" | "paused";
}

// ---------- 目标（R4/D04） ----------

export type { Goal } from "../domain/dto";
import type { Goal } from "../domain/dto";

export function goalCreate(goal: Omit<Goal, "createdAt" | "achievedAt" | "abandonedAt" | "reviewNote" | "evidenceCount">, dir?: string): Promise<number> {
  return invoke("goal_create_cmd", { goal, dir: dir ?? null });
}

export function goalListActive(dir?: string): Promise<Goal[]> {
  return invoke("goal_list_active", { dir: dir ?? null });
}

export function goalLinkEvidence(goalId: string, evidenceId: string, kind: "note" | "material", dir?: string): Promise<number> {
  return invoke("goal_link_evidence_cmd", { goalId, evidenceId, kind, dir: dir ?? null });
}

export function goalAchieve(id: string, reviewNote: string, dir?: string): Promise<boolean> {
  return invoke("goal_achieve_cmd", { id, reviewNote, dir: dir ?? null });
}

export function goalAbandon(id: string, reviewNote: string, dir?: string): Promise<boolean> {
  return invoke("goal_abandon_cmd", { id, reviewNote, dir: dir ?? null });
}

export function profileClaimAdd(claim: Omit<ProfileClaim, "createdAt" | "confirmedAt" | "expiresAt" | "deniedAt" | "supersededBy" | "status">, dir?: string): Promise<number> {
  return invoke("profile_claim_add", { claim, dir: dir ?? null });
}

export function profileClaimsActive(dir?: string): Promise<ProfileClaim[]> {
  return invoke("profile_claims_active", { dir: dir ?? null });
}

export function profileClaimConfirm(id: string, dir?: string): Promise<boolean> {
  return invoke("profile_claim_confirm", { id, dir: dir ?? null });
}

export function profileClaimPause(id: string, dir?: string): Promise<boolean> {
  return invoke("profile_claim_pause", { id, dir: dir ?? null });
}

export function profileClaimResume(id: string, dir?: string): Promise<boolean> {
  return invoke("profile_claim_resume", { id, dir: dir ?? null });
}

export function profileClaimDeny(id: string, dir?: string): Promise<boolean> {
  return invoke("profile_claim_deny", { id, dir: dir ?? null });
}

export function profileClaimDelete(id: string, dir?: string): Promise<boolean> {
  return invoke("profile_claim_delete", { id, dir: dir ?? null });
}

export function profileDenialClearByEvidence(evidenceJson: string, dir?: string): Promise<boolean> {
  return invoke("profile_denial_clear_by_evidence", { evidenceJson, dir: dir ?? null });
}

export function projectCreate(id: string, name: string, description: string, dir?: string): Promise<void> {
  return invoke("project_create_cmd", { id, name, description, dir: dir ?? null });
}

export function projectList(includeArchived: boolean, dir?: string): Promise<Project[]> {
  return invoke("project_list", { includeArchived, dir: dir ?? null });
}

export function projectAddNote(projectId: string, noteId: string, dir?: string): Promise<void> {
  return invoke("project_add_note", { projectId, noteId, dir: dir ?? null });
}

export function projectRemoveNote(projectId: string, noteId: string, dir?: string): Promise<void> {
  return invoke("project_remove_note", { projectId, noteId, dir: dir ?? null });
}

/** 项目的一个成员笔记（R4/D06 界面入口）。 */
export interface ProjectMemberShell {
  noteId: string;
  title: string;
  excerpt: string;
  addedAt: number;
  isDeleted: boolean;
}

export function projectMemberList(projectId: string, dir?: string): Promise<ProjectMemberShell[]> {
  return invoke("project_member_list", { dir: dir ?? null, projectId });
}

export function projectArchive(projectId: string, dir?: string): Promise<boolean> {
  return invoke("project_archive_cmd", { projectId, dir: dir ?? null });
}

export function projectExportMarkdown(projectId: string, dir?: string): Promise<string> {
  return invoke("project_export_markdown_cmd", { projectId, dir: dir ?? null });
}

export function readWebdavCredential(dir?: string): Promise<string> {
  return invoke("read_webdav_credential", { dir: dir ?? null });
}

export function writeWebdavCredential(value: string, dir?: string): Promise<void> {
  return invoke("write_webdav_credential", { dir: dir ?? null, value });
}

export async function webdavUploadBackup(
  baseUrl: string,
  username: string | null,
  password: string | null,
  archiveBytes: Uint8Array
): Promise<BackupCopyResult> {
  return invoke("webdav_upload_backup", {
    baseUrl,
    username,
    password,
    archiveBytes: Array.from(archiveBytes),
  });
}

export function readImportReport(dir?: string): Promise<string | null> {
  return invoke("read_import_report", { dir: dir ?? null });
}

export function saveImportReport(text: string, dir?: string): Promise<void> {
  return invoke("save_import_report", { dir: dir ?? null, text });
}

export function noteGet(id: string, dir?: string): Promise<object | null> {
  return invoke("note_get", { dir: dir ?? null, id });
}

/** 列表范围：active 正常 / deleted 仅回收站 / all 全量（与 notes.rs 的三段语义一致）。 */
export type NoteListScope = "active" | "deleted" | "all";

export function noteListScope(dir: string | null | undefined, scope: NoteListScope, limit: number, offset: number): Promise<object[]> {
  return invoke("note_list", { dir: dir ?? null, scope, limit, offset });
}

export function noteDelete(id: string, dir?: string): Promise<boolean> {
  return invoke("note_delete", { dir: dir ?? null, id });
}

/** 备份恢复专用写入：返回逐条处置（与 notes.rs NoteRestoreOutcome 同名）。 */
export type NoteRestoreActionShell = "created" | "updated" | "skippedLocalNewer" | "skippedDivergent" | "current";

export function noteRestoreUpsert(note: object, dir?: string): Promise<NoteRestoreActionShell> {
  return invoke("note_restore_upsert", { dir: dir ?? null, note });
}

export function noteRestore(id: string, dir?: string): Promise<boolean> {
  return invoke("note_restore", { dir: dir ?? null, id });
}

export function noteSearch(query: string, kbId: string | null, dir?: string, limit?: number): Promise<object[]> {
  return invoke("note_search", { dir: dir ?? null, query, kbId, limit: limit ?? null });
}

// ---------- 分块向量（R2 向量化分块：块级语义召回） ----------

export interface NoteChunkTextShell {
  noteId: string;
  chunkIndex: number;
  content: string;
  contentRevision: number;
}

export function noteListChunkTexts(limit?: number): Promise<NoteChunkTextShell[]> {
  return invoke("note_list_chunk_texts", { limit: limit ?? null });
}

export function noteSaveChunkEmbeddings(
  items: Array<{ noteId: string; chunkIndex: number; embedding: number[] }>,
  identity?: EmbeddingIdentity
): Promise<number> {
  return invoke("note_save_chunk_embeddings", {
    items: items.map((it) => ({ note_id: it.noteId, chunk_index: it.chunkIndex, embedding: it.embedding })),
    provider: identity?.provider ?? "",
    model: identity?.model ?? "",
  });
}

export interface NoteChunkVectorHitShell {
  noteId: string;
  chunkIndex: number;
  content: string;
  charStart: number;
  charEnd: number;
  noteTitle: string;
  score: number;
}

export function noteSearchChunksVector(
  queryEmbedding: number[],
  identity?: EmbeddingIdentity,
  limit?: number
): Promise<NoteChunkVectorHitShell[]> {
  return invoke("note_search_chunks_vector", {
    queryEmbedding,
    provider: identity?.provider ?? "",
    model: identity?.model ?? "",
    limit: limit ?? null,
  });
}

export interface KbMembershipRestoreEntry { kbId: string; noteId: string; addedAt: number }
export interface KbMembershipRestoreOutcomeShell { kbId: string; noteId: string; action: string; error: string | null }

/** 备份恢复专用：按包内 addedAt 挂成员关系（逐条处置，幂等）。 */
export function kbRestoreMembership(entries: KbMembershipRestoreEntry[], dir?: string): Promise<KbMembershipRestoreOutcomeShell[]> {
  return invoke("kb_restore_membership", { dir: dir ?? null, entries });
}

export function kbCreate(id: string, name: string, description: string, dir?: string): Promise<void> {
  return invoke("kb_create", { dir: dir ?? null, id, name, description });
}

export function kbList(dir?: string): Promise<object[]> {
  return invoke("kb_list", { dir: dir ?? null });
}

export function kbAddNote(kbId: string, noteId: string, dir?: string): Promise<void> {
  return invoke("kb_add_note", { dir: dir ?? null, kbId, noteId });
}

export function kbRemoveNote(kbId: string, noteId: string, dir?: string): Promise<void> {
  return invoke("kb_remove_note", { dir: dir ?? null, kbId, noteId });
}

export function kbMembership(dir?: string): Promise<Record<string, number>> {
  return invoke("kb_membership", { dir: dir ?? null });
}

export function dbSaveMaterial(material: RawMaterial, dir?: string): Promise<void> {
  return invoke("db_save_material", { dir: dir ?? null, material });
}

/** MCP 服务端入口的绝对路径（T10/KF-013）：安装用户复制配置用真实路径，不是仓库相对路径。 */
export interface McpServerPathsShell { scriptPath: string; libraryDir: string; scriptExists: boolean }

export function mcpServerPaths(dir?: string): Promise<McpServerPathsShell> {
  return invoke("mcp_server_paths", { dir: dir ?? null });
}

export function dbListMaterials(inboxOnly?: boolean, dir?: string, limit?: number, offset?: number): Promise<RawMaterial[]> {
  return invoke("db_list_materials", { dir: dir ?? null, inboxOnly: inboxOnly ?? true, limit: limit ?? null, offset: offset ?? null });
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
  /** R4/D07：创作草稿的证据可能来自笔记（与卡片分开存，视图分别渲染）。 */
  sourceNoteIds?: string[];
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

export function dbListArtifacts(limit?: number, dir?: string, offset?: number): Promise<Artifact[]> {
  return invoke("db_list_artifacts", { dir: dir ?? null, limit: limit ?? 50, offset: offset ?? null });
}

/** 向量空间身份（R2）：同维度不同 provider/model 的向量不混算。 */
export interface EmbeddingIdentity {
  provider: string;
  model: string;
}

export function dbSaveCardEmbedding(cardId: string, embedding: number[], identity?: EmbeddingIdentity, dir?: string): Promise<void> {
  return invoke("db_save_card_embedding", { dir: dir ?? null, cardId, embedding, provider: identity?.provider ?? "", model: identity?.model ?? "" });
}

export function dbSearchCardsVector(queryEmbedding: number[], identity?: EmbeddingIdentity, limit?: number, dir?: string): Promise<Array<[KnowledgeCard, number]>> {
  return invoke("db_search_cards_vector", { dir: dir ?? null, queryEmbedding, provider: identity?.provider ?? "", model: identity?.model ?? "", limit: limit ?? 10 });
}

export function dbSearchCardsHybrid(
  queryText: string,
  queryEmbedding?: number[] | null,
  identity?: EmbeddingIdentity,
  limit?: number,
  dir?: string
): Promise<KnowledgeCard[]> {
  return invoke("db_search_cards_hybrid", {
    dir: dir ?? null,
    queryText,
    queryEmbedding: queryEmbedding ?? null,
    provider: identity?.provider ?? "",
    model: identity?.model ?? "",
    limit: limit ?? 10,
  });
}

export function dbListUnembeddedCardIds(limit?: number, dir?: string): Promise<string[]> {
  return invoke("db_list_unembedded_card_ids", { dir: dir ?? null, limit: limit ?? 100 });
}

export function dbSaveCardEmbeddingsBatch(
  items: Array<{ cardId: string; embedding: number[] }>,
  identity?: EmbeddingIdentity,
  dir?: string
): Promise<void> {
  const payload = items.map((it) => ({ card_id: it.cardId, embedding: it.embedding }));
  return invoke("db_save_card_embeddings_batch", { dir: dir ?? null, items: payload, provider: identity?.provider ?? "", model: identity?.model ?? "" });
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
 *
 * 字节在 IPC 边界转 base64（见 ./base64）：数字数组会把 5 MB 录音放大成
 * ~18 MB 的 JSON，备份导出读全部附件时跟着库一起长。
 */
export async function saveMedia(kind: "audio" | "ink" | "image", mime: string, data: Uint8Array, dir?: string): Promise<string> {
  return invoke("save_media", { dir: dir ?? null, kind, mime, dataB64: await bytesToBase64(data) });
}

/**
 * 库目录的「修改签名」——外部进程（MCP server 等）写库时用它发现改动。
 *
 * 界面刷新只有两个信号：本应用命令派发的 DOM 事件、浏览器 localStorage 的
 * storage 事件。独立进程写 SQLite 时两个都收不到，界面会停在旧状态。
 */
export function dbLibrarySignature(dir?: string): Promise<string> {
  return invoke("db_library_signature", { dir: dir ?? null });
}

export async function readMedia(relative: string, dir?: string): Promise<Uint8Array> {
  const b64 = await invoke<string>("read_media", { dir: dir ?? null, relative });
  return base64ToBytes(b64);
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

export function dbListStaleEmbeddingCardIds(dim: number, identity?: EmbeddingIdentity, limit?: number, dir?: string): Promise<string[]> {
  return invoke("db_list_stale_embedding_card_ids", { dir: dir ?? null, dim, provider: identity?.provider ?? "", model: identity?.model ?? "", limit: limit ?? 100 });
}
