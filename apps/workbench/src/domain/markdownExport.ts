import type { KnowledgeCard } from "./card";

/**
 * 将 KnowledgeCard 序列化为带 YAML Frontmatter 的标准化 Markdown 格式
 * 保证导出的文件在 Obsidian、Logseq、Typora 等外部笔记软件中可完美解析
 */
export function cardToMarkdown(card: KnowledgeCard): string {
  const frontmatterLines: string[] = [
    "---",
    `id: "${card.id}"`,
    `category: "${card.category || "未分类"}"`,
    `headline: "${card.headline.replace(/"/g, '\\"')}"`,
    `source: "${card.source}"`,
    `created_at: "${new Date(card.createdAt).toISOString()}"`,
    `is_favorite: ${card.isFavorite}`,
    `review_count: ${card.reviewCount}`,
    `interval_days: ${card.intervalDays}`,
  ];

  if (card.tags && card.tags.length > 0) {
    frontmatterLines.push(`tags: [${card.tags.map((t: string) => `"${t}"`).join(", ")}]`);
  }

  if (card.links && card.links.length > 0) {
    frontmatterLines.push(`source_url: "${card.links[0].url}"`);
  }

  frontmatterLines.push("---");

  const bodyLines: string[] = [
    frontmatterLines.join("\n"),
    "",
    `# ${card.headline}`,
    "",
    `> **摘要**：${card.summary}`,
    "",
    "## 核心内容",
    "",
    card.details,
  ];

  if (card.links && card.links.length > 0) {
    bodyLines.push("", "## 参考与拓展链接", "");
    for (const link of card.links) {
      bodyLines.push(`- [${link.title || link.url}](${link.url})`);
    }
  }

  return bodyLines.join("\n");
}

/**
 * 从导出的 Markdown 文本反向解析恢复出卡片核心字段（往返无损保障）
 */
export function markdownToCardPartial(md: string): Partial<KnowledgeCard> | null {
  const match = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const yamlPart = match[1];
  const bodyPart = match[2];

  const getYamlVal = (key: string): string | null => {
    const r = new RegExp(`^${key}:\\s*(?:"(.*)"|(.*))$`, "m");
    const m = yamlPart.match(r);
    return m ? (m[1] || m[2] || "").trim() : null;
  };

  const id = getYamlVal("id");
  const category = getYamlVal("category") || "未分类";
  const headline = getYamlVal("headline") || "";
  const source = (getYamlVal("source") as KnowledgeCard["source"]) || "imported";

  // 提取正文
  const detailsMatch = bodyPart.match(/## 核心内容\n\n([\s\S]*?)(?:\n\n## 参考与拓展链接|$)/);
  const details = detailsMatch ? detailsMatch[1].trim() : "";

  // 提取摘要
  const summaryMatch = bodyPart.match(/> \*\*摘要\*\*：(.*)/);
  const summary = summaryMatch ? summaryMatch[1].trim() : "";

  if (!id || !headline) return null;

  return {
    id,
    category,
    headline,
    summary,
    details,
    source,
  };
}
