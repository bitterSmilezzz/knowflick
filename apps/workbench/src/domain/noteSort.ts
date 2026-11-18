/**
 * 笔记列表排序（B03 的收尾）。
 *
 * 默认是「置顶优先 + 最近编辑」，但找一篇记得标题的旧笔记时，用户需要按标题排。
 * **置顶永远排在最前**——那是用户明确表达过的偏好，不该被排序方式推翻。
 */

export type NoteSortMode = "recent" | "created" | "title";

export const NOTE_SORT_LABELS: Record<NoteSortMode, string> = {
  recent: "最近编辑",
  created: "创建时间",
  title: "标题",
};

interface SortableNote {
  title: string;
  createdAt: number;
  updatedAt: number;
  isPinned: boolean;
}

export function sortNotes<T extends SortableNote>(notes: readonly T[], mode: NoteSortMode): T[] {
  const byMode = (a: T, b: T): number => {
    if (mode === "title") return a.title.localeCompare(b.title, "zh-CN") || b.updatedAt - a.updatedAt;
    if (mode === "created") return b.createdAt - a.createdAt || b.updatedAt - a.updatedAt;
    return b.updatedAt - a.updatedAt;
  };
  return [...notes].sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || byMode(a, b));
}
