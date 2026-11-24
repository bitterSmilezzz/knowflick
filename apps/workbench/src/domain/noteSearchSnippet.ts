/**
 * 搜索结果片段（R1）：列表里显示**命中的那一段**，而不是正文开头。
 *
 * 以前搜「成本」时，预览永远显示正文前 60 字——命中在后面就完全看不出来为什么这篇被搜到。
 * 这里给出命中位置的上下文，并把命中的词单独切出来给界面高亮。
 */

export interface SearchSnippet {
  /** 命中词之前的一小段（可能是空串）。 */
  before: string;
  /** 命中的原文（保留原始大小写，高亮要用它）。 */
  match: string;
  /** 命中词之后的一小段。 */
  after: string;
}

const DEFAULT_RADIUS = 40;

function flatten(text: string): string {
  return text.replace(/\s+/g, " " ).trim();
}

/**
 * 取命中片段；没有命中返回 null（调用方回落到普通预览）。
 *
 * 大小写不敏感匹配，但**返回原文**——高亮要显示用户真正写的那个词。
 */
export function snippetFor(body: string, query: string, radius = DEFAULT_RADIUS): SearchSnippet | null {
  const q = query.trim();
  if (!q) return null;
  const flat = flatten(body);
  const at = flat.toLowerCase().indexOf(q.toLowerCase());
  if (at === -1) return null;
  const from = Math.max(0, at - radius);
  const to = Math.min(flat.length, at + q.length + radius);
  return {
    before: (from > 0 ? "…" : "") + flat.slice(from, at),
    match: flat.slice(at, at + q.length),
    after: flat.slice(at + q.length, to) + (to < flat.length ? "…" : ""),
  };
}
