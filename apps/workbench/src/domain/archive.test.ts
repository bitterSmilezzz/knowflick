import { describe, expect, it } from "vitest";
import { cardFromJson, encodeCardList, type KnowledgeCard } from "./card";
import { applyArchiveRestore, buildArchivePreview, decodeListSalvaging, restoreArchive } from "./archive";

function card(headline: string): KnowledgeCard {
  return cardFromJson({ id: crypto.randomUUID(), headline, category: "测试", summary: "摘要", details: "正文" });
}

describe("archive import", () => {
  it("decodes bare list and v2 envelope", () => {
    const one = card("信封卡");
    const bare = encodeCardList([one]);
    const envelope = JSON.stringify({ protocolVersion: 2, cards: JSON.parse(bare), tombstones: [] });
    expect(decodeListSalvaging(bare).map((c) => c.headline)).toEqual(["信封卡"]);
    expect(decodeListSalvaging(envelope).map((c) => c.headline)).toEqual(["信封卡"]);
  });

  it("restore merges by headline and preserves progress", () => {
    const local = card("跨设备恢复");
    const archived = {
      ...local,
      id: "OTHER-DEVICE-ID",
      source: "ai" as const,
      seenAt: 1_700_000_000_000,
      swiped: "right" as const,
      isFavorite: true,
      favoritedAt: 1_700_000_001_000,
      reviewCount: 5,
      masteryLevel: 2,
      lastReviewedAt: 1_700_000_002_000,
    };
    const { cards, result } = restoreArchive([local], [archived]);
    expect(result).toEqual({ added: 0, restored: 1, ignored: 0 });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.id).toBe(local.id);
    expect(cards[0]?.source).toBe("ai");
    expect(cards[0]?.reviewCount).toBe(5);
    expect(cards[0]?.isFavorite).toBe(true);
  });

  it("keeps local study state when archive omits it", () => {
    const local = {
      ...card("本机已收藏已浏览"),
      seenAt: 1_700_000_000_000,
      swiped: "right" as const,
      isFavorite: true,
      favoritedAt: 1_700_000_001_000,
      reviewCount: 3,
      masteryLevel: 2,
    };
    const archived = {
      ...local,
      id: "OTHER-DEVICE-ID",
      seenAt: null,
      swiped: null,
      isFavorite: false,
      favoritedAt: null,
      reviewCount: 0,
      masteryLevel: 0,
      lastReviewedAt: null,
    };
    const { cards } = restoreArchive([local], [archived]);
    expect(cards[0]?.isFavorite).toBe(true);
    expect(cards[0]?.seenAt).toBe(1_700_000_000_000);
    expect(cards[0]?.reviewCount).toBe(3);
    expect(cards[0]?.masteryLevel).toBe(2);
  });

  it("builds preview stats and overwrites on full restore", () => {
    const cards = [
      { ...card("a"), seenAt: 1, isFavorite: true, swiped: "right" as const },
      card("b"),
    ];
    const preview = buildArchivePreview("pack.zip", cards, "{}", true);
    expect(preview.totalCards).toBe(2);
    expect(preview.readCards).toBe(1);
    expect(preview.favoritedCards).toBe(1);
    expect(preview.categoriesSummary["测试"]).toBe(2);
    const incoming = [card("only")];
    const { cards: replaced } = applyArchiveRestore(cards, { ...preview, parsedCards: incoming }, "overwrite");
    expect(replaced).toHaveLength(1);
    expect(replaced[0]?.headline).toBe("only");
  });

  it("adds new cards and ignores blank headlines", () => {
    const existing = card("已有卡");
    const archived = cardFromJson({
      id: "ARCHIVE-STABLE-ID",
      category: "AI",
      headline: "归档新卡",
      summary: "摘要",
      details: "正文",
      source: "ai",
    });
    const blank = { ...archived, id: "BLANK-ID", headline: "  " };
    const { cards, result } = restoreArchive([existing], [archived, blank]);
    expect(result).toEqual({ added: 1, restored: 0, ignored: 1 });
    expect(cards.some((c) => c.id === "ARCHIVE-STABLE-ID")).toBe(true);
  });
});
