package com.knowflick.app.domain

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** 学习统计快照：从浏览记录纯派生，无视图依赖，可独立测试。移植自 StatsCalculator。 */
data class LearningStats(
    val seenCount: Int,
    val likedCount: Int,
    val skipCount: Int,
    val streakDays: Int,
    val categories: List<CategoryStat>,
) {
    /** 感兴趣率 = liked / seen */
    val likeRate: Double get() = if (seenCount > 0) likedCount.toDouble() / seenCount else 0.0

    data class CategoryStat(
        val category: String,
        val seen: Int,
        val liked: Int,
    ) {
        val likeRate: Double get() = if (seen > 0) liked.toDouble() / seen else 0.0
    }

    /** 单日已刷数量（用于趋势图） */
    data class DailyCount(val day: LocalDate, val count: Int)
}

/** 统计计算器：输入浏览记录，输出统计快照 */
object StatsCalculator {

    /** 最近 days 天（含 today）每天已刷数量，从最旧到最新 */
    fun dailyCounts(
        cards: List<KnowledgeCard>,
        today: LocalDate,
        days: Int = 7,
    ): List<LearningStats.DailyCount> {
        if (days <= 0) return emptyList()
        val counts = HashMap<LocalDate, Int>(minOf(cards.size, days))
        for (card in cards) {
            val seenAt = card.seenAt ?: continue
            val day = Instant.ofEpochMilli(seenAt).atZone(TIME_ZONE).toLocalDate()
            counts.merge(day, 1, Int::plus)
        }
        return (0 until days).reversed().map { offset ->
            LearningStats.DailyCount(day = today.minusDays(offset.toLong()), count = counts[today.minusDays(offset.toLong())] ?: 0)
        }
    }

    /** 从卡片数组派生统计。today 可注入以便测试边界情况。 */
    fun compute(cards: List<KnowledgeCard>, today: LocalDate): LearningStats {
        var seenCount = 0
        var likedCount = 0
        var skipCount = 0
        val categoryCounts = HashMap<String, IntArray>(32)   // [seen, liked]
        val seenCards = ArrayList<KnowledgeCard>(minOf(cards.size, 128))

        for (card in cards) {
            if (card.seenAt == null) continue
            seenCount += 1
            seenCards.add(card)
            val liked = card.swiped == SwipeDirection.RIGHT
            if (liked) likedCount += 1
            if (card.swiped == SwipeDirection.SKIP) skipCount += 1
            val counts = categoryCounts.getOrPut(card.category) { IntArray(2) }
            counts[0] += 1
            if (liked) counts[1] += 1
        }

        val categories = categoryCounts.map { (category, counts) ->
            LearningStats.CategoryStat(category = category, seen = counts[0], liked = counts[1])
        }.sortedWith(
            compareByDescending<LearningStats.CategoryStat> { it.seen }.thenBy { it.category },
        )

        return LearningStats(
            seenCount = seenCount,
            likedCount = likedCount,
            skipCount = skipCount,
            streakDays = streakDays(seenCards = seenCards, today = today),
            categories = categories,
        )
    }

    /**
     * 连续学习天数：seenAt 按日去重后，从今天（或昨天，保留当天空档）往前数连续天数。
     * 注意时区语义与 macOS 保持一致：以本地日历切日。
     */
    fun streakDays(seenCards: List<KnowledgeCard>, today: LocalDate): Int {
        val days = seenCards.mapNotNullTo(HashSet()) { card ->
            card.seenAt?.let { Instant.ofEpochMilli(it).atZone(TIME_ZONE).toLocalDate() }
        }
        if (days.isEmpty()) return 0
        var cursor = today
        if (cursor !in days) cursor = cursor.minusDays(1)
        var streak = 0
        while (cursor in days) {
            streak += 1
            cursor = cursor.minusDays(1)
        }
        return streak
    }

    /** 本地切日时区；macOS 端按设备本地日历，Android 端同为系统默认时区 */
    private val TIME_ZONE: java.time.ZoneId = java.time.ZoneId.systemDefault()
}
