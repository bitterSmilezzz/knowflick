import type { Goal, RawMaterial } from "../shell/store";
import type { Note } from "./note";

/**
 * 主动回顾的提醒策略（R4/D09）。
 *
 * 路线图口径：用户选频率与项目范围，安静时段、暂停和退订；
 * **只提醒可处理事项**，避免把每次收集变成通知。
 *
 * 两条硬约束：
 * - 不产评价：「没有记录」不是失败，提醒里不能说「你落后了」——
 *   只列用户**能动手做**的事（确认达成、复核过期引用、整理收件箱）。
 * - 不打扰：安静时段内不提醒；暂停与退订（频率设为「关闭」）都真的闭嘴。
 *
 * 这份是纯函数：策略判定不依赖宿主，界面只消费结果。
 */

/** 提醒频率。`off` 就是退订。 */
export type ReviewFrequency = "off" | "daily" | "weekly" | "monthly";

export interface ReviewSchedule {
  frequency: ReviewFrequency;
  /** 安静时段（本地小时，闭区间起点含、终点不含）。null = 不设安静时段。 */
  quietHours: { start: number; end: number } | null;
  /** 暂停：临时闭嘴（与退订不同——暂停可以随时回来）。 */
  paused: boolean;
  /** 项目范围：空数组 = 全部项目。 */
  projectScope: string[];
  /** 上次提醒的时间戳（0 = 从未提醒过）。 */
  lastRemindedAt: number;
}

export const defaultReviewSchedule: ReviewSchedule = {
  frequency: "weekly",
  quietHours: { start: 22, end: 8 },
  paused: false,
  projectScope: [],
  lastRemindedAt: 0,
};

/** 可处理事项的种类。 */
export type ReminderKind =
  | "goal-achieve" // 有达成证据但还没确认
  | "reference-stale" // 引用过期或失效，需要复核
  | "inbox-backlog" // 收件箱堆积未整理
  | "note-unfiled"; // 笔记没有归入任何知识库

export interface ReviewReminder {
  kind: ReminderKind;
  title: string;
  /** 该做什么——只说动作，不下评价。 */
  action: string;
  /** 指向具体对象（目标 id / 笔记 id / 数量）。 */
  targetId?: string;
  count?: number;
}

/** 判定现在该不该出声。 */
export function shouldRemindNow(schedule: ReviewSchedule, now: number): boolean {
  if (schedule.frequency === "off") return false;
  if (schedule.paused) return false;
  if (inQuietHours(schedule, now)) return false;
  return isDue(schedule, now);
}

/** 是否落在安静时段（跨午夜也成立：22→8）。 */
export function inQuietHours(schedule: ReviewSchedule, now: number): boolean {
  const q = schedule.quietHours;
  if (!q) return false;
  const hour = new Date(now).getHours();
  if (q.start === q.end) return false;
  if (q.start < q.end) return hour >= q.start && hour < q.end;
  // 跨午夜
  return hour >= q.start || hour < q.end;
}

/** 按频率看「到点了没」：上次提醒距今是否已过一个周期。 */
export function isDue(schedule: ReviewSchedule, now: number): boolean {
  const periodMs =
    schedule.frequency === "daily"
      ? 24 * 3600 * 1000
      : schedule.frequency === "weekly"
        ? 7 * 24 * 3600 * 1000
        : 30 * 24 * 3600 * 1000;
  if (schedule.lastRemindedAt === 0) return true;
  return now - schedule.lastRemindedAt >= periodMs;
}

/** 下次提醒时间（用于界面显示「下次回顾」）。 */
export function nextReminderAt(schedule: ReviewSchedule, now: number): number | null {
  if (schedule.frequency === "off" || schedule.paused) return null;
  const periodMs =
    schedule.frequency === "daily"
      ? 24 * 3600 * 1000
      : schedule.frequency === "weekly"
        ? 7 * 24 * 3600 * 1000
        : 30 * 24 * 3600 * 1000;
  const base = schedule.lastRemindedAt === 0 ? now : schedule.lastRemindedAt;
  let next = base + periodMs;
  if (next <= now) next = now + periodMs;
  // 安静时段里不提醒：往后推到安静时段结束
  const q = schedule.quietHours;
  if (q) {
    for (let i = 0; i < 48; i++) {
      if (!inQuietHours(schedule, next)) break;
      next += 3600 * 1000;
    }
  }
  return next;
}

export interface ReminderInput {
  goals: Goal[];
  notes: Note[];
  materials: RawMaterial[];
  /** 引用过期/失效的条目（由 noteReference.referenceStatus 判定）。 */
  staleReferences: Array<{ noteId: string; title: string; status: "changed" | "missing" }>;
  /** 项目范围：空 = 全部。 */
  projectScope?: string[];
  /** 收件箱堆积多少条才算值得提醒（低于这个数不打扰）。 */
  inboxThreshold?: number;
}

/**
 * 算出**可处理事项**。
 *
 * 只列用户能动手做的事；「没有记录」不产生提醒（那不是失败，是没到）。
 */
export function reviewReminders(input: ReminderInput): ReviewReminder[] {
  const out: ReviewReminder[] = [];
  const inboxThreshold = input.inboxThreshold ?? 5;

  // 1. 有达成证据但还没确认的目标 —— 需要用户确认（系统不替他判定）
  for (const goal of input.goals) {
    if (goal.achievedAt !== null || goal.abandonedAt !== null) continue;
    if (goal.evidenceCount > 0) {
      out.push({
        kind: "goal-achieve",
        title: goal.title,
        action: `已关联 ${goal.evidenceCount} 条证据——确认是否达成，或补充完成条件`,
        targetId: goal.id,
        count: goal.evidenceCount,
      });
    }
  }

  // 2. 过期 / 失效的引用 —— 需要复核
  for (const ref of input.staleReferences) {
    out.push({
      kind: "reference-stale",
      title: ref.title,
      action: ref.status === "missing" ? "来源已不在库里——这条引用已失效" : "来源内容改过了——这条引用可能已过期",
      targetId: ref.noteId,
    });
  }

  // 3. 收件箱堆积 —— 需要整理
  const inbox = input.materials.filter((m) => m.inboxStatus === "inbox").length;
  if (inbox >= inboxThreshold) {
    out.push({
      kind: "inbox-backlog",
      title: `收件箱里有 ${inbox} 条待整理`,
      action: "挑几条转成笔记或知识卡，其余归档",
      count: inbox,
    });
  }

  // 4. 没有归入任何知识库的笔记 —— 需要归档
  const filed = new Set<string>();
  for (const note of input.notes) {
    if (note.isDeleted) continue;
    // 归属关系由外部传入（这里只按「有没有知识库 id」判断，用 note.notebook 近似）
    if (note.notebook) filed.add(note.id);
  }
  const unfiled = input.notes.filter((n) => !n.isDeleted && !filed.has(n.id));
  if (unfiled.length >= 3) {
    out.push({
      kind: "note-unfiled",
      title: `${unfiled.length} 篇笔记还没有归入知识库`,
      action: "给它们分个笔记本或知识库，之后才搜得到范围",
      count: unfiled.length,
    });
  }

  // 项目范围：只保留属于范围内的项目相关提醒（当前只有目标与引用两类能定位到项目）
  const scope = input.projectScope ?? [];
  if (scope.length > 0) {
    return out.filter((r) => {
      if (r.kind === "goal-achieve") return scope.includes(r.targetId ?? "");
      return true;
    });
  }
  return out;
}

/** 读取设置里的回顾计划（settings.json 的 raw.reviewSchedule）。 */
export function readReviewSchedule(raw: Record<string, unknown>): ReviewSchedule {
  const value = raw?.reviewSchedule;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...defaultReviewSchedule };
  const v = value as Record<string, unknown>;
  const freq = v.frequency;
  const frequency: ReviewFrequency =
    freq === "off" || freq === "daily" || freq === "weekly" || freq === "monthly" ? freq : defaultReviewSchedule.frequency;
  const q = v.quietHours;
  const quietHours =
    q && typeof q === "object" && !Array.isArray(q)
      ? (() => {
          const qh = q as Record<string, unknown>;
          const start = Number(qh.start);
          const end = Number(qh.end);
          if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
          if (start < 0 || start > 23 || end < 0 || end > 23) return null;
          return { start, end };
        })()
      : null;
  const scope = Array.isArray(v.projectScope) ? v.projectScope.map(String) : [];
  const last = Number(v.lastRemindedAt);
  return {
    frequency,
    quietHours: quietHours ?? defaultReviewSchedule.quietHours,
    paused: v.paused === true,
    projectScope: scope,
    lastRemindedAt: Number.isFinite(last) ? last : 0,
  };
}

/** 写回设置里的回顾计划。 */
export function writeReviewSchedule(
  raw: Record<string, unknown>,
  schedule: ReviewSchedule
): Record<string, unknown> {
  return { ...raw, reviewSchedule: schedule };
}
