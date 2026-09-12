package com.knowflick.app.domain

import java.time.LocalDate
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class StatsCalculatorTest {
    private val today: LocalDate = LocalDate.of(2026, 9, 12)

    private fun atDay(daysAgo: Long, hour: Int = 12): Long =
        today.minusDays(daysAgo).atTime(hour, 0).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()

    private fun card(
        headline: String,
        seenAt: Long? = null,
        swiped: SwipeDirection? = null,
        category: String = "物理",
    ): KnowledgeCard = KnowledgeCard.create(category, headline, "摘要", "正文", source = CardSource.SEED)
        .let { base -> if (seenAt == null) base else base.copy(seenAt = seenAt, swiped = swiped) }

    @Test
    fun emptyDataProducesZeroStats() {
        val stats = StatsCalculator.compute(emptyList(), today)
        assertEquals(0, stats.seenCount)
        assertEquals(0.0, stats.likeRate, 1e-9)
        assertEquals(0, stats.streakDays)
        assertTrue(stats.categories.isEmpty())
    }

    @Test
    fun intentCountsFollowSwipeSemantics() {
        val cards = listOf(
            card("a", atDay(0), SwipeDirection.RIGHT),
            card("b", atDay(0), SwipeDirection.LEFT),
            card("c", atDay(0), SwipeDirection.SKIP),
            card("d", atDay(0), SwipeDirection.SKIP),
        )
        val stats = StatsCalculator.compute(cards, today)
        assertEquals(4, stats.seenCount)
        assertEquals(1, stats.likedCount)
        assertEquals(2, stats.skipCount)
        assertEquals(0.25, stats.likeRate, 1e-9)
    }

    @Test
    fun unfavoriteDoesNotAffectIntentCounts() {
        // 收藏解耦：取消收藏不改写 swiped，喜欢率统计不受影响
        val base = card("a", atDay(0), SwipeDirection.RIGHT)
        val unfavorited = base.copy(isFavorite = false, favoritedAt = null)
        val stats = StatsCalculator.compute(listOf(unfavorited), today)
        assertEquals(1, stats.likedCount)
    }

    @Test
    fun streakCountsWithTodayGapTolerance() {
        val yesterday = card("a", atDay(1))
        val dayBefore = card("b", atDay(2))
        // 今天未刷：从昨天起算
        assertEquals(2, StatsCalculator.compute(listOf(yesterday, dayBefore), today).streakDays)

        // 断档两天：连续天数归零
        val old = card("c", atDay(4))
        assertEquals(0, StatsCalculator.compute(listOf(old), today).streakDays)
    }

    @Test
    fun dailyCountsCoverSevenDaysOldestToNewest() {
        val cards = listOf(
            card("today", atDay(0)),
            card("today2", atDay(0)),
            card("twoDaysAgo", atDay(2)),
        )
        val counts = StatsCalculator.dailyCounts(cards, today, days = 7)
        assertEquals(7, counts.size)
        assertEquals(today, counts.last().day)
        assertEquals(2, counts.last().count)
        assertEquals(1, counts[4].count)   // 前天
        assertEquals(0, counts.first().count)
    }

    @Test
    fun categoryRowsSortedBySeenThenName() {
        val cards = listOf(
            card("a", atDay(0), SwipeDirection.RIGHT, category = "历史"),
            card("b", atDay(0), category = "历史"),
            card("c", atDay(0), category = "物理"),
        )
        val stats = StatsCalculator.compute(cards, today)
        assertEquals(listOf("历史", "物理"), stats.categories.map { it.category })
        assertEquals(2, stats.categories.first().seen)
        assertEquals(1, stats.categories.first().liked)
    }
}
