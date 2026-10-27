import { contentHashOf } from "./contentHash";

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
export const MATERIAL_URI_SCHEME = "knowflick://material/";

/** 引用来源的种类：笔记或素材（R2「多来源引用」）。 */
export type ReferenceSourceKind = "note" | "material";

export interface NoteReference {
  /** 源 id（笔记 id 或素材 id）。 */
  noteId: string;
  /** 源标题（引用当时的快照）。 */
  title: string;
  /** 被引用的片段。 */
  excerpt: string;
  /** 来源种类。 */
  kind: ReferenceSourceKind;
  /** 引用时源内容的指纹——用来判断源是否已改过。 */
  fingerprint: string | null;
}

/** 引用指向的源（笔记或素材的统一形状）。 */
export interface ReferenceSource {
  id: string;
  title: string;
  bodyMd: string;
  kind: ReferenceSourceKind;
}

/** 引用行里允许的最大片段长度——太长会把原文淹没。 */
const MAX_EXCERPT = 160;

function normalizeExcerpt(excerpt: string): string {
  const flat = excerpt.replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_EXCERPT) return flat;
  return `${flat.slice(0, MAX_EXCERPT)}…`;
}

/** 引用片段：默认取正文开头（用户可在引用前先选段，这里给的是全文兜底）。 */
export function excerptOf(source: { bodyMd: string }, maxChars = MAX_EXCERPT): string {
  const body = source.bodyMd.replace(/^#+\s.*$/gm, "").trim();
  return normalizeExcerpt(body.slice(0, maxChars * 2));
}

/** 源 URI（笔记或素材）。 */
export function referenceUri(source: ReferenceSource): string {
  const scheme = source.kind === "material" ? MATERIAL_URI_SCHEME : NOTE_URI_SCHEME;
  return `${scheme}${source.id}`;
}

/** 引用时记录内容指纹——源后来改过就能看出来（指纹用内容哈希，不是密码学哈希）。 */
export function referenceFingerprint(source: ReferenceSource): string {
  return contentHashOf(source.bodyMd);
}

/**
 * 生成一条引用（不含首尾空行）。
 *
 * 链接上带 `?fp=<指纹>`：源后来被改过（指纹不同）就能提示「可能已过期」，
 * 源被删掉则是「引用已失效」——两种情况用户都需要知道（R2「矛盾与过期提示」）。
 */
export function noteReferenceLine(source: ReferenceSource, excerpt?: string): string {
  const title = source.title.trim() || (source.kind === "material" ? "无标题素材" : "无标题笔记");
  const body = normalizeExcerpt(excerpt ?? excerptOf(source));
  const fp = referenceFingerprint(source);
  const uri = `${referenceUri(source)}${fp ? `?fp=${fp}` : ""}`;
  return `> 《${title}》：${body}\n> [回原件](${uri})`;
}

/** 把一条引用插到正文的指定位置（默认末尾，前面留一个空行）。 */
export function applyNoteReference(bodyMd: string, source: ReferenceSource, excerpt?: string): string {
  const line = noteReferenceLine(source, excerpt);
  const trimmed = bodyMd.replace(/\s+$/, "");
  if (!trimmed) return line;
  return `${trimmed}\n\n${line}`;
}

/** 从正文里解析出全部引用（顺序与正文出现顺序一致）。 */
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
    if (!uri) continue;
    const parsed = parseReferenceUri(uri);
    if (!parsed) continue;
    out.push({
      noteId: parsed.id,
      title: m[1],
      excerpt: m[2].trim(),
      kind: parsed.kind,
      fingerprint: parsed.fingerprint,
    });
  }
  return out;
}

/** 解析引用 URI：`knowflick://note/<id>?fp=<指纹>`。 */
export function parseReferenceUri(
  uri: string
): { id: string; kind: ReferenceSourceKind; fingerprint: string | null } | null {
  const raw = uri.split("?")[0] ?? "";
  const fingerprint = uri.includes("?fp=") ? (uri.split("?fp=")[1] ?? "").trim() || null : null;
  if (raw.startsWith(NOTE_URI_SCHEME)) {
    const id = raw.slice(NOTE_URI_SCHEME.length);
    return id ? { id, kind: "note", fingerprint } : null;
  }
  if (raw.startsWith(MATERIAL_URI_SCHEME)) {
    const id = raw.slice(MATERIAL_URI_SCHEME.length);
    return id ? { id, kind: "material", fingerprint } : null;
  }
  return null;
}

/**
 * 引用状态（R2「矛盾与过期提示」）：
 * - `ok`：源还在，内容没变；
 * - `changed`：源还在但内容改过——引用可能已经过期，需要用户复核；
 * - `missing`：源不在库里了（被删）——引用已失效。
 */
export type ReferenceStatus = "ok" | "changed" | "missing";

export function referenceStatus(
  ref: NoteReference,
  sources: Map<string, ReferenceSource>
): ReferenceStatus {
  const source = sources.get(ref.noteId);
  if (!source) return "missing";
  if (!ref.fingerprint) return "ok";
  return referenceFingerprint(source) === ref.fingerprint ? "ok" : "changed";
}

/** 正文里是否引用了某篇笔记（反向链接判定的底座）。 */
export function referencesNote(bodyMd: string, noteId: string): boolean {
  return extractNoteReferences(bodyMd).some((r) => r.noteId === noteId);
}
