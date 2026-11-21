import { cardFromJson, type KnowledgeCard, type ScienceLink } from "./card";

const ORDER_PREFIX = /^\d{1,3}\.\s+/;

function fenceMarker(line: string): string | null {
  if (line.startsWith("```")) return "```";
  if (line.startsWith("~~~")) return "~~~";
  return null;
}

function cleanHeadline(raw: string): string {
  let text = raw.trim();
  while (text.startsWith("#")) text = text.slice(1).trim();
  return text.replace(ORDER_PREFIX, "").trim();
}

function isBullet(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("-") || trimmed.startsWith("*") || trimmed.startsWith("•") || trimmed.startsWith("+");
}

function metadataValue(line: string, key: string): string {
  return line.slice(key.length).trim().replace(/^["'`\[]+|["'`\]]+$/g, "");
}

function categoryFromLine(line: string): string | null {
  const open = line.indexOf("[[");
  const close = line.indexOf("]]");
  if (open >= 0 && close > open + 2) {
    const category = line.slice(open + 2, close).trim();
    if (category) return category;
  }
  const first = line.indexOf("`");
  const last = line.lastIndexOf("`");
  if (first >= 0 && last > first) {
    const category = line.slice(first + 1, last).trim();
    if (category) return category;
  }
  return null;
}

function markdownLink(line: string): ScienceLink | null {
  const openBracket = line.indexOf("[");
  const closeBracket = line.indexOf("]");
  const openParen = line.indexOf("(");
  const closeParen = line.indexOf(")");
  if (openBracket < 0 || closeBracket < 0 || openParen < 0 || closeParen < 0) return null;
  if (!(openBracket < closeBracket && closeBracket < openParen && openParen < closeParen)) return null;
  const title = line.slice(openBracket + 1, closeBracket);
  const url = line.slice(openParen + 1, closeParen);
  if (!title || !(url.startsWith("http://") || url.startsWith("https://"))) return null;
  return { title, url };
}

function splitByHeadings(text: string): string[] {
  const lines = text.split("\n");
  const headings: Array<[number, number]> = [];
  let fence: string | null = null;
  let frontmatter = false;
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "---" && (index === 0 || frontmatter)) {
      frontmatter = !frontmatter;
      return;
    }
    if (frontmatter) return;
    const marker = fenceMarker(trimmed);
    if (marker) {
      fence = fence === null ? marker : fence === marker ? null : fence;
      return;
    }
    if (fence) return;
    const depth = trimmed.match(/^#+/)?.[0].length ?? 0;
    if (depth >= 1 && depth <= 6 && trimmed.slice(depth).startsWith(" ")) headings.push([index, depth]);
  });
  const depth = headings.reduce<number | null>((min, item) => (min === null || item[1] < min ? item[1] : min), null);
  if (depth === null) return [text];
  const boundaries = headings.filter((item) => item[1] === depth).slice(1).map((item) => item[0]);
  const sections: string[] = [];
  let start = 0;
  for (const boundary of boundaries) {
    sections.push(lines.slice(start, boundary).join("\n"));
    start = boundary;
  }
  sections.push(lines.slice(start).join("\n"));
  return sections;
}

interface FileFrontmatter {
  category?: string;
  tags: string[];
}

/** 取文件开头的 frontmatter（如果有）。 */
function extractFileFrontmatter(text: string): FileFrontmatter {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return { tags: [] };
  const meta: FileFrontmatter = { tags: [] };
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "---") break;
    if (line.startsWith("category:")) meta.category = metadataValue(line, "category:");
    if (line.startsWith("tags:")) {
      const raw = metadataValue(line, "tags:");
      meta.tags = raw.replace(/^\[|\]$/g, "").split(/[,，]/).map((t) => t.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    }
  }
  return meta;
}

/** 把文件级 frontmatter 补到某一段的前面，好让 parseSection 能读到。 */
function applyFileMeta(section: string, meta: FileFrontmatter): string {
  if (!meta.category && meta.tags.length === 0) return section;
  const lines = [
    "---",
    ...(meta.category ? [`category: ${meta.category}`] : []),
    ...(meta.tags.length ? [`tags: [${meta.tags.join(", ")}]`] : []),
    "---",
    "",
  ];
  return lines.join("\n") + section;
}

function parseSection(sectionText: string, defaultCategory: string, now: number): KnowledgeCard | null {
  const lines = sectionText.split("\n");
  let category = defaultCategory;
  let headline = "";
  let summary = "";
  let sectionTags: string[] = [];
  const detailLines: string[] = [];
  const links: ScienceLink[] = [];
  let inFrontmatter = false;
  let frontmatterChecked = false;
  let fence: string | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const marker = fenceMarker(line);
    if (marker) {
      fence = fence === null ? marker : fence === marker ? null : fence;
      detailLines.push(rawLine);
      continue;
    }
    if (fence) {
      detailLines.push(rawLine);
      continue;
    }
    if (!line) continue;
    if (line === "---" && !frontmatterChecked) {
      inFrontmatter = !inFrontmatter;
      if (!inFrontmatter) frontmatterChecked = true;
      continue;
    }
    if (inFrontmatter) {
      if (line.startsWith("category:")) category = metadataValue(line, "category:");
      if (line.startsWith("tags:")) {
        // frontmatter 里的标签原本被静默丢弃——写了却没生效。
        const raw = metadataValue(line, "tags:");
        sectionTags = raw.replace(/^\[|\]$/g, "").split(/[,，]/).map((t) => t.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      }
      if (line.startsWith("title:") || line.startsWith("headline:")) {
        headline = metadataValue(line, line.startsWith("title:") ? "title:" : "headline:");
      }
      continue;
    }
    if ((line.includes("领域") || line.includes("分类"))) {
      const extracted = categoryFromLine(line);
      if (extracted) {
        category = extracted;
        continue;
      }
    }
    if (!headline && (line.startsWith("#") || line.startsWith("【") || (line.includes("：") && !isBullet(line)))) {
      const cleaned = cleanHeadline(line);
      if (cleaned) {
        headline = cleaned;
        continue;
      }
    }
    if (line.startsWith(">")) {
      const quote = line.slice(1).trim();
      if (quote.startsWith("**核心观点**")) continue;
      summary = summary ? `${summary} ${quote}` : quote;
      continue;
    }
    const link = markdownLink(line);
    if (link) links.push(link);
    if (line !== "**深入剖析**" && line !== "## 深入剖析" && line !== "**延伸阅读**") detailLines.push(line);
  }
  if (!headline || headline === "---") {
    const first = lines.find((line) => line !== "---" && cleanHeadline(line));
    if (first) {
      headline = cleanHeadline(first);
      const index = detailLines.indexOf(first);
      if (index >= 0) detailLines.splice(index, 1);
    }
  }
  if (!summary) summary = detailLines.shift() ?? headline;
  if (!headline) return null;
  const details = detailLines.join("\n");
  return {
    id: crypto.randomUUID().toUpperCase(),
    category,
    headline,
    summary,
    details: details || summary,
    links,
    tags: sectionTags,
    source: "imported",
    createdAt: now,
    editedAt: null,
    seenAt: null,
    swiped: null,
    isFavorite: false,
    favoritedAt: null,
    reviewCount: 0,
    masteryLevel: 0,
    lastReviewedAt: null,
    repetition: 0,
    intervalDays: 1,
    easeFactor: 2.5,
    stability: 0,
    difficulty: 0,
    subject: null,
    branch: null,
    level: null,
    track: null,
    orderKey: null,
    prereq: [],
  };
}

export function parseMarkdownNotes(text: string, defaultCategory = "随手笔记", now = Date.now()): KnowledgeCard[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const rawLines = trimmed.split("\n");
  const cardSections: string[] = [];
  let current: string[] = [];
  let inFrontmatter = false;
  let fence: string | null = null;
  rawLines.forEach((line, index) => {
    const t = line.trim();
    const marker = fenceMarker(t);
    if (marker) {
      fence = fence === null ? marker : fence === marker ? null : fence;
      current.push(line);
      return;
    }
    if (fence) {
      current.push(line);
      return;
    }
    if (t === "---" || t === "***" || t === "___") {
      const nextLine = rawLines.slice(index + 1).find((item) => item.trim()) ?? "";
      const metadataStarts = t === "---" && current.every((item) => !item.trim()) && /^\s*[A-Za-z_][\w-]*\s*:/.test(nextLine);
      if (inFrontmatter) {
        inFrontmatter = false;
        current.push(line);
      } else if (metadataStarts) {
        inFrontmatter = true;
        current.push(line);
      } else {
        if (current.some((item) => item.trim())) cardSections.push(current.join("\n"));
        current = [];
      }
    } else {
      current.push(line);
    }
  });
  if (current.length) cardSections.push(current.join("\n"));
  const sections = cardSections.length <= 1
    ? (() => {
        const byHeadings = splitByHeadings(trimmed);
        return byHeadings.length > 1 ? byHeadings : cardSections;
      })()
    : cardSections;

  // 文件级 frontmatter（分类/标签）只写在文件开头那一段里。拆成多张卡时，
  // 后面那些段就丢了分类与标签——同一篇笔记拆出来的卡应当属于同一类。
  const fileMeta = extractFileFrontmatter(trimmed);
  return sections.flatMap((section, index) => {
    const card = parseSection(index === 0 ? section : applyFileMeta(section, fileMeta), defaultCategory, now);
    if (!card) return [];
    if (index === 0) return [card];
    // frontmatter 里显式写过的分类/标签优先，没写才用文件级的。
    return [{
      ...card,
      category: card.category === defaultCategory && fileMeta.category ? fileMeta.category : card.category,
      tags: (card.tags ?? []).length ? (card.tags ?? []) : fileMeta.tags,
    }];
  });
}

export function parseNotesFile(text: string, fileName = ""): KnowledgeCard[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const jsonLike = fileName.toLowerCase().endsWith(".json") || trimmed.startsWith("{") || trimmed.startsWith("[");
  if (!jsonLike) return parseMarkdownNotes(text);
  const root = JSON.parse(text) as unknown;
  const list = Array.isArray(root)
    ? root
    : root && typeof root === "object" && Array.isArray((root as { cards?: unknown }).cards)
      ? (root as { cards: unknown[] }).cards
      : [];
  return list.flatMap((item) => {
    try {
      return [cardFromJson(item)];
    } catch {
      return [];
    }
  });
}
