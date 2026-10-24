import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "./hybridSearch";

describe("混合检索 RRF 融合排序算法", () => {
  interface Doc {
    id: string;
    title: string;
  }

  it("当文档在两路检索中均排前列时，综合得分最高", () => {
    const listBM25: Doc[] = [
      { id: "doc-1", title: "SQLite 架构" },
      { id: "doc-2", title: "FTS5 搜索" },
      { id: "doc-3", title: "向量数据库" },
    ];

    const listVector: Doc[] = [
      { id: "doc-3", title: "向量数据库" },
      { id: "doc-1", title: "SQLite 架构" },
      { id: "doc-4", title: "RAG 实践" },
    ];

    const fused = reciprocalRankFusion([listBM25, listVector], (d) => d.id, 60);

    // doc-1 在第一路排 1，第二路排 2 -> 贡献 = 1/61 + 1/62 = 0.01639 + 0.01612 = 0.03251
    // doc-3 在第一路排 3，第二路排 1 -> 贡献 = 1/63 + 1/61 = 0.01587 + 0.01639 = 0.03226
    expect(fused[0].item.id).toBe("doc-1");
    expect(fused[1].item.id).toBe("doc-3");
    expect(fused.length).toBe(4);
  });

  it("单路召回的冷门文档也能合理排入候选", () => {
    const list1: Doc[] = [{ id: "doc-a", title: "A" }];
    const list2: Doc[] = [{ id: "doc-b", title: "B" }];

    const fused = reciprocalRankFusion([list1, list2], (d) => d.id, 60);
    expect(fused.length).toBe(2);
    expect(fused[0].score).toBe(fused[1].score);
  });
});
