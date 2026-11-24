package com.knowflick.app.domain

import java.time.LocalDate
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 跨轮测验编排（[QuizCycle]）的表征测试。
 *
 * 这套编排原先只长在 Android 的 ViewModel 里；抽到 :domain 后两端（Android / 桌面）共用，
 * 所以它的行为必须有独立测试钉住——迁移不该改变任何语义。
 */
class QuizCycleTest {
    private val today = LocalDate.of(2026, 9, 12)

    private fun atDaysAgo(days: Long): Long =
        today.minusDays(days).atTime(12, 0).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()

    private fun card(headline: String, seenDaysAgo: Long? = null, favorite: Boolean = false): KnowledgeCard =
        KnowledgeCard.create("学习", headline, "摘要", "正文", source = CardSource.SEED).copy(
            seenAt = seenDaysAgo?.let { atDaysAgo(it) },
            isFavorite = favorite,
            favoritedAt = if (favorite) atDaysAgo(seenDaysAgo ?: 1) else null,
        )

    private fun storeOf(vararg cards: KnowledgeCard): CardStore =
        CardStore().apply { replaceAll(cards.toList()) }

    @Test
    fun startBuildsSessionAndRateAdvances() {
        val a = card("甲")
        val b = card("乙")
        val store = storeOf(a, b)
        val cycle = QuizCycle(store)

        cycle.start(today, limit = 10)

        val session = assertNotNull(cycle.session, "start 之后应有一轮会话")
        assertEquals(2, session.total)
        assertTrue(cycle.isActive)

        val first = assertNotNull(session.current)
        assertTrue(cycle.rate(QuizRating.MASTERED), "评分应被记录")

        assertNotNull(cycle.session)
        assertFalse(cycle.session!!.current?.id == first.id, "评分后应前进到下一张")
    }

    @Test
    fun rateRecordsSpacedRepetitionIntoStore() {
        val a = card("甲", seenDaysAgo = 2)
        val store = storeOf(a)
        val cycle = QuizCycle(store)
        cycle.start(today, limit = 10)

        assertTrue(cycle.rate(QuizRating.MASTERED))

        val updated = assertNotNull(store.cards.firstOrNull { it.id == a.id })
        assertEquals(1, updated.reviewCount, "评分要经 SM-2 记进卡库")
        assertNotNull(updated.lastReviewedAt, "复习时间应被写入")
        assertTrue(updated.repetition > 0, "连续成功次数应推进")
    }

    @Test
    fun rateWithoutSessionIsNoOp() {
        val cycle = QuizCycle(storeOf(card("甲")))
        assertFalse(cycle.rate(QuizRating.MASTERED), "没有会话时评分应返回 false（宿主据此不落盘）")
    }

    @Test
    fun nextRoundExcludesRatedCardsThenResets() {
        val a = card("甲")
        val b = card("乙")
        val c = card("丙")
        val store = storeOf(a, b, c)
        val cycle = QuizCycle(store)

        cycle.start(today, limit = 3)
        // 把这一轮全部评完（顺序由会话决定，所以逐个评直到结束）
        while (cycle.session?.isFinished == false) {
            assertTrue(cycle.rate(QuizRating.MASTERED))
        }

        // 全部评过 → 下一轮应重置周期并重新给出卡片，而不是空轮
        cycle.nextRound(today, limit = 3)
        val next = assertNotNull(cycle.session)
        assertEquals(3, next.total, "都评完后应回到全库，而不是给出空轮")
        assertNotNull(next.current)
    }

    @Test
    fun nextRoundKeepsUnratedCardsOnly() {
        val cards = (1..4).map { card("卡$it") }
        val store = storeOf(*cards.toTypedArray())
        val cycle = QuizCycle(store)

        cycle.start(today, limit = 2)
        while (cycle.session?.isFinished == false) {
            assertTrue(cycle.rate(QuizRating.MASTERED))
        }
        cycle.nextRound(today, limit = 10)

        val rated = store.cards.filter { it.reviewCount > 0 }.map { it.id }.toSet()
        val nextIds = assertNotNull(cycle.session).cards.map { it.id }
        assertTrue(nextIds.none { it in rated }, "下一轮不应再出现本周期已评过的卡")
    }

    @Test
    fun retestWeakPicksForgottenAndHesitant() {
        val a = card("甲")
        val b = card("乙")
        val store = storeOf(a, b)
        val cycle = QuizCycle(store)

        cycle.retestWeak(mapOf(a.id to QuizRating.FORGOT, b.id to QuizRating.MASTERED))

        val session = assertNotNull(cycle.session)
        assertEquals(listOf(a.id), session.cards.map { it.id }, "只重测没掌握的卡")
    }

    @Test
    fun exitClearsSessionAndCycle() {
        val store = storeOf(card("甲"))
        val cycle = QuizCycle(store)
        cycle.start(today, limit = 10)
        cycle.rate(QuizRating.MASTERED)

        cycle.exit()

        assertNull(cycle.session)
        assertFalse(cycle.isActive)

        // 周期已清空：重新开始时不算「已评过」
        cycle.start(today, limit = 10)
        assertEquals(1, assertNotNull(cycle.session).total)
    }
}
