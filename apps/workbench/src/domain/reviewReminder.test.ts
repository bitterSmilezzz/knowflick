import { describe, expect, it } from "vitest";
import {
  defaultReviewSchedule,
  inQuietHours,
  isDue,
  markReminded,
  nextReminderAt,
  readReviewSchedule,
  reviewReminders,
  shouldRemindNow,
  writeReviewSchedule,
  type ReviewSchedule,
} from "./reviewReminder";
import type { Goal, RawMaterial } from "../shell/store";
import { createNoteDraft } from "./note";

/**
 * 主动回顾的提醒策略（R4/D09）：
 * 只提醒**可处理**事项；安静时段、暂停与退订都真的闭嘴。
 */

const schedule = (over: Partial<ReviewSchedule> = {}): ReviewSchedule => ({
  ...defaultReviewSchedule,
  ...over,
});

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: "g1",
  title: "北极项目",
  doneCriteria: "分阶段上线并稳定运行一周",
  scope: null,
  createdAt: 1,
  achievedAt: null,
  abandonedAt: null,
  reviewNote: "",
  evidenceCount: 2,
  ...over,
});

const material = (over: Partial<RawMaterial> = {}): RawMaterial => ({
  id: "m1",
  sourceType: "manual",
  title: "素材",
  sourceUrl: null,
  rawText: "正文",
  contentHash: "",
  mediaPath: null,
  mediaSizeBytes: 0,
  metadataJson: "{}",
  inboxStatus: "inbox",
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe("提醒频率与安静时段", () => {
  it("退订（频率 off）永不出声", () => {
    expect(shouldRemindNow(schedule({ frequency: "off" }), Date.now())).toBe(false);
  });

  it("暂停时不出声", () => {
    expect(shouldRemindNow(schedule({ paused: true }), Date.now())).toBe(false);
  });

  it("安静时段内不出声（22:00–08:00 跨午夜）", () => {
    const at = (hour: number) => new Date(2026, 0, 1, hour, 0, 0).getTime();
    expect(inQuietHours(schedule(), at(23))).toBe(true);
    expect(inQuietHours(schedule(), at(3))).toBe(true);
    expect(inQuietHours(schedule(), at(9))).toBe(false);
    expect(inQuietHours(schedule(), at(12))).toBe(false);
  });

  it("不跨午夜的安静时段同样成立", () => {
    const s = schedule({ quietHours: { start: 13, end: 15 } });
    const at = (hour: number) => new Date(2026, 0, 1, hour, 0, 0).getTime();
    expect(inQuietHours(s, at(14))).toBe(true);
    expect(inQuietHours(s, at(16))).toBe(false);
  });

  it("按频率判断到期：日/周/月各按自己的周期", () => {
    const now = Date.now();
    const day = 24 * 3600 * 1000;
    expect(isDue(schedule({ frequency: "daily", lastRemindedAt: now - day - 1000 }), now)).toBe(true);
    expect(isDue(schedule({ frequency: "daily", lastRemindedAt: now - 1000 }), now)).toBe(false);
    expect(isDue(schedule({ frequency: "weekly", lastRemindedAt: now - 7 * day - 1000 }), now)).toBe(true);
    expect(isDue(schedule({ frequency: "weekly", lastRemindedAt: now - day - 1000 }), now)).toBe(false);
    expect(isDue(schedule({ frequency: "monthly", lastRemindedAt: now - 30 * day - 1000 }), now)).toBe(true);
  });

  it("从未提醒过时视为到期（第一次就该提醒）", () => {
    expect(isDue(schedule({ lastRemindedAt: 0 }), Date.now())).toBe(true);
  });

  it("下次提醒时间会跳过安静时段", () => {
    const now = new Date(2026, 0, 1, 23, 0, 0).getTime(); // 23 点在安静时段里
    const next = nextReminderAt(schedule({ lastRemindedAt: 0, frequency: "daily" }), now);
    expect(next).not.toBeNull();
    const hour = new Date(next!).getHours();
    expect(hour < 8 || hour >= 22).toBe(false);
  });

  it("首次或已到期时，在安静时段结束的整点提醒，而不是再等一个周期", () => {
    const at = (day: number, hour: number, minute = 0) => new Date(2026, 0, day, hour, minute).getTime();
    expect(nextReminderAt(schedule({ frequency: "weekly", lastRemindedAt: 0 }), at(1, 23, 35))).toBe(at(2, 8));
    expect(nextReminderAt(schedule({ frequency: "daily", lastRemindedAt: at(1, 1) }), at(2, 3, 30))).toBe(at(2, 8));
    expect(nextReminderAt(schedule({ frequency: "daily", lastRemindedAt: at(1, 1) }), at(2, 9))).toBe(at(2, 9));
    expect(nextReminderAt(schedule({ quietHours: { start: 13, end: 15 }, lastRemindedAt: 0 }), at(1, 14, 20))).toBe(at(1, 15));
  });

  it("尚未到期时保留实际到期时间，并只在到期落入安静时段时顺延", () => {
    const at = (day: number, hour: number, minute = 0) => new Date(2026, 0, day, hour, minute).getTime();
    expect(nextReminderAt(schedule({ frequency: "daily", lastRemindedAt: at(1, 9, 30) }), at(1, 10))).toBe(at(2, 9, 30));
    expect(nextReminderAt(schedule({ frequency: "daily", lastRemindedAt: at(1, 23, 30) }), at(2, 10))).toBe(at(3, 8));
    expect(nextReminderAt(schedule({ frequency: "daily", lastRemindedAt: at(1, 8) }), at(1, 9))).toBe(at(2, 8));
  });

  it("退订与暂停时没有下次提醒", () => {
    expect(nextReminderAt(schedule({ frequency: "off" }), Date.now())).toBeNull();
    expect(nextReminderAt(schedule({ paused: true }), Date.now())).toBeNull();
  });
});

describe("回顾完成后推进周期", () => {
  const at = (day: number, hour: number, minute = 0) => new Date(2026, 0, day, hour, minute).getTime();

  it("回顾后写入上次提醒时间，下一轮按频率重新计时", () => {
    const now = at(1, 10);
    const next = markReminded(schedule({ frequency: "daily", lastRemindedAt: 0 }), now);
    expect(next.lastRemindedAt).toBe(now);
    expect(isDue(next, now)).toBe(false);
    expect(isDue(next, at(2, 10))).toBe(true);
  });

  it("不回顾就不推进——到期状态一直保持，不会自己消失", () => {
    const s = schedule({ frequency: "daily", lastRemindedAt: 0 });
    expect(isDue(s, at(3, 10))).toBe(true);
  });

  it("安静时段内不写回（那个时刻用户听不到，写回等于吞掉一轮）", () => {
    const s = schedule({ frequency: "daily", lastRemindedAt: 0 });
    const night = at(1, 23, 30); // 在 22:00–08:00 的安静时段里
    expect(markReminded(s, night).lastRemindedAt).toBe(0);
  });

  it("退订与暂停时推进不改变任何东西", () => {
    expect(markReminded(schedule({ frequency: "off" }), Date.now()).lastRemindedAt).toBe(0);
    expect(markReminded(schedule({ paused: true }), Date.now()).lastRemindedAt).toBe(0);
  });
});

describe("只提醒可处理事项", () => {
  it("有证据但未确认的目标 → 提醒确认", () => {
    const reminders = reviewReminders({ goals: [goal()], notes: [], materials: [], staleReferences: [] });
    const g = reminders.find((r) => r.kind === "goal-achieve");
    expect(g).toBeTruthy();
    expect(g?.action).toContain("确认");
  });

  it("已达成或已放弃的目标不再提醒", () => {
    const reminders = reviewReminders({
      goals: [goal({ achievedAt: 5 }), goal({ abandonedAt: 5, id: "g2" })],
      notes: [],
      materials: [],
      staleReferences: [],
    });
    expect(reminders.filter((r) => r.kind === "goal-achieve")).toHaveLength(0);
  });

  it("没有证据的目标不提醒（没有记录不是失败）", () => {
    const reminders = reviewReminders({
      goals: [goal({ evidenceCount: 0 })],
      notes: [],
      materials: [],
      staleReferences: [],
    });
    expect(reminders.filter((r) => r.kind === "goal-achieve")).toHaveLength(0);
  });

  it("过期与失效的引用各自说清原因", () => {
    const reminders = reviewReminders({
      goals: [],
      notes: [],
      materials: [],
      staleReferences: [
        { noteId: "n1", title: "改过的", status: "changed" },
        { noteId: "n2", title: "删掉的", status: "missing" },
      ],
    });
    const stale = reminders.filter((r) => r.kind === "reference-stale");
    expect(stale).toHaveLength(2);
    expect(stale.find((r) => r.targetId === "n1")?.action).toContain("过期");
    expect(stale.find((r) => r.targetId === "n2")?.action).toContain("失效");
  });

  it("收件箱堆积到阈值才提醒", () => {
    const few = reviewReminders({
      goals: [], notes: [], staleReferences: [],
      materials: [material({ id: "m1" }), material({ id: "m2" })],
      inboxThreshold: 5,
    });
    expect(few.filter((r) => r.kind === "inbox-backlog")).toHaveLength(0);
    const many = reviewReminders({
      goals: [], notes: [], staleReferences: [],
      materials: Array.from({ length: 6 }, (_, i) => material({ id: `m${i}` })),
      inboxThreshold: 5,
    });
    expect(many.filter((r) => r.kind === "inbox-backlog")).toHaveLength(1);
  });

  it("已整理的素材（不在收件箱）不计入堆积", () => {
    const reminders = reviewReminders({
      goals: [], notes: [], staleReferences: [],
      materials: Array.from({ length: 6 }, (_, i) => material({ id: `m${i}`, inboxStatus: "processed" })),
      inboxThreshold: 5,
    });
    expect(reminders.filter((r) => r.kind === "inbox-backlog")).toHaveLength(0);
  });

  it("仅按实际知识库成员关系统计未归类笔记，排除回收站", () => {
    const notes = [
      { ...createNoteDraft(1), id: "filed", notebook: null },
      { ...createNoteDraft(1), id: "unfiled1", notebook: "笔记本" },
      { ...createNoteDraft(1), id: "unfiled2" },
      { ...createNoteDraft(1), id: "unfiled3" },
      { ...createNoteDraft(1), id: "deleted", isDeleted: true },
    ];
    const base = { goals: [], notes, materials: [], staleReferences: [] };
    // 未收到成员关系时不猜测。空集则明确表示没有任何笔记归入知识库。
    expect(reviewReminders(base).some((r) => r.kind === "note-unfiled")).toBe(false);
    const result = reviewReminders({ ...base, filedNoteIds: new Set(["filed"]) }).find((r) => r.kind === "note-unfiled");
    expect(result?.count).toBe(3);
    expect(result?.action).not.toContain("才搜得到");
    expect(reviewReminders({ ...base, filedNoteIds: new Set() }).find((r) => r.kind === "note-unfiled")?.count).toBe(4);
    expect(reviewReminders({ ...base, filedNoteIds: new Set(["filed", "unfiled1"]) }).some((r) => r.kind === "note-unfiled")).toBe(false);
  });

  it("项目范围按目标声明的项目过滤，而不是拿目标 id 比项目 id", () => {
    // goal.scope 存的是**项目 id**——目标是这么声明自己属于哪个项目的。
    const reminders = reviewReminders({
      goals: [goal({ id: "g1", scope: "p1" }), goal({ id: "g2", scope: "p2", title: "别的项目" })],
      notes: [], materials: [], staleReferences: [],
      projectScope: ["p1"],
    });
    const g = reminders.filter((r) => r.kind === "goal-achieve");
    expect(g).toHaveLength(1);
    expect(g[0].targetId).toBe("g1");
    expect(g[0].projectId).toBe("p1");
  });

  it("没有声明项目的目标不进任何项目范围（不猜归属）", () => {
    const reminders = reviewReminders({
      goals: [goal({ id: "g1", scope: null })],
      notes: [], materials: [], staleReferences: [],
      projectScope: ["p1"],
    });
    expect(reminders.filter((r) => r.kind === "goal-achieve")).toHaveLength(0);
  });

  it("引用提醒按笔记所属项目归属", () => {
    const reminders = reviewReminders({
      goals: [], notes: [], materials: [],
      staleReferences: [{ noteId: "n1", title: "过期引用", status: "changed" }],
      noteProject: new Map([["n1", "p1"]]),
      projectScope: ["p1"],
    });
    expect(reminders.filter((r) => r.kind === "reference-stale")).toHaveLength(1);
  });

  it("限定项目范围时，全局事项（收件箱堆积）不出现", () => {
    const reminders = reviewReminders({
      goals: [], notes: [], staleReferences: [],
      materials: Array.from({ length: 6 }, (_, i) => material({ id: `m${i}` })),
      inboxThreshold: 5,
      projectScope: ["p1"],
    });
    expect(reminders.filter((r) => r.kind === "inbox-backlog")).toHaveLength(0);
  });

  it("没有任何可处理事项时提醒列表为空（不是「一切正常」的噪声）", () => {
    const reminders = reviewReminders({ goals: [], notes: [], materials: [], staleReferences: [] });
    expect(reminders).toHaveLength(0);
  });
});

describe("回顾计划的读写", () => {
  it("缺省时给出默认计划", () => {
    expect(readReviewSchedule({})).toEqual(defaultReviewSchedule);
  });

  it("读回已保存的计划", () => {
    const raw = writeReviewSchedule({}, {
      frequency: "daily",
      quietHours: { start: 21, end: 7 },
      paused: true,
      projectScope: ["p1"],
      lastRemindedAt: 123,
    });
    const s = readReviewSchedule(raw);
    expect(s.frequency).toBe("daily");
    expect(s.quietHours).toEqual({ start: 21, end: 7 });
    expect(s.paused).toBe(true);
    expect(s.projectScope).toEqual(["p1"]);
    expect(s.lastRemindedAt).toBe(123);
  });

  it("显式不设安静时段可以写入并读回，缺省值仍采用默认时段", () => {
    const raw = writeReviewSchedule({}, schedule({ quietHours: null }));
    expect(readReviewSchedule(raw).quietHours).toBeNull();
    expect(readReviewSchedule({ reviewSchedule: {} }).quietHours).toEqual(defaultReviewSchedule.quietHours);
  });

  it("坏数据退回默认（不让一份坏设置把提醒功能整个锁死）", () => {
    expect(readReviewSchedule({ reviewSchedule: "不是对象" }).frequency).toBe(defaultReviewSchedule.frequency);
    expect(readReviewSchedule({ reviewSchedule: { frequency: "每小时" } }).frequency).toBe(defaultReviewSchedule.frequency);
    expect(readReviewSchedule({ reviewSchedule: { quietHours: { start: 99, end: 2 } } }).quietHours)
      .toEqual(defaultReviewSchedule.quietHours);
  });
});
