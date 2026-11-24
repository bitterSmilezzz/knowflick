package com.knowflick.app.domain.spaced

import com.knowflick.app.domain.KnowledgeCard
import kotlin.math.exp
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * FSRS (Free Spaced Repetition Scheduler v4.5) 现代自适应间隔重复算法：
 * 基于认知科学三变量记忆模型：
 * 1. 稳定性（Stability S）：记忆从 100% 衰减至 90% 可提取率所需的时间（天数）；
 * 2. 难度（Difficulty D）：卡片内在记忆复杂度，取值范围 [1.0, 10.0]；
 * 3. 记忆可提取率（Retrievability R）：随时间衰减的即时回忆成功概率。
 */
object FsrsEngine {

    // 初始稳定性（AGAIN, HARD, GOOD, EASY 四档初始值，单位：天）
    private val W_INITIAL_S = doubleArrayOf(0.4, 1.2, 3.1, 8.5)

    // 初始难度与参数
    private const val W_INITIAL_D_BASE = 4.0
    private const val W_D_REVERSION = 0.1

    // 遗忘曲线幂律模型常数
    private const val FACTOR = 19.0 / 81.0
    private const val DECAY = -0.5

    /**
     * 计算指定经过天数 t 和稳定性 S 下的记忆可提取率 R(t, S)
     * 公式：R(t, S) = (1 + FACTOR * (t / S)) ^ DECAY
     */
    fun calculateRetrievability(elapsedDays: Double, stability: Double): Double {
        if (stability <= 0.0) return 1.0
        if (elapsedDays <= 0.0) return 1.0
        return (1.0 + FACTOR * (elapsedDays / stability)).pow(DECAY).coerceIn(0.0, 1.0)
    }

    /**
     * 根据当前稳定性 S 与目标留存率 requestRetention（默认 0.9 即 90%），反推下次复习间隔天数
     * 公式：I(r, S) = (S / FACTOR) * (r^(1/DECAY) - 1)
     */
    fun calculateInterval(stability: Double, requestRetention: Double = 0.90): Int {
        if (stability <= 0.0) return 1
        val r = requestRetention.coerceIn(0.70, 0.98)
        val interval = (stability / FACTOR) * (r.pow(1.0 / DECAY) - 1.0)
        return interval.roundToInt().coerceAtLeast(1)
    }

    /**
     * 执行 FSRS 状态迭代：
     * 计算新一轮的稳定性 S、难度 D、复习间隔与可提取率
     */
    fun calculate(
        card: KnowledgeCard,
        rating: SpacedRating,
        nowEpochMs: Long = System.currentTimeMillis(),
        requestRetention: Double = 0.90,
    ): SpacedReviewResult {
        val lastReviewed = card.lastReviewedAt ?: card.createdAt
        val elapsedDays = ((nowEpochMs - lastReviewed) / (1000.0 * 86400.0)).coerceAtLeast(0.0)

        val currentS = if (card.stability > 0.0) card.stability else card.intervalDays.toDouble().coerceAtLeast(1.0)
        val currentD = if (card.difficulty in 1.0..10.0) card.difficulty else (3.0 - (card.easeFactor - 1.3) * 1.5).coerceIn(1.0, 10.0)
        val currentR = calculateRetrievability(elapsedDays, currentS)

        val newS: Double
        val newD: Double

        val isFirstReview = card.repetition == 0 && card.stability <= 0.0

        if (isFirstReview) {
            val gradeIndex = when (rating) {
                SpacedRating.AGAIN -> 0
                SpacedRating.HARD -> 1
                SpacedRating.GOOD -> 2
                SpacedRating.EASY -> 3
            }
            newS = W_INITIAL_S[gradeIndex]
            newD = when (rating) {
                SpacedRating.AGAIN -> 7.0
                SpacedRating.HARD -> 5.5
                SpacedRating.GOOD -> 4.0
                SpacedRating.EASY -> 2.5
            }
        } else {
            // 难度演进与向中值均值回归
            val gradeDelta = when (rating) {
                SpacedRating.AGAIN -> 2.0
                SpacedRating.HARD -> 1.0
                SpacedRating.GOOD -> 0.0
                SpacedRating.EASY -> -1.0
            }
            val rawD = currentD + gradeDelta
            newD = (W_D_REVERSION * W_INITIAL_D_BASE + (1.0 - W_D_REVERSION) * rawD).coerceIn(1.0, 10.0)

            // 稳定性演进
            if (rating == SpacedRating.AGAIN) {
                // 忘却重来：稳定性骤降
                newS = (0.25 * newD.pow(-0.3) * (currentS + 1.0).pow(0.2) * exp(0.5 * (1.0 - currentR))).coerceAtLeast(0.3)
            } else {
                // 回忆成功：根据当前记忆难度与留存衰减程度奖励稳定性
                val hardBonus = if (rating == SpacedRating.HARD) 0.8 else 1.0
                val easyBonus = if (rating == SpacedRating.EASY) 1.3 else 1.0
                val reward = exp(2.4) * (11.0 - newD) * currentS.pow(-0.2) * (exp(1.0 - currentR) - 0.4) * hardBonus * easyBonus
                newS = (currentS * (1.0 + (reward / 10.0).coerceIn(0.1, 5.0))).coerceAtLeast(currentS + 0.5)
            }
        }

        val nextInterval = calculateInterval(newS, requestRetention)
        val newRepetition = if (rating == SpacedRating.AGAIN) 0 else card.repetition + 1
        val newMastery = when {
            newRepetition >= 3 || nextInterval >= 14 -> 2
            newRepetition >= 1 -> 1
            else -> 0
        }

        return SpacedReviewResult(
            cardId = card.id,
            repetition = newRepetition,
            intervalDays = nextInterval,
            easeFactor = (3.0 - (newD - 1.0) * 0.18).coerceIn(1.3, 3.0),
            masteryLevel = newMastery,
            lastReviewedAt = nowEpochMs,
            retrievability = (calculateRetrievability(0.0, newS) * 100).roundToInt(),
            stability = newS,
            difficulty = newD,
        )
    }
}
