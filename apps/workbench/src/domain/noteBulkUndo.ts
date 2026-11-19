/**
 * 批量替换的一键撤销（B01）。
 *
 * 批量替换每篇都生成一次修订，所以「撤销」不是凭空回滚，而是**把每篇恢复到替换前那一版**：
 * 拿替换前的正文再写一次，形成一条新的修订——历史只增不改，撤销本身也可再撤销。
 *
 * 这里只算**要恢复成什么**：每篇的目标正文来自替换前的快照（`previousBody`）。
 * 真正写库仍由调用方走正常保存路径。
 */

export interface UndoEntry {
  id: string;
  /** 替换之前的正文（撤销就是写回它）。 */
  previousBody: string;
}

interface UndoSourceNote {
  id: string;
  bodyMd: string;
  isDeleted?: boolean;
}

export interface UndoPlan {
  id: string;
  body: string;
}

/**
 * 把「替换前快照」变成撤销计划。
 *
 * 已经和快照一致的（用户在替换后自己改回来了）不进计划：再写一次只会多一条无意义的修订。
 * 替换后被删掉的笔记也不进计划：撤销不该把回收站里的笔记拉回列表。
 */
export function planBulkUndo(
  notes: readonly UndoSourceNote[],
  entries: readonly UndoEntry[],
): UndoPlan[] {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const plans: UndoPlan[] = [];
  for (const entry of entries) {
    const note = byId.get(entry.id);
    if (!note || note.isDeleted) continue;
    if (note.bodyMd === entry.previousBody) continue;
    plans.push({ id: entry.id, body: entry.previousBody });
  }
  return plans;
}

/** 撤销计划的可读摘要：几篇能撤、几篇跳过。 */
export function bulkUndoTotals(
  entries: readonly UndoEntry[],
  plans: readonly UndoPlan[],
): { undoable: number; skipped: number } {
  return { undoable: plans.length, skipped: entries.length - plans.length };
}
