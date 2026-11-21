import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { localSemanticHashEmbedding } from "./embeddingEngine";

/**
 * Go 与 TypeScript 的哈希投影必须**逐位一致**：
 * 同一份笔记在两侧算出的向量若不同，向量检索就分裂成两个空间。
 * 向量由 `KF_GO_HASH_FIXTURE` 指定（Go 测试 TestExportHashVector 导出）。
 */
describe("哈希投影与 Go 实现对齐", () => {
  const fixture = process.env.KF_GO_HASH_FIXTURE;

  it.skipIf(!fixture)("同一文本的 128 维向量逐位相同", () => {
    const goVec = readFileSync(fixture!, "utf8").trim().split("\n").map(Number);
    const tsVec = localSemanticHashEmbedding("知识库检索与向量", 128);
    // 先钉住维度：空数组会让下面的循环一条断言都不跑，测试假通过。
    expect(tsVec.length).toBe(128);
    expect(goVec).toHaveLength(tsVec.length);
    const diffs = tsVec.map((value, i) => Math.abs(goVec[i] - value));
    const worst = Math.max(...diffs);
    const worstAt = diffs.indexOf(worst);
    expect(worst, `第 ${worstAt} 维：go ${goVec[worstAt]} vs ts ${tsVec[worstAt]}`).toBeLessThan(1e-6);
  });
});
