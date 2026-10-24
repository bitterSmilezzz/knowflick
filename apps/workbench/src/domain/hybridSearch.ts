/**
 * 混合检索 RRF (Reciprocal Rank Fusion) 融合排序算法
 * 将关键词 BM25 与向量相似度/语义排序等多路信号无量纲融合
 */

export interface RankedItem<T> {
  item: T;
  score: number;
}

/**
 * RRF 算法核心
 * @param rankings 各检索路召回的有序列表（从最相关到最不相关）
 * @param k 平滑常数，默认 60
 * @param idExtractor 提取条目唯一标识的函数
 */
export function reciprocalRankFusion<T>(
  rankings: Array<T[]>,
  idExtractor: (item: T) => string,
  k = 60
): RankedItem<T>[] {
  const scores = new Map<string, { item: T; score: number }>();

  for (const list of rankings) {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank];
      const id = idExtractor(item);
      const contribution = 1 / (k + rank + 1);

      const existing = scores.get(id);
      if (existing) {
        existing.score += contribution;
      } else {
        scores.set(id, { item, score: contribution });
      }
    }
  }

  return Array.from(scores.values()).sort((a, b) => b.score - a.score);
}
