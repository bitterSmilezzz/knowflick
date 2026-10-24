import { describe, expect, it } from "vitest";
import { calculateSm2 } from "./review";
import type { KnowledgeCard } from "./card";

/**
 * 间隔重复的跨端一致性（workbench 侧）。
 *
 * ADR-0002 §3 写得很硬：「刷卡、收藏、SM-2 / FSRS 字段按现在的 Kotlin 规则解释，第一版不改算法」。
 * 对端是 Kotlin：`apps/android/domain/src/jvmTest/.../spaced/SpacedRepetitionEngineTest.kt`——
 * 同一张卡、同一次评分，两端的 repetition / intervalDays / masteryLevel 必须相同；
 * 不一致的后果很具体：**同一个卡库在两个端上会算出不同的到期日**。
 */
const baseCard: KnowledgeCard = {
  id: "TEST-SPACED-1",
  category: "认知科学",
  headline: "艾宾浩斯遗忘曲线揭示记忆衰减的非线性特征",
  summary: "在学习后数小时内遗忘最快，间隔重复能够有效重建神经突触连接强度。",
  details: "德国心理学家赫尔曼·艾宾浩斯通过无意义音节记忆实验首次绘制遗忘曲线。",
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

const NOW = 1_700_000_000_000;

/** 只取三端都有的那三个字段比对，避免把「现在几点」带进断言。 */
const shape = (card: KnowledgeCard, rating: "again" | "hard" | "good" | "easy") => {
  const r = calculateSm2(card, rating, NOW);
  return [r.repetition, r.intervalDays, r.masteryLevel];
};

describe("SM-2 与 Android 侧同规则", () => {
  it("第一次复习的四档间隔与掌握度", () => {
    expect(shape(baseCard, "again")).toEqual([0, 1, 0]);
    expect(shape(baseCard, "hard")).toEqual([1, 1, 1]);
    expect(shape(baseCard, "good")).toEqual([1, 1, 2]);
    expect(shape(baseCard, "easy")).toEqual([1, 2, 2]);
  });

  it("第二次复习：hard 3 天 / good 6 天 / easy 8 天", () => {
    const afterFirst = { ...baseCard, repetition: 1, intervalDays: 1, easeFactor: 2.5 };
    expect(calculateSm2(afterFirst, "hard", NOW).intervalDays).toBe(3);
    expect(calculateSm2(afterFirst, "good", NOW).intervalDays).toBe(6);
    expect(calculateSm2(afterFirst, "easy", NOW).intervalDays).toBe(8);
  });

  it("第三次复习按简易度增长；再次遗忘打回起点并降低简易度", () => {
    const afterSecond = { ...baseCard, repetition: 2, intervalDays: 6, easeFactor: 2.5 };

    const good = calculateSm2(afterSecond, "good", NOW);
    expect(good.repetition).toBe(3);
    expect(good.intervalDays).toBe(15); // 6 × 2.5

    const again = calculateSm2(afterSecond, "again", NOW);
    expect([again.repetition, again.intervalDays, again.masteryLevel]).toEqual([0, 1, 0]);
    expect(again.easeFactor).toBeLessThan(2.5);
  });
});
