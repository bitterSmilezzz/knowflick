import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

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

/** 「另存为」：选 ZIP 得备份包（卡片 + 设置），选 JSON 得裸 cards.json（与安卓侧同一份线格式）。 */
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
