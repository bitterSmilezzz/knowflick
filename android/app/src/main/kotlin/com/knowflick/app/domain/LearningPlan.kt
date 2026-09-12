package com.knowflick.app.domain

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

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

    /** 到期卡片：预计算到期时间再排序（与 macOS 优化一致），到期时间升序、并列按 id 稳定 */
    val due: List<KnowledgeCard> = cards.mapNotNull { card ->
        val date = reviewDate(card) ?: return@mapNotNull null
        if (date.isAfter(today)) null else card to date
    }.sortedWith(
        compareBy<Pair<KnowledgeCard, LocalDate>> { it.second }.thenBy { it.first.id },
    ).map { it.first }

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
