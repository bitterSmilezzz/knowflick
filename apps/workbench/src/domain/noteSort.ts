/**
 * 笔记列表排序（B03 的收尾）。
 *
 * 默认是「置顶优先 + 最近编辑」，但找一篇记得标题的旧笔记时，用户需要按标题排。
 * **置顶永远排在最前**——那是用户明确表达过的偏好，不该被排序方式推翻。
 *
 * 「按截止日期」（B10）排的是**最近一个未完成的截止日**：
 * 一篇里有三件待办、最近的在下周三，那这篇就该排在下周三的位置。
 * 没有未完成截止日的笔记排在**最后**——它们没有「什么时候该看」的问题，
 * 把它们混在逾期项之间只会把真正着急的挤下去。
 */

import { dueDateOf } from "./noteDue";
import { parseNoteTodos } from "./noteTodo";

export type NoteSortMode = "recent" | "created" | "title" | "due";

export const NOTE_SORT_LABELS: Record<NoteSortMode, string> = {
  recent: "最近编辑",
  created: "创建时间",
  title: "标题",
  due: "截止日期",
};

interface SortableNote {
  title: string;
  createdAt: number;
  updatedAt: number;
  isPinned: boolean;
}

/**
 * 一篇笔记里最近的未完成截止日；没有就返回 null。
 *
 * 已完成的不算：做完的事不该继续占着排序位置（与到期汇总同一口径）。
 */
export function nextDueOf(bodyMd: string): string | null {
  let earliest: string | null = null;
  for (const todo of parseNoteTodos(bodyMd)) {
    if (todo.done) continue;
    const due = dueDateOf(todo.text);
    if (!due) continue;
    if (earliest === null || due < earliest) earliest = due;
  }
  return earliest;
}

/**
 * 排序入口。
 *
 * 「按截止日期」这一档要看正文，所以泛型把 `bodyMd` 收成**可选**：
 * 不传的调用方（只按标题/时间排）不必关心正文；传了没有正文的对象，
 * 那一档会把它当「没有截止日」排到最后，而不是崩掉。
 *
 * 为什么不用函数重载把「必须有 bodyMd」写进类型：调用点传的是
 * `sortMode` 这种联合类型变量，重载会立刻在调用点报「没有匹配的重载」——
 * 用一个更严格的类型换来每个调用点都要分支，不值。
 */
export function sortNotes<T extends SortableNote & { bodyMd?: string }>(
  notes: readonly T[],
  mode: NoteSortMode,
): T[] {
  if (mode === "due") {
    // 只有这一种排序要看正文，单独走一条分支，避免给其它模式加无谓的类型约束。
    const dues = new Map<string, string | null>();
    for (const note of notes) dues.set(noteKey(note), nextDueOf(note.bodyMd ?? ""));
    const byDue = (a: T, b: T): number => {
      const da = dues.get(noteKey(a)) ?? null;
      const db = dues.get(noteKey(b)) ?? null;
      // 没有截止日的排最后：它们没有「什么时候该看」的问题。
      if (da === null && db === null) return b.updatedAt - a.updatedAt;
      // 只有一边没有截止日时，它排最后——不能按 updatedAt 混排，否则「没有截止日」
      // 的笔记会插进逾期项中间，把真正着急的挤下去。
      if (da === null) return 1;
      if (db === null) return -1;
      return da.localeCompare(db) || b.updatedAt - a.updatedAt;
    };
    return [...notes].sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || byDue(a, b));
  }
  const byMode = (a: T, b: T): number => {
    if (mode === "title") return a.title.localeCompare(b.title, "zh-CN") || b.updatedAt - a.updatedAt;
    if (mode === "created") return b.createdAt - a.createdAt || b.updatedAt - a.updatedAt;
    return b.updatedAt - a.updatedAt;
  };
  return [...notes].sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || byMode(a, b));
}

/**
 * 排序用的稳定身份。
 *
 * 用 `title + createdAt` 而不是数组下标：下标在排序过程中会变，
 * 提前算好的映射就会张冠李戴。标题可能重复，加上创建时间就够区分了。
 */
function noteKey(note: SortableNote): string {
  return `${note.createdAt}\u0000${note.title}`;
}
