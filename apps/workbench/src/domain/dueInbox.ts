import { dueStateOf, todoTextWithoutDue, dueDateOf, type DueState } from "./noteDue";
import { parseNoteTodos } from "./noteTodo";

/**
 * 跨笔记的到期待办汇总（B10）。
 *
 * 单篇的「逾期 N 件」只在打开那篇时看得到；真正有用的是**全库一处汇总**：
 * 「今天有什么到期」，不用挨篇点开翻。
 *
 * 口径：
 * - 只看未删除的笔记；**归档的算**（归档只是收起，待办还没做完）。
 * - 已完成的不算；没有截止日期的不算。
 * - 排序：逾期在前（越早越前），然后今天，再按日期；同日期按笔记标题，顺序稳定。
 */

export interface DueTodoItem {
  noteId: string;
  noteTitle: string;
  /** 正文行号，跳到那篇后可以定位。 */
  line: number;
  /** 去掉 📅 标记后的待办文字。 */
  text: string;
  due: string;
  state: DueState;
}

interface DueSourceNote {
  id: string;
  title: string;
  bodyMd: string;
  isDeleted?: boolean;
}

export function collectDueTodos(
  notes: readonly DueSourceNote[],
  now = Date.now(),
): DueTodoItem[] {
  const items: DueTodoItem[] = [];
  for (const note of notes) {
    if (note.isDeleted) continue;
    for (const todo of parseNoteTodos(note.bodyMd)) {
      if (todo.done) continue;
      const due = dueDateOf(todo.text);
      if (!due) continue;
      items.push({
        noteId: note.id,
        noteTitle: note.title || "无标题笔记",
        line: todo.line,
        text: todoTextWithoutDue(todo.text),
        due,
        state: dueStateOf(due, now),
      });
    }
  }
  const rank = (state: DueState) => (state === "overdue" ? 0 : state === "today" ? 1 : 2);
  return items.sort(
    (a, b) =>
      rank(a.state) - rank(b.state) ||
      a.due.localeCompare(b.due) ||
      a.noteTitle.localeCompare(b.noteTitle, "zh-CN")
  );
}

/** 汇总计数：逾期与今天各几件（列表顶部那一行）。 */
export function dueTotals(items: readonly DueTodoItem[]): { overdue: number; today: number } {
  return {
    overdue: items.filter((i) => i.state === "overdue").length,
    today: items.filter((i) => i.state === "today").length,
  };
}
