package com.knowflick.app.domain

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * 掌握度三档分布及全局记忆健康度统计
 */
data class MasteryDistribution(
    val masteredCount: Int,         // Level 2 ★★ (熟练掌握，7天间隔)
    val hesitantCount: Int,         // Level 1 ★☆ (学习中/犹豫，3天间隔)
    val needsReviewCount: Int,      // Level 0 ☆☆ (需强化/未测验，1天间隔)
    val totalCards: Int,            // 卡片总数
    val testedCards: Int,           // 至少测验过一次或有熟练度的卡片数
    val retentionRate: Int,         // 记忆留存率 (0 ~ 100%)
    val totalReviews: Int,          // 累计复习总人次
)

/**
 * 单日待复习统计项（用于未来 7 天到期预测时间线）
 */
data class UpcomingDayStat(
    val date: LocalDate,
    val count: Int,
    val isToday: Boolean,
)

/**
 * 学习计划（到期复习队列）：与 macOS `LearningPlan` 逐语义对齐——
 * 首次复习为浏览次日；已再评的按评分间隔 1（遗忘）/3（犹豫）/7（掌握）天。
 * 到期 = 下次复习日期 ≤ 今天。
 */
data class LearningPlan(val cards: List<KnowledgeCard>, val today: LocalDate) {

    val completedToday: Int = cards.count { card ->
        listOfNotNull(card.seenAt, card.lastReviewedAt).any { instant ->
            Instant.ofEpochMilli(instant).atZone(TIME_ZONE).toLocalDate() == today
        }
    }

    val mastered: Int = cards.count { it.masteryLevel >= 2 }

    /** 掌握度分布与记忆留存指数 */
    val masteryDistribution: MasteryDistribution by lazy {
        val masteredCount = cards.count { it.masteryLevel >= 2 }
        val hesitantCount = cards.count { it.masteryLevel == 1 }
        val totalCards = cards.size
        val needsReviewCount = (totalCards - masteredCount - hesitantCount).coerceAtLeast(0)
        val testedCards = cards.count { it.reviewCount > 0 || it.masteryLevel > 0 }
        val retentionRate = if (testedCards == 0) {
            0
        } else {
            ((masteredCount * 1.0 + hesitantCount * 0.5) / testedCards * 100).toInt().coerceIn(0, 100)
        }
        val totalReviews = cards.sumOf { it.reviewCount }
        MasteryDistribution(
            masteredCount = masteredCount,
            hesitantCount = hesitantCount,
            needsReviewCount = needsReviewCount,
            totalCards = totalCards,
            testedCards = testedCards,
            retentionRate = retentionRate,
            totalReviews = totalReviews,
        )
    }

    /** 到期卡片：预计算到期时间再排序（与 macOS 优化一致），到期时间升序、并列按 id 稳定 */
    val due: List<KnowledgeCard> = cards.mapNotNull { card ->
        val date = reviewDate(card) ?: return@mapNotNull null
        if (date.isAfter(today)) null else card to date
    }.sortedWith(
        compareBy<Pair<KnowledgeCard, LocalDate>> { it.second }.thenBy { it.first.id },
    ).map { it.first }

    /** 未来天数（默认 7 天）到期卡片预测统计表 */
    fun upcomingSchedule(days: Int = 7): List<UpcomingDayStat> {
        return (0 until days).map { offset ->
            val targetDate = today.plusDays(offset.toLong())
            val count = if (offset == 0) {
                // 今天包含历史逾期 + 今天到期的卡片
                due.size
            } else {
                cards.count { card ->
                    reviewDate(card) == targetDate
                }
            }
            UpcomingDayStat(
                date = targetDate,
                count = count,
                isToday = (offset == 0),
            )
        }
    }

    /** 接下来近期按复习日期升序排列的待复习卡片清单 */
    fun upcomingCards(limit: Int = 5): List<Pair<KnowledgeCard, LocalDate>> {
        return cards.mapNotNull { card ->
            val date = reviewDate(card) ?: return@mapNotNull null
            card to date
        }.sortedWith(
            compareBy<Pair<KnowledgeCard, LocalDate>> { it.second }.thenBy { it.first.id },
        ).take(limit)
    }

    /** 下次复习日期：浏览次日为首次；已评分按 masteryLevel 间隔 1/3/7 天 */
    fun reviewDate(card: KnowledgeCard): LocalDate? {
        val last = card.lastReviewedAt ?: card.seenAt ?: return null
        val lastDay = Instant.ofEpochMilli(last).atZone(TIME_ZONE).toLocalDate()
        val days = if (card.lastReviewedAt == null) {
            1L
        } else {
            when {
                card.masteryLevel >= 2 -> 7L
                card.masteryLevel == 1 -> 3L
                else -> 1L
            }
        }
        return lastDay.plusDays(days)
    }

    private companion object {
        val TIME_ZONE: ZoneId = ZoneId.systemDefault()
    }
}
