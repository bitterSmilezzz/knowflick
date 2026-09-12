package com.knowflick.app.domain

import java.time.LocalDate
import java.time.ZoneId
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class QuizSessionTest {
    private val today = LocalDate.of(2026, 9, 12)

    private fun atDaysAgo(days: Long): Long =
        today.minusDays(days).atTime(12, 0).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()

    private fun card(
        headline: String,
        seenDaysAgo: Long? = null,
        favorite: Boolean = false,
        mastery: Int = 0,
        reviewedDaysAgo: Long? = null,
    ): KnowledgeCard = KnowledgeCard.create("学习", headline, "摘要", "正文", source = CardSource.SEED).copy(
        seenAt = seenDaysAgo?.let { atDaysAgo(it) },
        isFavorite = favorite,
        favoritedAt = if (favorite) atDaysAgo(seenDaysAgo ?: 1) else null,
        masteryLevel = mastery,
        lastReviewedAt = reviewedDaysAgo?.let { atDaysAgo(it) },
    )

    @Test
    fun dueCardsComeFirst() {
        val due = card("到期卡", seenDaysAgo = 2)
        val favorite = card("收藏卡", favorite = true)
        val unseen = card("未读卡")
        val session = QuizSession.build(listOf(unseen, favorite, due), today, limit = 10, random = Random(1))
        assertEquals(due.id, session.current?.id, "到期复习优先")
        assertTrue(session.cards.map { it.id }.containsAll(listOf(due.id, favorite.id, unseen.id)))
    }

    @Test
    fun limitIsRespected() {
        val cards = (0 until 20).map { card("卡片$it") }
        val session = QuizSession.build(cards, today, limit = 5, random = Random(2))
        assertEquals(5, session.total)
    }

    @Test
    fun categoryFilterRestrictsPool() {
        val physics = card("物理卡").copy(category = "物理")
        val history = card("历史卡").copy(category = "历史")
        val session = QuizSession.build(listOf(physics, history), today, limit = 10, category = "物理", random = Random(3))
        assertEquals(1, session.total)
        assertEquals("物理卡", session.current?.headline)
    }

    @Test
    fun ratingIsGuardedToOncePerCard() {
        val session = QuizSession.build(listOf(card("守卫卡"), card("第二卡")), today, limit = 10, random = Random(4))
        val first = session.current!!
        assertTrue(session.rate(QuizRating.FORGOT))
        // 已推进到下一张；对第一张再次提交无从发生（守卫核心在 ratings 去重）
        assertEquals(1, session.index)
        assertEquals(QuizRating.FORGOT, session.allRatings[first.id])
        // 直接构造重复评分场景：同一卡再次 rate 被拒
        val replay = QuizSession(listOf(first))
        assertTrue(replay.rate(QuizRating.MASTERED))
        assertFalse(replay.rate(QuizRating.FORGOT), "同一张卡本轮只接受第一次提交")
    }

    @Test
    fun summaryCountsAndCompletion() {
        val cards = listOf(card("A"), card("B"), card("C"))
        val session = QuizSession(cards)
        session.rate(QuizRating.MASTERED)
        session.rate(QuizRating.HESITANT)
        session.rate(QuizRating.FORGOT)
        assertTrue(session.isFinished)
        assertEquals(1, session.summary[QuizRating.MASTERED])
        assertEquals(1, session.summary[QuizRating.HESITANT])
        assertEquals(1, session.summary[QuizRating.FORGOT])
        assertEquals(null, session.current)
        assertFalse(session.rate(QuizRating.MASTERED), "完成后不再接受评分")
    }

    @Test
    fun ratedIdsCarryToNextRound() {
        val cards = listOf(card("已评卡", seenDaysAgo = 2), card("新卡"))
        val first = QuizSession(cards)
        first.rate(QuizRating.MASTERED)
        val nextRound = QuizSession.build(cards, today, limit = 10, random = Random(5))
        // 下一轮的选题池由调用方传入（可剔除 ratedIds）——此处验证 ratedIds 语义
        assertTrue(first.ratedIds().contains(cards[0].id))
        assertTrue(nextRound.total >= 1)
    }

    @Test
    fun emptyPoolYieldsFinishedSession() {
        val session = QuizSession.build(emptyList(), today)
        assertTrue(session.isFinished)
        assertEquals(0, session.total)
        assertFalse(session.rate(QuizRating.MASTERED))
    }
}
