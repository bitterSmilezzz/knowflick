package com.knowflick.app.domain

/**
 * 相关卡片推荐（详情页「延伸阅读」）：纯打分逻辑，**与宿主无关**。
 *
 * 规则（原样自 Android 宿主迁入，语义不变）：
 * - 同分类 +5；
 * - 标题按 2 字切片的交集，每命中一片 +2（中文短标题的近似关键词匹配）；
 * - 得分 > 0 才入选，取前 [limit] 张；同分保持卡库原顺序（`sortedByDescending` 稳定排序）。
 *
 * 抽进 `:domain` 的原因：桌面端的详情页要用同一套推荐，而按第一原则，逻辑只该有一份
 * （原先这段只写在 Android 的 `MainActivity` 里）。
 */
object RelatedCards {

    /** 标题切片长度：中文短标题下 2 字交叉最接近「关键词」直觉 */
    private const val SHINGLE_SIZE = 2

    private const val SAME_CATEGORY_SCORE = 5
    private const val SHARED_SHINGLE_SCORE = 2

    fun pick(
        card: KnowledgeCard,
        all: List<KnowledgeCard>,
        limit: Int = 3,
    ): List<KnowledgeCard> {
        if (limit <= 0) return emptyList()
        val cardShingles = shingles(card.headline)
        return all.asSequence()
            .filter { it.id != card.id }
            .map { other -> other to score(card, cardShingles, other) }
            .filter { (_, score) -> score > 0 }
            .sortedByDescending { (_, score) -> score }
            .take(limit)
            .map { (other, _) -> other }
            .toList()
    }

    private fun score(card: KnowledgeCard, cardShingles: Set<String>, other: KnowledgeCard): Int {
        var score = 0
        if (other.category == card.category) score += SAME_CATEGORY_SCORE
        score += (cardShingles intersect shingles(other.headline)).size * SHARED_SHINGLE_SCORE
        return score
    }

    private fun shingles(headline: String): Set<String> =
        headline.chunked(SHINGLE_SIZE).toSet()
}
