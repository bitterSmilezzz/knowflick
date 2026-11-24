package com.knowflick.app.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 相关卡片推荐的表征测试：这段算法原先只写在 Android 宿主的详情页接线里，
 * 迁进 `:domain` 后两端共用，所以用它把**迁移前的行为**钉住（打分口径、稳定排序、上限）。
 */
class RelatedCardsTest {

    private fun card(id: String, headline: String, category: String = "学习"): KnowledgeCard =
        KnowledgeCard.create(category, headline, "摘要", "正文", source = CardSource.SEED).copy(id = id)

    @Test
    fun sameCategoryScoresHigherThanUnrelated() {
        val subject = card("a", "光合作用", category = "生物")
        val sameCategory = card("b", "细胞呼吸", category = "生物")
        val unrelated = card("c", "资产负债表", category = "会计")

        val picked = RelatedCards.pick(subject, listOf(subject, sameCategory, unrelated))

        assertEquals(listOf(sameCategory.id), picked.map { it.id }, "只有同分类的会入选（其余得分 0）")
    }

    @Test
    fun sharedTitleShinglesAddScore() {
        val subject = card("a", "量子计算入门", category = "物理")
        val sharesTwoShingles = card("b", "量子计算进阶", category = "物理")
        val sharesOneShingle = card("c", "量子力学导论", category = "物理")

        val picked = RelatedCards.pick(subject, listOf(subject, sharesTwoShingles, sharesOneShingle))

        assertEquals(
            listOf(sharesTwoShingles.id, sharesOneShingle.id),
            picked.map { it.id },
            "命中切片多的排前面",
        )
    }

    @Test
    fun excludesItselfAndZerosAndRespectsLimit() {
        val subject = card("a", "主题卡")
        val others = (1..5).map { card("o$it", "主题卡 $it") }

        val picked = RelatedCards.pick(subject, listOf(subject) + others, limit = 3)

        assertEquals(3, picked.size, "上限生效")
        assertTrue(picked.none { it.id == subject.id }, "不含自己")
        assertEquals(others.take(3).map { it.id }, picked.map { it.id }, "同分时保持卡库原顺序")
    }

    @Test
    fun blankHeadlinesProduceNoRecommendations() {
        val subject = card("a", "", category = "空白")
        val other = card("b", "无关标题", category = "别的分类")

        assertTrue(RelatedCards.pick(subject, listOf(subject, other)).isEmpty())
    }

    @Test
    fun nonPositiveLimitReturnsEmpty() {
        val subject = card("a", "标题")
        assertTrue(RelatedCards.pick(subject, listOf(subject, card("b", "标题二")), limit = 0).isEmpty())
    }
}
