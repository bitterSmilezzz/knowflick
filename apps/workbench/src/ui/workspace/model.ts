import { cardFromJson, type KnowledgeCard } from "../../domain/card";
import { contentHashOf } from "../../domain/contentHash";
import type { RawMaterial } from "../../shell/store";

export type Collection = "inbox" | "library" | "favorites" | "archive";
export type Entry = { id: string; kind: "material" | "card"; title: string; text: string; searchText?: string; category: string; tags: string[]; date: number; url: string; original: RawMaterial | KnowledgeCard };
export const collectionNames: Record<Collection, string> = { inbox: "收件箱", library: "全部知识", favorites: "收藏", archive: "已归档" };
/**
 * 素材的可搜索文本。
 *
 * 只搜 rawText 会漏掉用户真正会用来找它的东西：邮件的发件人、附件名，
 * 图片的文件名。这些都在 metadataJson 里，统一摊平进搜索文本。
 */
function materialSearchText(m: RawMaterial): string {
  const parts = [m.rawText];
  if (m.cleanedMarkdown) parts.push(m.cleanedMarkdown);
  if (m.metadataJson && m.metadataJson !== "{}") {
    try {
      const meta = JSON.parse(m.metadataJson) as Record<string, unknown>;
      for (const key of ["from", "to", "subject", "fileName", "mime"]) {
        const value = meta[key];
        if (typeof value === "string") parts.push(value);
      }
      const attachments = meta.attachmentFilenames;
      if (Array.isArray(attachments)) {
        for (const name of attachments) if (typeof name === "string") parts.push(name);
      }
    } catch {
      // 坏元数据不该让整条素材搜不到，退回只搜正文。
    }
  }
  return parts.join("\n");
}

/** 卡片的可搜索文本：摘要与全部链接都要能搜到。 */
function cardSearchText(c: KnowledgeCard): string {
  const links = (c.links || []).map(link => `${link.title} ${link.url}`);
  return [c.summary, c.details, ...links].filter(Boolean).join("\n");
}

export function entriesFor(materials: RawMaterial[], cards: KnowledgeCard[], collection: Collection): Entry[] {
  const materialEntries: Entry[] = materials.filter(m => collection === "inbox" ? m.inboxStatus === "inbox" : collection === "archive" ? m.inboxStatus !== "inbox" : true).map(m => ({ id: m.id, kind: "material", title: m.title, text: m.rawText, searchText: materialSearchText(m), category: m.sourceType === "email" ? "邮件" : m.sourceType === "email-digest" ? "邮件归纳" : m.sourceType === "web" ? "网页剪藏" : m.sourceType === "document" ? "导入文档" : m.sourceType === "image" ? "图片" : m.sourceType === "audio" ? "语音笔记" : m.sourceType === "ink" ? "手写笔记" : "闪念", tags: [], date: m.updatedAt, url: m.sourceUrl || "", original: m }));
  const cardEntries: Entry[] = cards.filter(c => collection !== "favorites" || c.isFavorite).map(c => ({ id: c.id, kind: "card", title: c.headline, text: c.details, searchText: cardSearchText(c), category: c.category || "未分类", tags: c.tags || [], date: c.editedAt || c.createdAt, url: c.links[0]?.url || "", original: c }));
  return (collection === "favorites" ? cardEntries : collection === "inbox" || collection === "archive" ? materialEntries : [...materialEntries, ...cardEntries]).sort((a, b) => b.date - a.date || a.id.localeCompare(b.id));
}
/**
 * 过滤当前集合的条目。
 *
 * `indexedIds` 是可选的 SQLite FTS5 命中集合：桌面端在查询非空时会去查持久化全文索引，
 * 命中的素材 id 传进来。这样两件事同时成立——
 * 索引能召回内存子串匹配漏掉的条目（FTS5 的分词/前缀与 `includes` 并不等价），
 * 而索引查询失败时传空集就退回纯内存匹配，功能不会因为索引缺位而消失。
 */
export function filterEntries(
  entries: Entry[],
  query: string,
  tag = "",
  source = "all",
  indexedIds: ReadonlySet<string> = new Set()
): Entry[] {
  const tokens = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const useIndex = tokens.length > 0 && indexedIds.size > 0;
  return entries.filter(e => {
    if (tag && !(e.category === tag || e.tags.includes(tag))) return false;
    if (source !== "all" && !(source === "card" ? e.kind === "card" : e.kind === "material")) return false;
    if (useIndex && e.kind === "material" && indexedIds.has(e.id)) return true;
    return tokens.every(t => `${e.title}\n${e.searchText ?? e.text}\n${e.category}\n${e.tags.join(" ")}\n${e.url}`.toLocaleLowerCase().includes(t));
  });
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
  return { id: crypto.randomUUID(), sourceType: url ? "web" : "manual", title: input.title.trim() || text.split("\n")[0].slice(0, 80), rawText: text, sourceUrl: url || null, cleanedMarkdown: null, contentHash: contentHashOf(text), mediaPath: null, mediaSizeBytes: 0, metadataJson: "{}", inboxStatus: "inbox", createdAt: now, updatedAt: now };
}
export function materialToCard(m: RawMaterial): KnowledgeCard {
  return { ...cardFromJson({ id: crypto.randomUUID(), headline: m.title, category: "随手笔记", summary: m.rawText.slice(0, 160), details: m.rawText, source: "imported", createdAt: Date.now(), links: m.sourceUrl ? [{ title: "原始来源", url: m.sourceUrl }] : [] }), materialId: m.id, tags: [] };
}
