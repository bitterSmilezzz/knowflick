/**
 * 引用体检的「忽略这条」与撤销（C05）。
 *
 * 为什么需要它：体检是横向扫描，坏引用一多，列表里就会混进**用户已经知道并且决定不管**的那些
 * （那篇素材本来就是被删掉的草稿、那条引用是历史记录里留的证据）。全都摊在同一张清单里，
 * 真正要处理的几条就被淹了。
 *
 * 口径：
 * - 忽略是**本机的界面决定**，不改正文、不动引用本身——所以它不需要修订，也不该进备份里的笔记内容。
 * - 忽略的粒度是「这条引用 + 这个状态」：同一篇里指向同一目标的两条引用算两条（正文里确实有两条），
 *   而失效与过期是两回事——目标后来被恢复了，旧的「失效」忽略不该顺带盖住新的「过期」。
 * - 撤销就是把它从忽略表里去掉，没有别的副作用。
 */

import type { ReferenceIssue } from "./referenceAudit";

/** 忽略表的上限：这是界面偏好，不该无限增长。超了丢最早的。 */
export const IGNORED_REF_LIMIT = 200;

/** 一条问题的稳定标识；结构化编码避免 id 中的分隔符造成碰撞。 */
export function issueKey(issue: Pick<ReferenceIssue, "noteId" | "targetId" | "status" | "referenceKey">): string {
  return JSON.stringify([issue.noteId, issue.targetId, issue.status, issue.referenceKey ?? ""]);
}

/** 把问题分成「要处理的」与「已忽略的」两摞。 */
export function splitIgnored(
  issues: readonly ReferenceIssue[],
  ignored: readonly string[],
): { active: ReferenceIssue[]; ignored: ReferenceIssue[] } {
  const set = new Set(ignored);
  const active: ReferenceIssue[] = [];
  const skipped: ReferenceIssue[] = [];
  for (const issue of issues) {
    if (set.has(issueKey(issue))) skipped.push(issue);
    else active.push(issue);
  }
  return { active, ignored: skipped };
}

/** 加一条忽略：已在表里就不重复加（否则撤销一次只去掉一份，要点好几次）。 */
export function addIgnored(ignored: readonly string[], key: string): string[] {
  if (ignored.includes(key)) return [...ignored];
  const next = [...ignored, key];
  return next.length > IGNORED_REF_LIMIT ? next.slice(next.length - IGNORED_REF_LIMIT) : next;
}

/** 撤销忽略。 */
export function removeIgnored(ignored: readonly string[], key: string): string[] {
  return ignored.filter((k) => k !== key);
}

/**
 * 修剪忽略表：只留下**当前仍存在的问题**。
 *
 * 不加这步的话，修好一条引用后它的 key 会永远留在表里；将来同一篇又出现同一目标同一状态的问题时，
 * 新问题会被一条陈年忽略默默吞掉——用户看不到，也没法解释。
 */
export function pruneIgnored(
  ignored: readonly string[],
  issues: readonly ReferenceIssue[],
): string[] {
  const live = new Set(issues.map(issueKey));
  return ignored.filter((k) => live.has(k));
}
