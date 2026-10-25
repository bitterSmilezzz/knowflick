import type { Note } from "./note";

/**
 * 笔记之间的引用（B04 关联 / G01 增量，R2）。
 *
 * 契约要点：
 * - **可回原件**：每条引用都带源笔记的 id（`knowflick://note/<id>`），
 *   源笔记改名或删除都不破坏引用（id 不变）；源笔记被删时引用要能被识别为失效。
 * - **可读**：引用行是普通 Markdown 引用块，纯文本阅读器也读得懂。
 * - **可解析**：能从一个笔记正文里把引用解析回结构化条目（反向链接的基础）。
 *
 * 格式（两行，第二行是原件链接）：
 *
 *     > 《源笔记标题》：被引用的片段……
 *     > [回原件](knowflick://note/note-id)
 */

export const NOTE_URI_SCHEME = "knowflick://note/";

export interface NoteReference {
  /** 源笔记 id。 */
  noteId: string;
  /** 源笔记标题（引用当时的快照）。 */
  title: string;
  /** 被引用的片段。 */
  excerpt: string;
}

/** 引用行里允许的最大片段长度——太长会把原文淹没。 */
const MAX_EXCERPT = 160;

function normalizeExcerpt(excerpt: string): string {
  const flat = excerpt.replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_EXCERPT) return flat;
  return `${flat.slice(0, MAX_EXCERPT)}…`;
}

/** 引用片段：默认取正文开头（用户可在引用前先选段，这里给的是全文兜底）。 */
export function excerptOf(note: Note, maxChars = MAX_EXCERPT): string {
  const body = note.bodyMd.replace(/^#+\s.*$/gm, "").trim();
  return normalizeExcerpt(body.slice(0, maxChars * 2));
}

/** 生成一条引用（不含首尾空行）。 */
export function noteReferenceLine(source: Note, excerpt?: string): string {
  const title = source.title.trim() || "无标题笔记";
  const body = normalizeExcerpt(excerpt ?? excerptOf(source));
  return `> 《${title}》：${body}\n> [回原件](${NOTE_URI_SCHEME}${source.id})`;
}

/** 把一条引用插到正文的指定位置（默认末尾，前面留一个空行）。 */
export function applyNoteReference(bodyMd: string, source: Note, excerpt?: string): string {
  const line = noteReferenceLine(source, excerpt);
  const trimmed = bodyMd.replace(/\s+$/, "");
  if (!trimmed) return line;
  return `${trimmed}\n\n${line}`;
}

/** 从正文里解析出全部笔记引用（顺序与正文出现顺序一致）。 */
export function extractNoteReferences(bodyMd: string): NoteReference[] {
  const out: NoteReference[] = [];
  const lines = bodyMd.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const quote = /^>\s*(.*)$/.exec(lines[i]);
    if (!quote) continue;
    const text = quote[1].trim();
    const m = /^《(.+?)》：(.*)$/.exec(text);
    if (!m) continue;
    // 下一行（或同块里的下一行）应当是回原件链接
    let uri: string | null = null;
    for (let j = i + 1; j < lines.length && j <= i + 2; j++) {
      const link = /^>\s*\[回原件\]\((.*)\)\s*$/.exec(lines[j] ?? "");
      if (link) {
        uri = link[1];
        break;
      }
      if (!/^>\s*/.test(lines[j] ?? "")) break;
    }
    if (!uri || !uri.startsWith(NOTE_URI_SCHEME)) continue;
    out.push({ noteId: uri.slice(NOTE_URI_SCHEME.length), title: m[1], excerpt: m[2].trim() });
  }
  return out;
}

/** 正文里是否引用了某篇笔记（反向链接判定的底座）。 */
export function referencesNote(bodyMd: string, noteId: string): boolean {
  return extractNoteReferences(bodyMd).some((r) => r.noteId === noteId);
}
