import { invoke } from "@tauri-apps/api/core";
import { dbListMaterials, dbLoadCards, dbSaveMaterial, dbUpsertCard, inShell, loadStore, readApiKey, saveSettings, writeApiKey, type RawMaterial } from "../../shell/store";
import type { KnowledgeCard } from "../../domain/card";
import { encodeSettings, parseSettings, type SettingsFile } from "../../domain/settings";

interface BrowserData { materials: RawMaterial[]; cards: KnowledgeCard[]; settings: string | null }
const browserKey = "knowflick.workspace.v1";
function browserData(): BrowserData {
  const raw = localStorage.getItem(browserKey);
  if (!raw) return { materials: [], cards: [], settings: null };
  const parsed = JSON.parse(raw) as BrowserData;
  if (!Array.isArray(parsed.materials) || !Array.isArray(parsed.cards)) throw new Error("浏览器存储格式损坏，请先导出数据再处理");
  return parsed;
}
/**
 * 写入浏览器体验库。
 *
 * 整个库只有一个 localStorage key，配额约 6 MB，超了 setItem 直接抛
 * QuotaExceededError——用户看到的是一串英文异常，还可能以为内容存住了。
 * 这里翻译成明确的中文提示，并带上「哪些内容没能存下」的线索。
 */
function browserWrite(data: BrowserData) {
  const payload = JSON.stringify(data);
  try {
    localStorage.setItem(browserKey, payload);
  } catch (err) {
    if (err instanceof DOMException && err.name === "QuotaExceededError") {
      const sizeMb = (payload.length / 1024 / 1024).toFixed(1);
      throw new Error(
        `浏览器存储已满（当前约 ${sizeMb} MB，上限约 6 MB），这次改动没能保存。` +
          "导出备份后清理内容，或改用桌面客户端——那边有完整的本机数据库。"
      );
    }
    throw err;
  }
}
export interface WorkspaceSnapshot { dir: string; materials: RawMaterial[]; cards: KnowledgeCard[]; file: SettingsFile; apiKey: string }
export async function readWorkspace(): Promise<WorkspaceSnapshot> {
  if (!inShell()) {
    const data = browserData();
    return { dir: "", ...data, file: parseSettings(data.settings), apiKey: sessionStorage.getItem("knowflick.workspace.key") || "" };
  }
  const snapshot = await loadStore();
  const cards: KnowledgeCard[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await dbLoadCards(snapshot.dir, 200, offset);
    cards.push(...page);
    if (page.length < 200) break;
  }
  return { dir: snapshot.dir, materials: await dbListMaterials(false, snapshot.dir, 10000), cards, file: parseSettings(snapshot.settings), apiKey: await readApiKey(snapshot.dir) };
}
export async function storeMaterial(material: RawMaterial, dir: string): Promise<void> {
  if (inShell()) { await dbSaveMaterial(material, dir); return; }
  const data = browserData();
  browserWrite({ ...data, materials: [material, ...data.materials.filter(m => m.id !== material.id)] });
}
export async function storeCard(card: KnowledgeCard, dir: string): Promise<void> {
  if (inShell()) { await dbUpsertCard(card, dir); return; }
  const data = browserData();
  browserWrite({ ...data, cards: [card, ...data.cards.filter(c => c.id !== card.id)] });
}
export async function storeCardList(cards: KnowledgeCard[], dir: string): Promise<void> {
  if (inShell()) { await invoke("db_replace_cards", { dir, cards }); return; }
  browserWrite({ ...browserData(), cards });
}
export async function storePreferences(file: SettingsFile, key: string, dir: string): Promise<void> {
  if (inShell()) { await saveSettings(dir, encodeSettings(file)); await writeApiKey(dir, key); return; }
  browserWrite({ ...browserData(), settings: encodeSettings(file) });
  sessionStorage.setItem("knowflick.workspace.key", key);
}
