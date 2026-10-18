import { describe, expect, it } from "vitest";
import { calculateFsrs, fsrsRetrievability } from "./review";
import type { KnowledgeCard } from "./card";

/**
 * FSRS 的跨端一致性（workbench 侧）。
 *
 * 与 `review.crossend.test.ts` 同源：ADR-0002 §3 要求「SM-2 / FSRS 字段按现在的 Kotlin 规则解释」。
 * 对端是 Kotlin：`apps/android/domain/src/jvmTest/.../spaced/FsrsEngineTest.kt`——
 * 那边多半是**性质断言**（递增 / 递减 / 重置），这里照搬同样的性质。
 *
 * 未镜像：Kotlin 的 `calculateInterval`（按目标留存率反推间隔）在 TS 侧没有对应 API。
 */
const baseCard: KnowledgeCard = {
  id: "TEST-FSRS-1",
  category: "量子物理",
  headline: "薛定谔的猫",
  summary: "量子叠加态与宏观观测",
  details: "正文详情...",
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

describe("FSRS 与 Android 侧同规则", () => {
  it("初次复习：稳定性随评分递增，难度递减", () => {
    const again = calculateFsrs(baseCard, "again", NOW);
    const hard = calculateFsrs(baseCard, "hard", NOW);
    const good = calculateFsrs(baseCard, "good", NOW);
    const easy = calculateFsrs(baseCard, "easy", NOW);

    expect(again.stability).toBeLessThan(hard.stability);
    expect(hard.stability).toBeLessThan(good.stability);
    expect(good.stability).toBeLessThan(easy.stability);

    expect(again.difficulty).toBeGreaterThan(hard.difficulty);
    expect(hard.difficulty).toBeGreaterThan(good.difficulty);
    expect(good.difficulty).toBeGreaterThan(easy.difficulty);

    expect(again.repetition).toBe(0);
    expect(good.repetition).toBe(1);
    expect(easy.repetition).toBe(1);
  });

  it("可提取率按幂律衰减，稳定性天附近约 90%", () => {
    const s = 10;
    expect(fsrsRetrievability(0, s)).toBeCloseTo(1.0, 3);

    const r5 = fsrsRetrievability(5, s);
    const r10 = fsrsRetrievability(10, s);
    const r30 = fsrsRetrievability(30, s);
    expect(r5).toBeGreaterThan(r10);
    expect(r10).toBeGreaterThan(r30);

    // 稳定性定义为「留存率降到 90% 的时间」，所以 10 天处应接近 0.90（Kotlin 侧容差 0.05）
    expect(r10).toBeGreaterThan(0.85);
    expect(r10).toBeLessThan(0.95);
  });

  it("连续成功复习会增长稳定性与间隔", () => {
    const first = calculateFsrs(baseCard, "good", NOW);
    const afterFirst: KnowledgeCard = {
      ...baseCard,
      repetition: first.repetition,
      intervalDays: first.intervalDays,
      stability: first.stability,
      difficulty: first.difficulty,
      lastReviewedAt: first.lastReviewedAt,
    };

    const second = calculateFsrs(afterFirst, "good", NOW);
    expect(second.stability).toBeGreaterThan(first.stability);
    expect(second.intervalDays).toBeGreaterThan(first.intervalDays);
    expect(second.repetition).toBe(2);
  });

  it("遗忘会重置重复计数并显著降低稳定性", () => {
    const lapsed: KnowledgeCard = {
      ...baseCard,
      repetition: 2,
      intervalDays: 6,
      stability: 6.0,
      difficulty: 4.0,
      lastReviewedAt: NOW - 7 * 86_400_000,
    };

    const again = calculateFsrs(lapsed, "again", NOW);
    expect(again.repetition).toBe(0);
    expect(again.intervalDays).toBe(1);
    expect(again.stability).toBeLessThan(lapsed.stability);
  });
});
