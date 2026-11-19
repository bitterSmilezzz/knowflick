/**
 * 跨笔记批量替换（B01 收尾）。
 *
 * 单篇的查找替换早就有；改一个术语（「知识库」→「库」）要挨篇点开 20 次，是真实的痛点。
 *
 * 这里只做**规则**：哪些笔记要改、改成什么、改了几处。真正落库由调用方走正常的
 * 保存路径（每篇都是一次修订，可回退）——批量替换不该绕过修订历史。
 */

import { replaceAllMatches } from "./noteFind";

export interface BulkReplaceNote {
  id: string;
  title: string;
  bodyMd: string;
  isDeleted?: boolean;
}

export interface BulkReplaceHit {
  id: string;
  title: string;
  count: number;
  /** 改后的正文（调用方直接拿去保存）。 */
  body: string;
}

/**
 * 在未删除的笔记里替换全部匹配。
 *
 * 只返回**真的有改动**的笔记：没命中的不出现，界面才能如实说「改了 N 篇」。
 * 回收站里的笔记不参与（用户看不到它们，改了也不会发现）。
 */
export function planBulkReplace(
  notes: readonly BulkReplaceNote[],
  query: string,
  replacement: string,
): BulkReplaceHit[] {
  const q = query.trim();
  if (!q) return [];
  const hits: BulkReplaceHit[] = [];
  for (const note of notes) {
    if (note.isDeleted) continue;
    const out = replaceAllMatches(note.bodyMd, q, replacement);
    if (out.count === 0) continue;
    hits.push({ id: note.id, title: note.title || "无标题笔记", count: out.count, body: out.text });
  }
  return hits;
}

/** 汇总：改了几篇、共几处。 */
export function bulkReplaceTotals(hits: readonly BulkReplaceHit[]): { notes: number; matches: number } {
  return { notes: hits.length, matches: hits.reduce((sum, h) => sum + h.count, 0) };
}
