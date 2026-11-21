/**
 * 笔记正文里的待办项（B10）。
 *
 * 契约上待办**不是**另一套数据：它就是正文里的 `- [ ]` / `- [x]` 行。
 * 勾选即改那一行，别的都不动——正文是唯一真相，勾选状态自然跟着保存、
 * 跟着备份、跟着导出，不会出现「勾了但正文没变」的两份状态。
 */

export interface NoteTodo {
  /** 正文里的行号（0 起）；勾选要按行号定位，改别的行不影响它。 */
  line: number;
  /** 待办文字（去掉 `- [ ]` 标记与首尾空白）。 */
  text: string;
  done: boolean;
}

/** 匹配一行待办：`- [ ] 文字` / `* [x] 文字`（允许缩进与标记后多空格）。 */
const TODO_LINE = /^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/;

/**
 * 解析正文里的全部待办。
 *
 * 只认行首的待办标记：代码块里的 `- [ ]` 是示例文本，不该被勾掉。
 * 所以解析时要跟着 ``` 围栏走——围栏内的行整段跳过。
 */
export function parseNoteTodos(body: string): NoteTodo[] {
  const lines = body.split(/\r?\n/);
  const todos: NoteTodo[] = [];
  let inFence = false;
  lines.forEach((line, index) => {
    if (line.trim().startsWith("```")) { inFence = !inFence; return; }
    if (inFence) return;
    const match = line.match(TODO_LINE);
    if (!match) return;
    todos.push({
      line: index,
      text: match[3].trim(),
      done: match[2].toLowerCase() === "x",
    });
  });
  return todos;
}

/**
 * 勾选/取消某一条待办：只改那一行，其余行原样。
 *
 * 标记格式保持与原来一致（`- [ ]` / `- [x]`），缩进也不动——
 * 改行会让正文产生无意义的 diff（修订号照样推进，用户却看不出改了什么）。
 */
export function toggleNoteTodo(body: string, line: number): { body: string; changed: boolean } {
  const lines = body.split(/\r?\n/);
  const target = lines[line];
  if (target === undefined) return { body, changed: false };
  const match = target.match(TODO_LINE);
  if (!match) return { body, changed: false };
  const indent = match[1];
  const mark = match[2].toLowerCase() === "x" ? " " : "x";
  const rest = match[3];
  lines[line] = `${indent}- [${mark}] ${rest}`;
  return { body: lines.join("\n"), changed: true };
}

/** 待办计数：总数与已完成数。 */
export function countNoteTodos(todos: readonly NoteTodo[]): { total: number; done: number } {
  return { total: todos.length, done: todos.filter((t) => t.done).length };
}
