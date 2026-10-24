import { describe, expect, it } from "vitest";
import { encodeSearchHistory, parseSearchHistory, pushSearchHistory, removeSearchHistory } from "./searchHistory";

describe("searchHistory", () => {
  it("parses a JSON string array and ignores junk", () => {
    expect(parseSearchHistory('["a","b"]')).toEqual(["a", "b"]);
    expect(parseSearchHistory("{}")).toEqual([]);
    expect(parseSearchHistory(null)).toEqual([]);
  });

  it("pushes with LRU cap of eight", () => {
    let list = pushSearchHistory([], "  first  ");
    list = pushSearchHistory(list, "second");
    list = pushSearchHistory(list, "first");
    expect(list).toEqual(["first", "second"]);
    list = Array.from({ length: 10 }, (_, index) => `q${index}`).reduce(
      (acc, query) => pushSearchHistory(acc, query),
      list,
    );
    expect(list).toHaveLength(8);
    expect(list[0]).toBe("q9");
  });

  it("removes one entry and round-trips encode", () => {
    const next = removeSearchHistory(["a", "b"], "a");
    expect(encodeSearchHistory(next)).toBe('["b"]');
  });
});
