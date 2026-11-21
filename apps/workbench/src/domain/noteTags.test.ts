import { describe, expect, it } from "vitest";
import { collectNoteTags, filterByTag } from "./noteTags";

describe("标签筛选（B03）", () => {
  it("统计出现过的标签与篇数，先按篇数再按名字", () => {
    const notes = [
      { tags: ["复盘", "周记"] },
      { tags: ["复盘"] },
      { tags: ["阅读", "复盘"] },
      { tags: [] },
    ];
    expect(collectNoteTags(notes)).toEqual([
      { tag: "复盘", count: 3 },
      { tag: "阅读", count: 1 },
      { tag: "周记", count: 1 },
    ]);
  });

  it("同一篇里的重复标签只算一次；空白标签被忽略", () => {
    expect(collectNoteTags([{ tags: ["a", "a", "  "] }])).toEqual([{ tag: "a", count: 1 }]);
  });

  it("按标签筛选；空标签返回全部（不改动入参）", () => {
    const notes = [{ tags: ["a"] }, { tags: ["b"] }];
    expect(filterByTag(notes, "a")).toHaveLength(1);
    expect(filterByTag(notes, "").length).toBe(2);
    expect(filterByTag(notes, "")).not.toBe(notes);
  });
});
