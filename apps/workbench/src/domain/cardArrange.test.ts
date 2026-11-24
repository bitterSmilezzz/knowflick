import { describe, expect, it } from "vitest";
import { arrange, deterministicHash } from "./cardArrange";
import { themeKeyForCard } from "./cardTheme";
import { cardFromJson } from "./card";

function card(id: string, headline: string, category = "冷知识") {
  return cardFromJson({ id, headline, category, summary: headline });
}

describe("card arrange", () => {
  it("matches Kotlin deterministicHash fixtures (unsigned 64-bit)", () => {
    expect(deterministicHash("knowflick")).toBe(10604710463354862449n);
    expect(deterministicHash("量子纠缠")).toBe(18303554525994447684n);
  });

  it("orders a deck without dropping cards", () => {
    const cards = Array.from({ length: 12 }, (_, index) => card(`c${index}`, `冷知识条目 ${index + 1}`));
    const ordered = arrange(cards);
    expect(ordered.map((c) => c.id).sort()).toEqual(cards.map((c) => c.id).sort());
  });

  it("avoids repeating the previous top theme key when asked", () => {
    const top = card("top", "量子纠缠与叠加态");
    const avoid = themeKeyForCard(top);
    const cards = [
      top,
      card("a", "月球潮汐锁定"),
      card("b", "斐波那契与素数"),
      card("c", "微波炉与咖啡保鲜"),
      card("d", "苏格拉底的伦理之问"),
      card("e", "Python 的 GIL 与 asyncio"),
    ];
    const ordered = arrange(cards, 5, avoid);
    expect(themeKeyForCard(ordered[0]!)).not.toBe(avoid);
  });
});
