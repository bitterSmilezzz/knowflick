import React from "react";

/**
 * 在文本中精准高亮检索关键词
 */
export function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim() || !text) return text;
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return text;

  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);

  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="ws-highlight">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

/**
 * 根据检索关键词提取最相关的上下文摘要片段（智能定位关键词所在位置）
 */
export function extractSnippet(text: string, query: string, maxLength = 70): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  if (!query.trim() || clean.length <= maxLength) return clean.slice(0, maxLength);

  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  let bestIndex = -1;
  const lower = clean.toLowerCase();

  for (const token of tokens) {
    const idx = lower.indexOf(token);
    if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) {
      bestIndex = idx;
    }
  }

  if (bestIndex === -1) {
    return clean.slice(0, maxLength);
  }

  // 居中展示关键词
  const half = Math.floor(maxLength / 2);
  let start = Math.max(0, bestIndex - half);
  let end = Math.min(clean.length, start + maxLength);
  if (end - start < maxLength) {
    start = Math.max(0, end - maxLength);
  }

  const prefix = start > 0 ? "…" : "";
  const suffix = end < clean.length ? "…" : "";
  return `${prefix}${clean.slice(start, end).trim()}${suffix}`;
}
