/**
 * 正文编辑的撤销 / 重做栈（B01）。
 *
 * 为什么单独做一个模块：正文的每次改动都经过同一个入口（`onEdit`），
 * 但**浏览器原生撤销在受控 textarea 上不可靠**——React 每次把 value 写回，
 * 原生 undo 栈会与它打架，用户按 Ctrl+Z 有时撤销了、有时什么都没发生。
 * 所以自己维护一份历史：能断言，行为也稳定。
 *
 * 三条口径：
 * - **按时间合并连续输入**：每敲一个字都压一版历史会让 Ctrl+Z 变成「退一个字」，
 *   用户要按几十次才能退掉一句话。窗口内的连续输入合成一版。
 * - **撤销/重做不记录自己**：撤销产生的改动不该再进历史，否则 Ctrl+Z 会自己套自己。
 * - **新改动清空重做栈**：这是所有编辑器的通行语义——改了新内容，原来的「重做」就没有意义了。
 */

/** 连续输入合并窗口：这段时间内的改动算同一版历史。 */
export const EDIT_MERGE_WINDOW_MS = 600;

/** 历史最多留多少版：防止长时间编辑把内存吃满。 */
export const EDIT_HISTORY_LIMIT = 100;

export interface EditSnapshot {
  body: string;
  title: string;
}

export interface EditHistory {
  /** 已经发生过的版本，最后一版是当前状态。 */
  past: EditSnapshot[];
  /** 撤销出来的版本，栈顶是最近一次撤销掉的那个。 */
  future: EditSnapshot[];
  /** 上一次记录的时间，用于合并连续输入。 */
  lastAt: number;
}

export function emptyHistory(now = Date.now()): EditHistory {
  return { past: [], future: [], lastAt: now };
}

/**
 * 记录一次改动。
 *
 * `before` 是改动**之前**的内容——历史里存的是「能回到的那个状态」，不是新内容。
 * 合并窗口内的连续输入不再压新版本，只更新 `lastAt`。
 */
export function recordEdit(
  history: EditHistory,
  before: EditSnapshot,
  now = Date.now(),
): EditHistory {
  const last = history.past[history.past.length - 1];
  // 与上一版完全相同：没有变化，不记（避免 Ctrl+Z 按一下什么都没发生）。
  if (last && last.body === before.body && last.title === before.title) {
    return { ...history, lastAt: now };
  }
  // 合并窗口内：只把上一版替换成更早的 before，不再新增一版。
  if (now - history.lastAt < EDIT_MERGE_WINDOW_MS && history.past.length > 0) {
    return { ...history, lastAt: now, future: [] };
  }
  const past = [...history.past, before].slice(-EDIT_HISTORY_LIMIT);
  return { past, future: [], lastAt: now };
}

/** 能不能撤销：有历史才可能。 */
export function canUndo(history: EditHistory): boolean {
  return history.past.length > 0;
}

/** 能不能重做：撤销过才可能。 */
export function canRedo(history: EditHistory): boolean {
  return history.future.length > 0;
}

/**
 * 撤销一步：返回要恢复到的状态与新历史。
 *
 * `current` 是**现在**的内容，它会被压进重做栈——所以重做能回到撤销前的样子。
 * 撤销之后重置 `lastAt`，避免紧接着的改动被当成「连续输入」合并掉。
 */
export function undoEdit(
  history: EditHistory,
  current: EditSnapshot,
): { history: EditHistory; snapshot: EditSnapshot } | null {
  if (history.past.length === 0) return null;
  const snapshot = history.past[history.past.length - 1];
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, current].slice(-EDIT_HISTORY_LIMIT),
      lastAt: 0,
    },
    snapshot,
  };
}

/** 重做一步：与撤销对称。 */
export function redoEdit(
  history: EditHistory,
  current: EditSnapshot,
): { history: EditHistory; snapshot: EditSnapshot } | null {
  if (history.future.length === 0) return null;
  const snapshot = history.future[history.future.length - 1];
  return {
    history: {
      past: [...history.past, current].slice(-EDIT_HISTORY_LIMIT),
      future: history.future.slice(0, -1),
      lastAt: 0,
    },
    snapshot,
  };
}
