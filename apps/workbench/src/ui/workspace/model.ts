import { cardFromJson, type KnowledgeCard } from "../../domain/card";
import type { RawMaterial } from "../../shell/store";

export type Collection = "inbox" | "library" | "favorites" | "archive";
export type Entry = { id: string; kind: "material" | "card"; title: string; text: string; category: string; tags: string[]; date: number; url: string; original: RawMaterial | KnowledgeCard };
export const collectionNames: Record<Collection, string> = { inbox: "收件箱", library: "全部知识", favorites: "收藏", archive: "已归档" };
export function entriesFor(materials: RawMaterial[], cards: KnowledgeCard[], collection: Collection): Entry[] {
  const materialEntries: Entry[] = materials.filter(m => collection === "inbox" ? m.inboxStatus === "inbox" : collection === "archive" ? m.inboxStatus !== "inbox" : true).map(m => ({ id: m.id, kind: "material", title: m.title, text: m.rawText, category: m.sourceType === "web" ? "网页剪藏" : m.sourceType === "document" ? "导入文档" : "闪念", tags: [], date: m.updatedAt, url: m.sourceUrl || "", original: m }));
  const cardEntries: Entry[] = cards.filter(c => collection !== "favorites" || c.isFavorite).map(c => ({ id: c.id, kind: "card", title: c.headline, text: c.details, category: c.category || "未分类", tags: c.tags || [], date: c.editedAt || c.createdAt, url: c.links[0]?.url || "", original: c }));
  return (collection === "favorites" ? cardEntries : collection === "inbox" || collection === "archive" ? materialEntries : [...materialEntries, ...cardEntries]).sort((a, b) => b.date - a.date || a.id.localeCompare(b.id));
}
export function filterEntries(entries: Entry[], query: string, tag = "", source = "all"): Entry[] {
  const tokens = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return entries.filter(e => (!tag || e.category === tag || e.tags.includes(tag)) && (source === "all" || (source === "card" ? e.kind === "card" : e.kind === "material")) && tokens.every(t => `${e.title}\n${e.text}\n${e.category}\n${e.tags.join(" ")}\n${e.url}`.toLocaleLowerCase().includes(t)));
}
export function makeMaterial(input: { title: string; text: string; url: string }): RawMaterial {
  const text = input.text.trim();
  if (!text) throw new Error("请填写正文后再保存");
  const url = input.url.trim() || (/^https?:\/\/\S+$/.test(text) ? text : "");
  if (url) {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("来源链接须为不含账号密码的 http/https 地址");
  }
  const now = Date.now();
  return { id: crypto.randomUUID(), sourceType: url ? "web" : "manual", title: input.title.trim() || text.split("\n")[0].slice(0, 80), rawText: text, sourceUrl: url || null, cleanedMarkdown: null, contentHash: "", mediaPath: null, mediaSizeBytes: 0, metadataJson: "{}", inboxStatus: "inbox", createdAt: now, updatedAt: now };
}
export function materialToCard(m: RawMaterial): KnowledgeCard {
  return { ...cardFromJson({ id: crypto.randomUUID(), headline: m.title, category: "随手笔记", summary: m.rawText.slice(0, 160), details: m.rawText, source: "imported", createdAt: Date.now(), links: m.sourceUrl ? [{ title: "原始来源", url: m.sourceUrl }] : [] }), materialId: m.id, tags: [] };
}
