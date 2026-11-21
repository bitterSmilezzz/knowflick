import { dueDateOf } from "./noteDue";

/**
 * 到期待办的「就地处理」（B10）：完成、推迟、改到指定日期。
 *
 * 汇总列表里看到「逾期 5 件」，用户的第一个念头通常是「这件我做完了」或「这件下周再说」。
 * 以前只能点开那篇、翻到那一行、手动改日期——这里把这些动作做到汇总里。
 *
 * 与待办本身同一个原则：**改的是正文那一行**，不另存状态。
 */

/** 待办行的匹配规则与 noteTodo 保持一致（缩进 + 标记 + 文字）。 */
const TODO_LINE = /^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/;

/** 日期标记：📅 后跟 ISO 日期（行末）。 */
const DUE_MARK = /\s*📅\s*\d{4}-\d{2}-\d{2}\s*$/;

/** ISO 日期形状。 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 是不是一个**真实存在**的日期（不只是形状对）。
 *
 * 为什么要查日历：`2026-02-30` 形状完全合法，但那天不存在。直接写进正文会得到
 * 一个永远算不出状态的截止日期——用户以为改好了，清单里却再也不出现。
 */
export function isIsoDate(value: string): boolean {
  const text = value.trim();
  if (!ISO_DATE.test(text)) return false;
  const [y, m, d] = text.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
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

/** 把某一行的日期标记换成给定日期；那行不是带日期标记的待办就不动。 */
function rewriteDue(
  body: string,
  line: number,
  next: string,
): { body: string; changed: boolean; due: string | null } {
  const lines = body.split(/\r?\n/);
  const target = lines[line];
  if (target === undefined) return { body, changed: false, due: null };
  const match = target.match(TODO_LINE);
  if (!match) return { body, changed: false, due: null };
  if (!dueDateOf(match[3])) return { body, changed: false, due: null };
  const newText = match[3].replace(DUE_MARK, ` 📅 ${next}`);
  lines[line] = `${match[1]}- [${match[2]}] ${newText}`;
  return { body: lines.join("\n"), changed: true, due: next };
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
  const due = dueDateOf(match[3]);
  if (!due) return { body, changed: false, due: null };
  return rewriteDue(body, line, snoozedDate(due, days, now));
}

/**
 * 把某一行的截止日期改成一个**指定日期**（B10「推迟到指定日期」）。
 *
 * 日期不合法（形状不对或那天不存在）时返回 changed: false 并给出原因：
 * 静默失败会让用户以为改好了，而清单里那条不再出现。
 * 改成与原来相同的日期也算没改（不多写一条修订）。
 */
export function rescheduleTodoInBody(
  body: string,
  line: number,
  date: string,
): { body: string; changed: boolean; due: string | null; reason?: "invalid" | "unchanged" } {
  const wanted = date.trim();
  if (!isIsoDate(wanted)) return { body, changed: false, due: null, reason: "invalid" };
  const lines = body.split(/\r?\n/);
  const target = lines[line];
  if (target === undefined) return { body, changed: false, due: null };
  const match = target.match(TODO_LINE);
  if (!match) return { body, changed: false, due: null };
  const current = dueDateOf(match[3]);
  if (!current) return { body, changed: false, due: null };
  if (current === wanted) return { body, changed: false, due: wanted, reason: "unchanged" };
  return rewriteDue(body, line, wanted);
}
