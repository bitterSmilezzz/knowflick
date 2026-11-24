/**
 * 标签筛选（B03 的收尾之一）。
 *
 * 标签早就能打、能在列表里看到，但不能按它筛——用户攒到几十篇之后，
 * 「把打了 #复盘 的都挑出来」只能靠搜索框碰运气。
 */

interface TaggedNote {
  tags: readonly string[];
}

export interface TagCount {
  tag: string;
  count: number;
}

/** 库里出现过的标签与篇数：先按篇数降序，再按名字，顺序稳定。 */
export function collectNoteTags(notes: readonly TaggedNote[]): TagCount[] {
  const counts = new Map<string, number>();
  for (const note of notes) {
    // 同一篇里重复的标签只算一次：那是脏数据，不该把计数撑大。
    for (const tag of new Set(note.tags.map((t) => t.trim()).filter(Boolean))) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-CN"));
}

export function filterByTag<T extends TaggedNote>(notes: readonly T[], tag: string): T[] {
  if (!tag) return [...notes];
  return notes.filter((note) => note.tags.includes(tag));
}
