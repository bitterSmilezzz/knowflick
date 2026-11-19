import { dueDateOf } from "./noteDue";

/**
 * 到期待办的「就地处理」（B10）：完成、推迟。
 *
 * 汇总列表里看到「逾期 5 件」，用户的第一个念头通常是「这件我做完了」或「这件下周再说」。
 * 以前只能点开那篇、翻到那一行、手动改日期——这里把这两个动作做到汇总里。
 *
 * 与待办本身同一个原则：**改的是正文那一行**，不另存状态。
 */

/** 待办行的匹配规则与 noteTodo 保持一致（缩进 + 标记 + 文字）。 */
const TODO_LINE = /^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/;

/** 日期标记：📅 后跟 ISO 日期（行末）。 */
const DUE_MARK = /\s*📅\s*\d{4}-\d{2}-\d{2}\s*$/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 推迟到哪一天：从「原截止日」与「今天」里较晚的那个往后推 `days` 天。
 *
 * 为什么取较晚的那个：
 * - 已逾期很久的（截止日是三个月前）若从原日期推，推完可能还是逾期——那不是推迟；
 * - 未来才到期的（下周）若从今天推，可能反而**提前**了——用户没要求提前。
 */
export function snoozedDate(due: string, days: number, now = Date.now()): string {
  const today = dateKey(new Date(now));
  const base = due > today ? due : today;
  const [y, m, d] = base.split("-").map(Number);
  const next = new Date(y, m - 1, d);
  next.setDate(next.getDate() + Math.max(1, days));
  return dateKey(next);
}

/**
 * 把某一行的截止日期往后推。
 *
 * 只改那一行的日期标记，其余原样；没有日期的待办不动（返回 changed: false）——
 * 给「本来就没有截止日」的待办设一个日期是另一件事，别混进来。
 */
export function snoozeTodoInBody(
  body: string,
  line: number,
  days: number,
  now = Date.now(),
): { body: string; changed: boolean; due: string | null } {
  const lines = body.split(/\r?\n/);
  const target = lines[line];
  if (target === undefined) return { body, changed: false, due: null };
  const match = target.match(TODO_LINE);
  if (!match) return { body, changed: false, due: null };
  const text = match[3];
  const due = dueDateOf(text);
  if (!due) return { body, changed: false, due: null };
  const next = snoozedDate(due, days, now);
  // 用 `📅 ` 加新日期替换掉行末那个标记；行内其它文字一个字符都不动。
  const newText = text.replace(DUE_MARK, ` 📅 ${next}`);
  lines[line] = `${match[1]}- [${match[2]}] ${newText}`;
  return { body: lines.join("\n"), changed: true, due: next };
}
