package com.knowflick.app.domain.spaced

import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.QuizRating
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import kotlin.math.exp
import kotlin.math.roundToInt

/**
 * 间隔重复自评档位（经典 SuperMemo SM-2 工业标准四档划分）：
 * - AGAIN: 完全遗忘 / 重来（Q=1）
 * - HARD: 困难回忆 / 犹豫（Q=3）
 * - GOOD: 良好掌握 / 顺利（Q=4）
 * - EASY: 极易秒答 / 熟练（Q=5）
 */
enum class SpacedRating(
    val masteryLevel: Int,
    val quality: Int,
    val label: String,
    val subLabel: String,
) {
    AGAIN(masteryLevel = 0, quality = 1, label = "重来", subLabel = "忘却"),
    HARD(masteryLevel = 1, quality = 3, label = "较难", subLabel = "犹豫"),
    GOOD(masteryLevel = 2, quality = 4, label = "良好", subLabel = "掌握"),
    EASY(masteryLevel = 2, quality = 5, label = "容易", subLabel = "秒答");

    companion object {
        fun fromQuizRating(quizRating: QuizRating): SpacedRating = when (quizRating) {
            QuizRating.FORGOT -> AGAIN
            QuizRating.HESITANT -> HARD
            QuizRating.MASTERED -> GOOD
        }
    }
}

/**
 * SM-2 计算结果包
 */
data class SpacedReviewResult(
    val cardId: String,
    val repetition: Int,
    val intervalDays: Int,
    val easeFactor: Double,
    val masteryLevel: Int,
    val lastReviewedAt: Long,
    val retrievability: Int,
)

/**
 * 工业级 SuperMemo SM-2 间隔重复与艾宾浩斯遗忘曲线引擎：
 * 1. 动态自适应间隔（Interval）与简易度（Ease Factor）演进；
 * 2. 艾宾浩斯遗忘曲线记忆可提取率（Retrievability）数学建模；
 * 3. 即时多档间隔预告（Preview Intervals）；
 * 4. 100% 向后兼容与三档/四档平滑映射。
 */
object SpacedRepetitionEngine {

    private val TIME_ZONE: ZoneId = ZoneId.systemDefault()

    /**
     * 根据当前卡片记忆状态与自评档位，计算下一阶段 SM-2 记忆参数
     */
    fun calculate(
        card: KnowledgeCard,
        rating: SpacedRating,
        nowEpochMs: Long = System.currentTimeMillis(),
    ): SpacedReviewResult {
        val q = rating.quality
        val prevRepetition = card.repetition
        val prevInterval = card.intervalDays.coerceAtLeast(1)
        val prevEf = card.easeFactor.coerceIn(1.3, 3.0)

        val newRepetition: Int
        val newInterval: Int

        if (q < 3) {
            // 忘却重来：连续成功计数清零，间隔归位到 1 天
            newRepetition = 0
            newInterval = 1
        } else {
            // 回忆成功：递增连续成功计数
            newRepetition = prevRepetition + 1
            newInterval = when (newRepetition) {
                1 -> if (rating == SpacedRating.EASY) 2 else 1
                2 -> when (rating) {
                    SpacedRating.HARD -> 3
                    SpacedRating.EASY -> 8
                    else -> 6
                }
                else -> {
                    val multiplier = when (rating) {
                        SpacedRating.HARD -> 1.2
                        SpacedRating.EASY -> prevEf * 1.3
                        else -> prevEf
                    }
                    val calculated = (prevInterval * multiplier).roundToInt()
                    calculated.coerceAtLeast(prevInterval + 1)
                }
            }
        }

        // 简易度更新公式：EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
        val deltaEf = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)
        val rawEf = prevEf + deltaEf
        val newEf = ((rawEf * 100.0).roundToInt() / 100.0).coerceIn(1.3, 3.0)

        // 熟练度同步对齐
        val newMastery = rating.masteryLevel

        return SpacedReviewResult(
            cardId = card.id,
            repetition = newRepetition,
            intervalDays = newInterval,
            easeFactor = newEf,
            masteryLevel = newMastery,
            lastReviewedAt = nowEpochMs,
            retrievability = 100, // 刚复习完时刻瞬时留存率定义为 100%
        )
    }

    /**
     * 预计算四档操作在当前卡片下的具体天数（用于在 UI 按钮上直观标注「1天 / 3天 / 6天 / 14天」）
     */
    fun previewNextIntervals(card: KnowledgeCard): Map<SpacedRating, Int> {
        return SpacedRating.entries.associateWith { rating ->
            calculate(card, rating).intervalDays
        }
    }

    /**
     * 艾宾浩斯遗忘曲线：计算卡片在当前时刻的记忆可提取率（Retrievability, 0 ~ 100%）
     * 数学模型：R(t) = exp(- k * t / S)，其中 k = ln(10/9) ≈ 0.10536
     * （在经过 interval 天时，预期记忆留存率为 90% 标准门限）
     */
    fun calculateRetrievability(
        card: KnowledgeCard,
        nowEpochMs: Long = System.currentTimeMillis(),
    ): Int {
        val lastEpochMs = card.lastReviewedAt ?: card.seenAt
        if (lastEpochMs == null) return 50 // 未读或未评测卡片基准留存估算

        val lastDate = Instant.ofEpochMilli(lastEpochMs).atZone(TIME_ZONE).toLocalDate()
        val nowDate = Instant.ofEpochMilli(nowEpochMs).atZone(TIME_ZONE).toLocalDate()
        val elapsedDays = ChronoUnit.DAYS.between(lastDate, nowDate).coerceAtLeast(0L)

        if (elapsedDays <= 0L) return 100

        val interval = card.intervalDays.coerceAtLeast(1).toDouble()
        // 目标留存衰减率: R = exp(- 0.10536 * (t / S))
        val exponent = -0.10536 * (elapsedDays / interval)
        val rate = exp(exponent) * 100.0

        return rate.roundToInt().coerceIn(10, 100)
    }
}
