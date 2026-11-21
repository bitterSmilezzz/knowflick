import { describe, expect, it } from "vitest";
import { cardFromJson } from "./card";
import { buildDeckIds, eligibleDeck, promoteDeckIds, refreshDeckIds } from "./deckSession";

function card(id: string, headline: string, category = "测试"): ReturnType<typeof cardFromJson> {
  return cardFromJson({ id, headline, category });
}

describe("deck session", () => {
  it("prefers selected categories but falls back when none match", () => {
    const pool = [
      card("a", "甲", "物理"),
      card("b", "乙", "历史"),
      card("c", "丙", "物理"),
    ];
    expect(eligibleDeck(pool, true, ["物理"]).map((c) => c.id)).toEqual(["a", "c"]);
    expect(eligibleDeck(pool, true, ["不存在的分类"]).map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(eligibleDeck(pool, false, []).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("promotes a card to the top of the deck queue", () => {
    expect(promoteDeckIds(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(promoteDeckIds(["a", "b"], "a")).toEqual(["a", "b"]);
  });

  it("keeps order after top card is swiped away", () => {
    const pool = [card("a", "甲"), card("b", "乙"), card("c", "丙")];
    const initial = buildDeckIds(pool);
    const afterSwipe = refreshDeckIds(initial, pool.slice(1), null);
    expect(afterSwipe[0]).toBe(initial[1]);
  });

  it("retains pinned ids that are outside the unseen pool", () => {
    const pool = [card("a", "甲")];
    const refreshed = refreshDeckIds(["seen", "a"], pool, null, new Set(["seen"]));
    expect(refreshed).toEqual(["seen", "a"]);
  });
});
