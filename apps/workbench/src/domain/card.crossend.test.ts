import { describe, expect, it } from "vitest";
import { cardFromJson, cardToJson } from "./card";

/**
 * 卡片线格式的跨端一致性检查（workbench 侧）。
 *
 * 对端是 Kotlin：`apps/android/domain/src/jvmTest/.../CardJsonCrossEndTest.kt`——
 * 同一份输入、同一串期望。ADR-0002 §3 要求两套「按安卓现在的结构读写，拷过去就能打开」，
 * 兜底规则一旦在某端漂移，这里或那边会红。
 */
const NOW = 1759000000000;
const base = {
  id: "x1",
  category: "物理",
  headline: "标题",
  summary: "摘要",
  details: "详情",
  source: "imported",
  createdAt: 1759000000000,
};

/** 解析 → 写出 → 键排序，得到与 Kotlin 侧可比的一串。 */
function canonical(input: Record<string, unknown>): string {
  const written = cardToJson(cardFromJson(input, NOW));
  const sorted = Object.fromEntries(Object.entries(written).sort(([a], [b]) => (a < b ? -1 : 1)));
  return JSON.stringify(sorted);
}

describe("卡片的跨端线格式契约", () => {
  it("最小卡写出的字段与 Android 侧一致", () => {
    expect(canonical({ ...base })).toBe(
      '{"category":"物理","createdAt":"2025-09-27T19:06:40Z","details":"详情","easeFactor":2.5,"headline":"标题","id":"x1","intervalDays":1,"isFavorite":false,"links":[],"masteryLevel":0,"repetition":0,"reviewCount":0,"source":"imported","summary":"摘要"}',
    );
  });

  it("未知字段、空串学科字段、越界 level 都不出现", () => {
    expect(canonical({ ...base, foo: 1, subject: "  ", level: 9, track: "" })).toBe(
      '{"category":"物理","createdAt":"2025-09-27T19:06:40Z","details":"详情","easeFactor":2.5,"headline":"标题","id":"x1","intervalDays":1,"isFavorite":false,"links":[],"masteryLevel":0,"repetition":0,"reviewCount":0,"source":"imported","summary":"摘要"}',
    );
  });

  it("epoch 秒被抬成毫秒再写成 ISO", () => {
    expect(canonical({ ...base, createdAt: 1700000000 })).toBe(
      '{"category":"物理","createdAt":"2023-11-14T22:13:20Z","details":"详情","easeFactor":2.5,"headline":"标题","id":"x1","intervalDays":1,"isFavorite":false,"links":[],"masteryLevel":0,"repetition":0,"reviewCount":0,"source":"imported","summary":"摘要"}',
    );
  });

  it("右划但缺 isFavorite 时回填收藏与收藏时间", () => {
    expect(canonical({ ...base, swiped: "right", seenAt: 1759000000000 })).toBe(
      '{"category":"物理","createdAt":"2025-09-27T19:06:40Z","details":"详情","easeFactor":2.5,"favoritedAt":"2025-09-27T19:06:40Z","headline":"标题","id":"x1","intervalDays":1,"isFavorite":true,"links":[],"masteryLevel":0,"repetition":0,"reviewCount":0,"seenAt":"2025-09-27T19:06:40Z","source":"imported","summary":"摘要","swiped":"right"}',
    );
  });

  it("未知 source 兜底成 seed", () => {
    expect(canonical({ ...base, source: "legacy" })).toBe(
      '{"category":"物理","createdAt":"2025-09-27T19:06:40Z","details":"详情","easeFactor":2.5,"headline":"标题","id":"x1","intervalDays":1,"isFavorite":false,"links":[],"masteryLevel":0,"repetition":0,"reviewCount":0,"source":"seed","summary":"摘要"}',
    );
  });
});
