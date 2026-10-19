import type { KnowledgeCard } from "./card";
import type { RawMaterial } from "../shell/store";

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

export interface MarkdownFileItem {
  path: string;
  content: string;
}

function sanitizePathSegment(name: string): string {
  return name.replace(/[\\/:*?"<>|\r\n]/g, "_").trim().slice(0, 60) || "未命名";
}

/**
 * 将整库素材与卡片生成为分层 Markdown 文件体系（Obsidian 知识库结构）
 */
export function generateMarkdownVault(
  materials: RawMaterial[],
  cards: KnowledgeCard[]
): MarkdownFileItem[] {
  const items: MarkdownFileItem[] = [];

  // 卡片按分类作为文件夹
  for (const card of cards) {
    const category = sanitizePathSegment(card.category || "随手笔记");
    const filename = sanitizePathSegment(card.headline || card.id) + ".md";
    items.push({
      path: `${category}/${filename}`,
      content: cardToMarkdown(card),
    });
  }

  // 素材按收件箱/归档状态作为文件夹
  for (const mat of materials) {
    const folder = mat.inboxStatus === "inbox" ? "收件箱" : "归档素材";
    const filename = sanitizePathSegment(mat.title || mat.id) + ".md";
    const md = [
      "---",
      `id: "${mat.id}"`,
      `type: "raw_material"`,
      `source_type: "${mat.sourceType}"`,
      mat.sourceUrl ? `source_url: "${mat.sourceUrl}"` : null,
      `created_at: "${new Date(mat.createdAt).toISOString()}"`,
      `updated_at: "${new Date(mat.updatedAt).toISOString()}"`,
      "---",
      "",
      `# ${mat.title}`,
      "",
      mat.rawText,
    ]
      .filter((l): l is string => l !== null)
      .join("\n");

    items.push({
      path: `${folder}/${filename}`,
      content: md,
    });
  }

  return items;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 纯客户端创建标准 ZIP 压缩包 (Store 规范)
 */
export function createZipArchive(
  files: Array<{ path: string; data: Uint8Array | string }>
): Uint8Array {
  const encoder = new TextEncoder();
  const fileEntries: Array<{
    pathBytes: Uint8Array;
    dataBytes: Uint8Array;
    crc: number;
    offset: number;
  }> = [];

  let totalLocalSize = 0;

  for (const f of files) {
    const pathBytes = encoder.encode(f.path);
    const dataBytes = typeof f.data === "string" ? encoder.encode(f.data) : f.data;
    const crc = crc32(dataBytes);
    fileEntries.push({
      pathBytes,
      dataBytes,
      crc,
      offset: totalLocalSize,
    });
    // 30 bytes header + pathLen + dataLen
    totalLocalSize += 30 + pathBytes.length + dataBytes.length;
  }

  let centralDirSize = 0;
  for (const entry of fileEntries) {
    // 46 bytes central header + pathLen
    centralDirSize += 46 + entry.pathBytes.length;
  }

  // 22 bytes EOCD
  const totalZipSize = totalLocalSize + centralDirSize + 22;
  const buffer = new Uint8Array(totalZipSize);
  const view = new DataView(buffer.buffer);
  let pos = 0;

  // 1. 写入 Local File Headers & Data
  for (const entry of fileEntries) {
    view.setUint32(pos, 0x04034b50, true); // Local header signature
    view.setUint16(pos + 4, 20, true);     // Version needed (2.0)
    view.setUint16(pos + 6, 0x0800, true); // UTF-8 filename flag
    view.setUint16(pos + 8, 0, true);      // Compression: Store (0)
    view.setUint16(pos + 10, 0, true);     // Mod time
    view.setUint16(pos + 12, 0, true);     // Mod date
    view.setUint32(pos + 14, entry.crc, true); // CRC32
    view.setUint32(pos + 18, entry.dataBytes.length, true); // Compressed size
    view.setUint32(pos + 22, entry.dataBytes.length, true); // Uncompressed size
    view.setUint16(pos + 26, entry.pathBytes.length, true); // Filename length
    view.setUint16(pos + 28, 0, true);      // Extra field length
    pos += 30;

    buffer.set(entry.pathBytes, pos);
    pos += entry.pathBytes.length;

    buffer.set(entry.dataBytes, pos);
    pos += entry.dataBytes.length;
  }

  const centralDirOffset = pos;

  // 2. 写入 Central Directory Headers
  for (const entry of fileEntries) {
    view.setUint32(pos, 0x02014b50, true); // Central directory signature
    view.setUint16(pos + 4, 20, true);     // Version made by
    view.setUint16(pos + 6, 20, true);     // Version needed
    view.setUint16(pos + 8, 0x0800, true); // UTF-8 flag
    view.setUint16(pos + 10, 0, true);     // Compression: Store
    view.setUint16(pos + 12, 0, true);     // Mod time
    view.setUint16(pos + 14, 0, true);     // Mod date
    view.setUint32(pos + 16, entry.crc, true); // CRC32
    view.setUint32(pos + 20, entry.dataBytes.length, true); // Compressed size
    view.setUint32(pos + 24, entry.dataBytes.length, true); // Uncompressed size
    view.setUint16(pos + 28, entry.pathBytes.length, true); // Filename length
    view.setUint16(pos + 30, 0, true);     // Extra field length
    view.setUint16(pos + 32, 0, true);     // Comment length
    view.setUint16(pos + 34, 0, true);     // Disk start
    view.setUint16(pos + 36, 0, true);     // Internal file attributes
    view.setUint32(pos + 38, 0, true);     // External file attributes
    view.setUint32(pos + 42, entry.offset, true); // Local header offset
    pos += 46;

    buffer.set(entry.pathBytes, pos);
    pos += entry.pathBytes.length;
  }

  // 3. 写入 End of Central Directory (EOCD)
  view.setUint32(pos, 0x06054b50, true); // EOCD signature
  view.setUint16(pos + 4, 0, true);      // Disk number
  view.setUint16(pos + 6, 0, true);      // Start disk
  view.setUint16(pos + 8, fileEntries.length, true);  // Number of entries on disk
  view.setUint16(pos + 10, fileEntries.length, true); // Total entries
  view.setUint32(pos + 12, centralDirSize, true);     // Central dir size
  view.setUint32(pos + 16, centralDirOffset, true);   // Central dir offset
  view.setUint16(pos + 20, 0, true);                  // Comment length

  return buffer;
}

/**
 * 触发下载带 YAML Frontmatter 的 Markdown 知识库压缩包
 */
export function downloadMarkdownVault(
  materials: RawMaterial[],
  cards: KnowledgeCard[]
) {
  const vaultItems = generateMarkdownVault(materials, cards);
  const zipBytes = createZipArchive(vaultItems.map((item) => ({ path: item.path, data: item.content })));
  const blob = new Blob([zipBytes as unknown as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `knowflick-markdown-vault-${new Date().toISOString().slice(0, 10)}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
