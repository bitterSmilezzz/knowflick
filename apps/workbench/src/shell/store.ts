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

export function completeChat(endpoint: string, apiKey: string, body: string): Promise<string> {
  return invoke("complete_chat", { endpoint, apiKey, body });
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

export async function pickExportPath(): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const selected = await save({
    defaultPath: "knowflick-backup.zip",
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

