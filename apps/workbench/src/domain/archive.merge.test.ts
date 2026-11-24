import { describe, expect, it } from "vitest";
import { mergeCard } from "./archive";
import type { KnowledgeCard } from "./card";

/**
 * 合并语义的跨端一致性（workbench 侧）。
 *
 * 对端是 Kotlin：`apps/android/domain/src/jvmTest/.../CardStoreTest.kt` 的
 * `detailsConflict*` 四个用例与「合并必须对称」那条断言——同一份输入、同一串期望。
 * 这条链是**导入合并**的核心（`archive.ts` 的 restoreArchive 走 `mergeCard(local, raw)`），
 * 两套对同一对卡片必须给出同一结果，否则同一个备份包在两个端上会合出不同的库。
 */
const detailsCard = (details: string, editedAt: number | null = null): KnowledgeCard => ({
  id: "same-id",
  category: "物理",
  headline: "同一张卡",
  summary: "摘要",
  details,
  links: [],
  source: "seed",
  createdAt: 1_000,
  editedAt,
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
});

describe("mergeCard 与 Android 侧同语义", () => {
  it("双方都有 editedAt 时新者赢——即使更短", () => {
    const a = detailsCard("短", 2_000);
    const b = detailsCard("更长的正文内容", 1_000);

    const merged = mergeCard(a, b);

    expect(merged.details).toBe("短");
    expect(mergeCard(b, a)).toEqual(merged); // 合并必须对称
  });

  it("任一方缺 editedAt 时退回「较长者」（v1 规则）", () => {
    const noStamp = detailsCard("短");
    const stampedLong = detailsCard("更长的正文内容", 1_000);

    expect(mergeCard(noStamp, stampedLong).details).toBe("更长的正文内容");

    const stampedShort = detailsCard("短", 2_000);
    const noStampLong = detailsCard("更长的正文内容");
    expect(mergeCard(stampedShort, noStampLong).details).toBe("更长的正文内容");
  });

  it("editedAt 持平也退回较长者，保证对称确定", () => {
    const a = detailsCard("短", 2_000);
    const b = detailsCard("更长的正文内容", 2_000);

    expect(mergeCard(a, b).details).toBe("更长的正文内容");
  });

  it("合并后的 editedAt 取较新者", () => {
    const a = detailsCard("正文", 2_000);
    const b = detailsCard("正文", 1_000);
    expect(mergeCard(a, b).editedAt).toBe(2_000);

    const noStamp = detailsCard("正文");
    expect(mergeCard(a, noStamp).editedAt).toBe(2_000);
    expect(mergeCard(noStamp, detailsCard("正文")).editedAt).toBeNull();
  });
});
