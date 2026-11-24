import { NOTE_URI_SCHEME, referencesNote } from "./noteReference";

/**
 * 反向链接（B04 关联）：哪几篇笔记引用了当前这篇。
 *
 * 正向引用早就有（正文里的 `> 《标题》：片段` + `knowflick://note/<id>` 回原件行），
 * 但用户站在被引用的那篇上时看不到「谁引用了我」——这就是这里补的东西。
 *
 * 只认**未删除**的笔记：回收站里的笔记引用不算数（它自己都搜不到了）。
 * 归档笔记的引用默认**算**：归档只是收起，引用关系还在，藏起来会让用户以为引用丢了。
 */

export interface NoteBacklink {
  /** 引用者的笔记 id。 */
  noteId: string;
  title: string;
  /** 引用处附近的一小段文字，方便判断「引用的是哪一句」。 */
  snippet: string;
  /** 引用者是否已归档（界面可据此标注）。 */
  archived: boolean;
}

interface BacklinkCandidate {
  id: string;
  title: string;
  bodyMd: string;
  isDeleted?: boolean;
  archivedAt?: number | null;
}

const SNIPPET_BEFORE = 60;
const SNIPPET_AFTER = 60;

/** 取引用链接那一行前后的上下文，压成一行。 */
function snippetAround(bodyMd: string, targetId: string): string {
  const uri = `${NOTE_URI_SCHEME}${targetId}`;
  const at = bodyMd.indexOf(uri);
  if (at === -1) return "";
  const from = Math.max(0, at - SNIPPET_BEFORE);
  const to = Math.min(bodyMd.length, at + uri.length + SNIPPET_AFTER);
  return bodyMd.slice(from, to).replace(/\s+/g, " ").trim();
}

export function findBacklinks(
  notes: readonly BacklinkCandidate[],
  targetId: string,
): NoteBacklink[] {
  const out: NoteBacklink[] = [];
  for (const note of notes) {
    if (note.id === targetId) continue;
    if (note.isDeleted) continue;
    // 正文里出现这个 id 的链接才算引用——只在文字里提到 id 不算。
    if (!referencesNote(note.bodyMd, targetId)) continue;
    out.push({
      noteId: note.id,
      title: note.title || "无标题笔记",
      snippet: snippetAround(note.bodyMd, targetId),
      archived: (note.archivedAt ?? null) !== null,
    });
  }
  // 标题排序：同一篇的引用关系不随笔记顺序跳动。
  return out.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
}
