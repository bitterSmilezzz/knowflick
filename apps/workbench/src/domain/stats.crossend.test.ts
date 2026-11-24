import { describe, expect, it } from "vitest";
import { computeStats } from "./stats";
import type { KnowledgeCard, SwipeDirection } from "./card";

/**
 * 统计口径的跨端一致性（workbench 侧）。
 *
 * 统计是「从卡库纯派生」的——同一份卡库在两套里应该给出同样的数字，否则用户在两端看到
 * 不同的留存率/连续天数会以为数据坏了。对端是 Kotlin：
 * `apps/android/domain/src/jvmTest/.../StatsCalculatorTest.kt`，同一份输入、同一串期望。
 */
const TODAY = "2026-09-12";

/** 与 Kotlin 侧一致：目标日 12:00 的本地时间戳（Kotlin 用系统时区，这里用本地时区）。 */
const atDay = (daysAgo: number, hour = 12): number =>
  new Date(2026, 8, 12 - daysAgo, hour, 0, 0, 0).getTime();

const baseCard: KnowledgeCard = {
  id: "base",
  category: "物理",
  headline: "base",
  summary: "摘要",
  details: "正文",
  links: [],
  source: "seed",
  createdAt: 1_000,
  editedAt: null,
  seenAt: null,
  swiped: null,
  isFavorite: false,
  favoritedAt: null,
  reviewCount: 0,
  masteryLevel: 0,
  lastReviewedAt: null,
  repetition: 0,
  intervalDays: 1,
  easeFactor: 2.5,
  stability: 0,
  difficulty: 0,
  subject: null,
  branch: null,
  level: null,
  track: null,
  orderKey: null,
  prereq: [],
};

const card = (
  headline: string,
  seenAt: number | null = null,
  swiped: SwipeDirection | null = null,
  category = "物理",
): KnowledgeCard => ({ ...baseCard, id: headline, headline, category, seenAt, swiped });

describe("统计与 Android 侧同口径", () => {
  it("空数据产出全零", () => {
    const stats = computeStats([], TODAY);
    expect(stats.seenCount).toBe(0);
    expect(stats.likeRate).toBeCloseTo(0, 9);
    expect(stats.streakDays).toBe(0);
    expect(stats.categories).toHaveLength(0);
  });

  it("意图计数遵循划卡语义", () => {
    const cards = [
      card("a", atDay(0), "right"),
      card("b", atDay(0), "left"),
      card("c", atDay(0), "skip"),
      card("d", atDay(0), "skip"),
    ];
    const stats = computeStats(cards, TODAY);
    expect(stats.seenCount).toBe(4);
    expect(stats.likedCount).toBe(1);
    expect(stats.skipCount).toBe(2);
    expect(stats.likeRate).toBeCloseTo(0.25, 9);
  });

  it("取消收藏不改写 swiped，喜欢率不受影响", () => {
    const unfavorited = { ...card("a", atDay(0), "right"), isFavorite: false, favoritedAt: null };
    expect(computeStats([unfavorited], TODAY).likedCount).toBe(1);
  });

  it("连续天数容忍「今天还没刷」的空档", () => {
    expect(computeStats([card("a", atDay(1)), card("b", atDay(2))], TODAY).streakDays).toBe(2);
    // 断档两天 → 归零
    expect(computeStats([card("c", atDay(4))], TODAY).streakDays).toBe(0);
  });

  it("近 7 天趋势从旧到新，末位是今天", () => {
    const cards = [card("today", atDay(0)), card("today2", atDay(0)), card("twoDaysAgo", atDay(2))];
    const counts = computeStats(cards, TODAY).daily;
    expect(counts).toHaveLength(7);
    expect(counts[counts.length - 1]!.day).toBe(TODAY);
    expect(counts[counts.length - 1]!.count).toBe(2);
    expect(counts[4]!.count).toBe(1); // 前天
    expect(counts[0]!.count).toBe(0);
  });

  it("分类行按已读数排序，同名再比名称", () => {
    const cards = [
      card("a", atDay(0), "right", "历史"),
      card("b", atDay(0), null, "历史"),
      card("c", atDay(0), null, "物理"),
    ];
    const stats = computeStats(cards, TODAY);
    expect(stats.categories.map((row) => row.category)).toEqual(["历史", "物理"]);
    expect(stats.categories[0]!.seen).toBe(2);
    expect(stats.categories[0]!.liked).toBe(1);
  });
});
