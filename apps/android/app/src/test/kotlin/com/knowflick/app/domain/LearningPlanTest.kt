package com.knowflick.app.domain

import java.time.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class LearningPlanTest {
    private val today = LocalDate.of(2026, 9, 12)
    private val zone = java.time.ZoneId.systemDefault()

    private fun seenNDaysAgo(days: Long): Long =
        today.minusDays(days).atTime(12, 0).atZone(zone).toInstant().toEpochMilli()

    private fun card(
        headline: String,
        seenAt: Long? = null,
        reviewedAt: Long? = null,
        masteryLevel: Int = 0,
    ): KnowledgeCard = KnowledgeCard.create("学习", headline, "摘要", "正文", source = CardSource.SEED)
        .copy(seenAt = seenAt, lastReviewedAt = reviewedAt, masteryLevel = masteryLevel)

    @Test
    fun firstReviewIsDayAfterReading() {
        val card = card("首次复习", seenAt = seenNDaysAgo(2))
        assertNull(LearningPlan(emptyList(), today).due.firstOrNull())
        val plan = LearningPlan(listOf(card), today)
        assertEquals(1, plan.due.size, "浏览于两天前：次日即到期")
    }

    @Test
    fun gradedCardsUseMasteryIntervals() {
        // 浏览于 9/10、评分于 9/11（昨天）：next = 评分日 + 间隔
        val base = card("已评分", seenAt = seenNDaysAgo(2), reviewedAt = seenNDaysAgo(1))
        val forgot = base.copy(masteryLevel = 0)
        assertEquals(today, LearningPlan(emptyList(), today).let { LearningPlan(listOf(forgot), today).reviewDate(forgot) },
            "遗忘（mastery=0）间隔 1 天 → 今天到期")
        val hesitant = base.copy(masteryLevel = 1)
        assertEquals(today.plusDays(2), LearningPlan(listOf(hesitant), today).reviewDate(hesitant),
            "犹豫（mastery=1）间隔 3 天：评分日 9/11 + 3 = 9/14")
        val mastered = base.copy(masteryLevel = 2)
        assertEquals(today.plusDays(6), LearningPlan(listOf(mastered), today).reviewDate(mastered),
            "掌握（mastery=2）间隔 7 天：评分日 9/11 + 7 = 9/18")

        // 到期口径：犹豫卡评分于 3 天前 → 今天到期；掌握卡评分于 1 天前 → 未到期
        val dueNow = base.copy(masteryLevel = 1).copy(lastReviewedAt = seenNDaysAgo(3))
        val notDue = base.copy(masteryLevel = 2).copy(lastReviewedAt = seenNDaysAgo(1))
        val plan = LearningPlan(listOf(dueNow, notDue), today)
        assertEquals(listOf(dueNow.id), plan.due.map { it.id })
    }

    @Test
    fun ungradedAndMasteredCounts() {
        val plan = LearningPlan(
            listOf(
                card("今天看过", seenAt = seenNDaysAgo(0)),
                card("已掌握", seenAt = seenNDaysAgo(1), reviewedAt = seenNDaysAgo(1), masteryLevel = 2),
            ),
            today,
        )
        assertEquals(1, plan.completedToday)
        assertEquals(1, plan.mastered)
    }

    @Test
    fun masteryDistributionMetrics() {
        val cards = listOf(
            card("卡1", seenAt = seenNDaysAgo(3), reviewedAt = seenNDaysAgo(1), masteryLevel = 2).copy(reviewCount = 3),
            card("卡2", seenAt = seenNDaysAgo(2), reviewedAt = seenNDaysAgo(1), masteryLevel = 1).copy(reviewCount = 2),
            card("卡3", seenAt = seenNDaysAgo(1), reviewedAt = seenNDaysAgo(1), masteryLevel = 0).copy(reviewCount = 1),
            card("未测卡", seenAt = seenNDaysAgo(1), masteryLevel = 0),
        )
        val plan = LearningPlan(cards, today)
        val dist = plan.masteryDistribution

        assertEquals(1, dist.masteredCount)
        assertEquals(1, dist.hesitantCount)
        assertEquals(2, dist.needsReviewCount)
        assertEquals(4, dist.totalCards)
        assertEquals(3, dist.testedCards) // 3 张有过测验评分
        // retentionRate = (1 * 1.0 + 1 * 0.5) / 3 * 100 = 50%
        assertEquals(50, dist.retentionRate)
        assertEquals(6, dist.totalReviews) // 3 + 2 + 1 + 0 = 6
    }

    @Test
    fun upcomingScheduleAndCards() {
        // 卡1: 昨天评分 masteryLevel=0 -> 1天间隔 -> 今天到期 (offset 0)
        val c1 = card("今日到期", reviewedAt = seenNDaysAgo(1), masteryLevel = 0)
        // 卡2: 昨天评分 masteryLevel=1 -> 3天间隔 -> 2天后到期 (offset 2)
        val c2 = card("后天到期", reviewedAt = seenNDaysAgo(1), masteryLevel = 1)
        // 卡3: 今天评分 masteryLevel=0 -> 1天间隔 -> 明天到期 (offset 1)
        val c3 = card("明天到期", reviewedAt = seenNDaysAgo(0), masteryLevel = 0)

        val plan = LearningPlan(listOf(c1, c2, c3), today)
        val schedule = plan.upcomingSchedule(7)

        assertEquals(7, schedule.size)
        assertEquals(1, schedule[0].count, "今日包含 c1")
        assertEquals(1, schedule[1].count, "明天包含 c3")
        assertEquals(1, schedule[2].count, "后天包含 c2")
        assertEquals(0, schedule[3].count)

        val upcoming = plan.upcomingCards(2)
        assertEquals(2, upcoming.size)
        assertEquals(c1.id, upcoming[0].first.id, "首张为今日到期")
        assertEquals(c3.id, upcoming[1].first.id, "第二张为明天到期")
    }
}
