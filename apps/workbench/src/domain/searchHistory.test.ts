import { describe, expect, it } from "vitest";
import {
  encodeSearchHistory,
  mergeSearchHistory,
  parseSearchHistory,
  pushSearchHistory,
  removeSearchHistory,
  validateSearchHistorySnapshot,
} from "./searchHistory";

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

  it("备份快照严格校验格式、重复项与条数上限", () => {
    expect(validateSearchHistorySnapshot(["a", "b"])).toEqual(["a", "b"]);
    expect(() => validateSearchHistorySnapshot({})).toThrow(/格式无效/);
    expect(() => validateSearchHistorySnapshot([" a "])).toThrow(/格式无效/);
    expect(() => validateSearchHistorySnapshot(["a", "a"])).toThrow(/重复/);
    expect(() => validateSearchHistorySnapshot(Array.from({ length: 9 }, (_, i) => `q${i}`))).toThrow(/超过上限/);
  });

  it("恢复时保留本地顺序、追加新词并报告重复和超限跳过", () => {
    expect(mergeSearchHistory(["local-new", "shared"], ["shared", "imported"])).toEqual({
      history: ["local-new", "shared", "imported"],
      added: 1,
      skipped: 1,
      alreadyPresent: 1,
      overLimit: 0,
    });
    const local = Array.from({ length: 8 }, (_, i) => `local-${i}`);
    expect(mergeSearchHistory(local, ["imported"])).toEqual({ history: local, added: 0, skipped: 1, alreadyPresent: 0, overLimit: 1 });
  });
});
