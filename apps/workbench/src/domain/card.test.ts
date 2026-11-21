import { describe, expect, it } from "vitest";
import {
  cardFromJson,
  cardToJson,
  decodeCardList,
  encodeCardList,
  encodeDate,
  loadCardList,
  clearHistory,
  swipeCard,
  swipeDirectionLabel,
  undoSwipe,
  unseenDeck,
  type KnowledgeCard,
} from "./card";

const SWIFT = `{
  "id":"11111111-2222-3333-4444-555555555555",
  "category":"物理",
  "headline":"量子纠缠",
  "summary":"摘要",
  "details":"正文",
  "source":"ai",
  "createdAt":"2023-11-14T22:13:20Z",
  "seenAt":"2023-11-14T22:13:21Z",
  "swiped":"right",
  "isFavorite":true
}`;

describe("card wire format", () => {
  it("decodes the Swift ISO-8601 fixture", () => {
    const card = cardFromJson(JSON.parse(SWIFT));
    expect(card.createdAt).toBe(1_700_000_000_000);
    expect(card.seenAt).toBe(1_700_000_001_000);
    expect(card.swiped).toBe("right");
    expect(card.isFavorite).toBe(true);
    expect(card.source).toBe("ai");
  });

  it("encodes exact seconds without a fractional part", () => {
    expect(encodeDate(1_700_000_000_000)).toBe("2023-11-14T22:13:20Z");
    const card = cardFromJson(JSON.parse(SWIFT));
    expect(encodeCardList([card])).toContain('"createdAt":"2023-11-14T22:13:20Z"');
  });

  it("backfills favorite from a legacy right swipe", () => {
    const card = cardFromJson({
      id: "1",
      category: "历史",
      headline: "标题",
      summary: "摘要",
      details: "正文",
      source: "seed",
      createdAt: "2023-11-14T22:13:20Z",
      swiped: "right",
      seenAt: "2023-11-14T22:13:20Z",
    });
    expect(card.isFavorite).toBe(true);
    expect(card.favoritedAt).toBe(card.seenAt);
  });

  it("falls unknown sources back to seed and keeps numeric headlines", () => {
    const card = cardFromJson({ headline: 42, source: "alien" });
    expect(card.headline).toBe("42");
    expect(card.source).toBe("seed");
    expect(card.isFavorite).toBe(false);
  });

  it("accepts fractional seconds and epoch seconds", () => {
    expect(cardFromJson({ createdAt: "2026-01-02T03:04:05.678Z" }).createdAt).toBe(1_767_323_045_678);
    expect(cardFromJson({ createdAt: 1767323045 }).createdAt).toBe(1_767_323_045_000);
  });

  it("omits empty optional fields and zero FSRS values", () => {
    const card = cardFromJson({ id: "1", headline: "t" });
    const encoded = cardToJson({ ...card, createdAt: 1_700_000_000_000, stability: 0, difficulty: 0 });
    expect(encoded).not.toHaveProperty("editedAt");
    expect(encoded).not.toHaveProperty("stability");
    expect(encoded).not.toHaveProperty("subject");
    expect(encoded.intervalDays).toBe(1);
    expect(encoded.easeFactor).toBe(2.5);
  });

  it("treats an empty array as unusable and falls through to the backup", () => {
    expect(() => decodeCardList("[]")).toThrow();
    const loaded = loadCardList({
      main: "[]",
      backup: '[{"id":"b","headline":"备份","category":"","summary":"","details":"","source":"imported","createdAt":"2023-11-14T22:13:20Z"}]',
      backup2: null,
    });
    expect(loaded.recoveredFrom).toBe("backup");
    expect(loaded.cards[0]?.id).toBe("b");
  });
});

describe("swipe", () => {
  const fresh = (): KnowledgeCard => cardFromJson({ id: "s", headline: "一张", category: "物理" });

  it("clearHistory resets seenAt but keeps favorites and swiped", () => {
    const favorited = swipeCard(cardFromJson({ id: "f", headline: "收藏", category: "物理" }), "right", 1_000);
    const next = clearHistory([favorited, cardFromJson({ id: "u", headline: "未读", category: "物理" })]);
    expect(next[0]?.seenAt).toBeNull();
    expect(next[0]?.swiped).toBe("right");
    expect(next[0]?.isFavorite).toBe(true);
  });

  it("labels history rows like the Compose library", () => {
    expect(swipeDirectionLabel("right")).toBe("♥ 感兴趣");
    expect(swipeDirectionLabel("left")).toBe("✕ 不喜欢");
    expect(swipeDirectionLabel("skip")).toBe("↻ 跳过");
    expect(swipeDirectionLabel(null)).toBe("浏览");
  });

  it("right swipe favorites, left swipe clears, skip leaves favorite alone", () => {
    const right = swipeCard(fresh(), "right", 1_700_000_000_000);
    expect(right.swiped).toBe("right");
    expect(right.isFavorite).toBe(true);
    expect(right.seenAt).toBe(1_700_000_000_000);
    const left = swipeCard(right, "left", 1_700_000_100_000);
    expect(left.isFavorite).toBe(false);
    expect(left.favoritedAt).toBeNull();
    expect(left.seenAt).toBe(1_700_000_000_000);
    const skipped = swipeCard({ ...right, isFavorite: true }, "skip", 1_700_000_200_000);
    expect(skipped.isFavorite).toBe(true);
    expect(skipped.swiped).toBe("skip");
  });

  it("undo restores seenAt and swiped but keeps the favorite", () => {
    const before = fresh();
    const after = swipeCard(before, "right", 50);
    const undone = undoSwipe(after, before);
    expect(undone.seenAt).toBeNull();
    expect(undone.swiped).toBeNull();
    expect(undone.isFavorite).toBe(true);
  });

  it("hides AI cards when the source switch is off, and prefers named categories", () => {
    const cards = [
      cardFromJson({ id: "1", headline: "甲", category: "物理", source: "imported" }),
      cardFromJson({ id: "2", headline: "乙", category: "历史", source: "ai" }),
      cardFromJson({ id: "3", headline: "丙", category: "物理", source: "seed", seenAt: 10 }),
    ];
    expect(unseenDeck(cards, false, []).map((card) => card.id)).toEqual(["1"]);
    expect(unseenDeck(cards, true, ["历史"]).map((card) => card.id)).toEqual(["2"]);
  });
});
