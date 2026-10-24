import { describe, expect, it } from "vitest";
import { findNearDuplicates, hammingDistance, similarityFingerprint } from "./nearDuplicate";

describe("文字近似的重复候选（C04：候选、不自动删）", () => {
  const original = "北极星项目的周报：本周完成了检索模块的性能优化，万条数据下延迟从 33ms 降到 13.6ms，下周开始做语义索引。";

  it("指纹确定性；规范化不受大小写/空白/标点影响", () => {
    expect(similarityFingerprint(original)).toBe(similarityFingerprint(original));
    expect(similarityFingerprint(original)).toBe(
      similarityFingerprint("北极星项目的周报：本周完成了检索模块的性能优化，万条数据下延迟从 33ms 降到 13.6ms，下周开始做语义索引！")
    );
    expect(similarityFingerprint("")).toBe("");
  });

  it("改写少量措辞 → 命中候选；完全不同的话题 → 不命中", () => {
    const rewritten = "北极星项目的周报：本周完成了检索模块的性能优化，万条数据下延迟降到大约 13ms 的水平，下周开始做语义索引的工作。";
    const unrelated = "今天试着做了一个新菜谱：红烧牛腩要先焯水，再小火炖两个小时，最后收汁。";
    const candidates = findNearDuplicates(original, [
      { id: "n1", title: "改写版", body: rewritten },
      { id: "n2", title: "无关", body: unrelated },
    ]);
    expect(candidates.map((c) => c.id)).toEqual(["n1"]);
  });

  it("候选按距离非降序排列；完全相同的文本距离为 0", () => {
    // simhash 对微小差异可能不敏感（这正是它的用途）——加一个空格可能得到
    // 相同指纹。可靠性质是「非降序 + 相同文本必为 0」，不是相邻项严格不同。
    const close = original.replace("万条数据下延迟从 33ms 降到 13.6ms", "万条记录下延迟自 33ms 降至 13.6ms");
    const candidates = findNearDuplicates(original, [
      { id: "far", title: "较像", body: close },
      { id: "same", title: "相同", body: original },
    ]);
    expect(candidates.length).toBeGreaterThan(0, "两个相近条目都应成为候选——空数组会让下面的循环空过");
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i].distance).toBeGreaterThanOrEqual(candidates[i - 1].distance);
    }
    expect(candidates.find((c) => c.id === "same")?.distance).toBe(0);
  });

  it("空正文没有候选（不把空笔记互相判重）", () => {
    expect(findNearDuplicates("", [{ id: "x", title: "t", body: "anything" }])).toEqual([]);
    expect(findNearDuplicates(original, [{ id: "x", title: "t", body: "" }])).toEqual([]);
  });

  it("汉明距离边界：相同为 0，长度不同返回 64（视为完全不同）", () => {
    const fp = similarityFingerprint(original);
    expect(hammingDistance(fp, fp)).toBe(0);
    expect(hammingDistance(fp, "")).toBe(64);
  });
});
