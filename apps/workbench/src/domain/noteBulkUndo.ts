/**
 * 批量替换的一键撤销 / 重做（B01）。
 *
 * 批量替换每篇都生成一次修订，所以「撤销」不是凭空回滚，而是**把每篇恢复到替换前那一版**：
 * 拿替换前的正文再写一次，形成一条新的修订——历史只增不改，撤销本身也可再撤销。
 *
 * 重做与撤销**对称**：撤销把正文写回 `previousBody`，重做把正文写回 `replacedBody`。
 * 为什么需要重做：撤销是不可逆操作的唯一退路，一旦点错就只能手动把替换再做一遍——
 * 而批量替换往往跨几十篇，手动重做等于把这次操作白干。
 *
 * 这里只算**要恢复成什么**：真正写库仍由调用方走正常保存路径。
 */

export interface UndoEntry {
  id: string;
  /** 替换之前的正文（撤销就是写回它）。 */
  previousBody: string;
}

export interface RedoEntry {
  id: string;
  /** 撤销之后那一版的正文（= 替换后的正文）；重做就是写回它。 */
  undoBody: string;
  /** 撤销时写回的那一版（= 替换前的正文）；用来判断「这篇还停在撤销结果上吗」。 */
  restoredBody: string;
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

/**
 * 把「撤销结果」变成重做计划。
 *
 * 只有**还停在撤销结果上**的笔记才重做：撤销之后用户又改过这篇，
 * 再写回替换后的正文会把他刚写的东西冲掉——那比不能重做更糟。
 */
export function planBulkRedo(
  notes: readonly UndoSourceNote[],
  entries: readonly RedoEntry[],
): UndoPlan[] {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const plans: UndoPlan[] = [];
  for (const entry of entries) {
    const note = byId.get(entry.id);
    if (!note || note.isDeleted) continue;
    if (note.bodyMd !== entry.restoredBody) continue;
    if (note.bodyMd === entry.undoBody) continue;
    plans.push({ id: entry.id, body: entry.undoBody });
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

/** 重做计划的可读摘要（与撤销同一口径）。 */
export function bulkRedoTotals(
  entries: readonly RedoEntry[],
  plans: readonly UndoPlan[],
): { redoable: number; skipped: number } {
  return { redoable: plans.length, skipped: entries.length - plans.length };
}
