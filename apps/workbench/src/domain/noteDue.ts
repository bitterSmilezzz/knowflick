import { countNoteTodos, parseNoteTodos, type NoteTodo } from "./noteTodo";

/**
 * 待办的截止日期（B10）。
 *
 * 与待办本身同一个原则：**日期写在正文里**，不另存一份字段。
 * 写成待办行末尾的 `📅 YYYY-MM-DD`（Obsidian Tasks 的通行写法，用户不必学新语法）：
 *
 *     - [ ] 交周报 📅 2026-11-20
 *
 * 这样日期跟着正文走：备份、导出、修订历史里都在，不会出现「正文没变但提醒丢了」。
 * 只做到期状态（逾期/今天/将来）的**显示**；真正的系统通知不在这一步。
 */

/** 日期标记：📅 后跟 ISO 日期；允许两边空格。 */
const DUE_MARK = /\s*📅\s*(\d{4})-(\d{2})-(\d{2})\s*$/;

export type DueState = "overdue" | "today" | "upcoming";

function isRealDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  // 2 月 30 日这种会被 Date 顺延到下个月，用回读比对挡掉。
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** 解析待办文字里的截止日期；没有或不是有效日期就返回 null（不猜）。 */
export function dueDateOf(text: string): string | null {
  const m = DUE_MARK.exec(text);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!isRealDate(year, month, day)) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** 去掉日期标记后的待办文字（界面与计数用，别把 📅 当内容显示）。 */
export function todoTextWithoutDue(text: string): string {
  return text.replace(DUE_MARK, "").trim();
}

/** 到期状态：按「本地日」比较——用户眼里的今天是他所在时区的今天。 */
export function dueStateOf(due: string, now = Date.now()): DueState {
  const today = new Date(now);
  const todayKey = toDateKey(today);
  if (due === todayKey) return "today";
  return due < todayKey ? "overdue" : "upcoming";
}

function toDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 未完成待办里「有截止日期」的那些，按日期升序。
 * 已完成的不算：做完的事不该继续占着「逾期」的红字。
 */
export function todosWithDue(todos: readonly NoteTodo[]): { todo: NoteTodo; due: string }[] {
  return todos
    .filter((t) => !t.done)
    .map((todo) => ({ todo, due: dueDateOf(todo.text) }))
    .filter((item): item is { todo: NoteTodo; due: string } => item.due !== null)
    .sort((a, b) => a.due.localeCompare(b.due));
}

/** 到期概览：逾期几件、今天几件。 */
export function dueSummary(body: string, now = Date.now()): { overdue: number; today: number } {
  const items = todosWithDue(parseNoteTodos(body));
  let overdue = 0;
  let today = 0;
  for (const item of items) {
    const state = dueStateOf(item.due, now);
    if (state === "overdue") overdue += 1;
    else if (state === "today") today += 1;
  }
  return { overdue, today };
}

export { countNoteTodos };
