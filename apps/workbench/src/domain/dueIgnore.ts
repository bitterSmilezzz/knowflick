/**
 * 到期待办的「忽略」（B10）。
 *
 * 为什么需要它：汇总里的条目只有「完成」和「改期」两条路，但现实里还有第三种——
 * 「这件我知道，别每天提醒我」。强行改期是**撒谎**（改了真实截止日），
 * 强行完成更糟（没做完却标成做完）。
 *
 * 为什么存在本地而不是写进正文：
 * 忽略是**看的人**的选择，不是这条待办的属性。写进正文会让「我不想看」变成对内容的修改，
 * 备份、导出、协作都会被这个偏好污染。代价是它不跨设备同步——这是诚实的代价，写在文档里。
 *
 * 身份用 `noteId + 截止日 + 文字`，不用行号：
 * 行号会因为上面插入一行而整体漂移，那样「忽略」会在用户改别处时莫名其妙失效。
 * 文字或日期变了就是一个**不同的**任务（改期后应该重新出现），所以两者都进 key。
 */

/** 最多记多少条：防止长期使用后 localStorage 无限增长。 */
export const IGNORED_DUE_LIMIT = 200;

export interface IgnorableDue {
  noteId: string;
  due: string;
  text: string;
}

/** 一条待办的忽略身份。 */
export function dueIgnoreKey(item: IgnorableDue): string {
  return JSON.stringify([item.noteId, item.due, item.text]);
}

/** 拆出被忽略的与没被忽略的；顺序保持不变。 */
export function splitIgnoredDue<T extends IgnorableDue>(
  items: readonly T[],
  ignored: readonly string[],
): { active: T[]; ignored: T[] } {
  const keys = new Set(ignored);
  const active: T[] = [];
  const hidden: T[] = [];
  for (const item of items) {
    if (keys.has(dueIgnoreKey(item))) hidden.push(item);
    else active.push(item);
  }
  return { active, ignored: hidden };
}

/** 加一条忽略；已有的不重复加。 */
export function addIgnoredDue(ignored: readonly string[], item: IgnorableDue): string[] {
  const key = dueIgnoreKey(item);
  if (ignored.includes(key)) return [...ignored];
  return [...ignored, key].slice(-IGNORED_DUE_LIMIT);
}

/** 撤销一条忽略。 */
export function removeIgnoredDue(ignored: readonly string[], item: IgnorableDue): string[] {
  const key = dueIgnoreKey(item);
  return ignored.filter((k) => k !== key);
}

/**
 * 清理已经失效的忽略记录。
 *
 * 待办被完成、被删、被改期之后，它原来的忽略记录就是垃圾——留着只会让列表越来越长。
 * 每次读取时按**当前存在的待办**剪一遍，与引用体检的 prune 同一个思路。
 */
export function pruneIgnoredDue(
  ignored: readonly string[],
  items: readonly IgnorableDue[],
): string[] {
  const live = new Set(items.map(dueIgnoreKey));
  return ignored.filter((key) => live.has(key));
}
