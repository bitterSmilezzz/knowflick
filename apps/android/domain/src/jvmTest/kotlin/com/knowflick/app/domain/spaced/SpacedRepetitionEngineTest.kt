package com.knowflick.app.domain.spaced

import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.QuizRating
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class SpacedRepetitionEngineTest {

    private val baseCard = KnowledgeCard(
        id = "TEST-SPACED-1",
        category = "认知科学",
        headline = "艾宾浩斯遗忘曲线揭示记忆衰减的非线性特征",
        summary = "在学习后数小时内遗忘最快，间隔重复能够有效重建神经突触连接强度。",
        details = "德国心理学家赫尔曼·艾宾浩斯通过无意义音节记忆实验首次绘制遗忘曲线。",
        links = emptyList(),
        source = CardSource.SEED,
        createdAt = 1000L,
    )

    @Test
    fun testFirstRepetitionIntervals() {
        // 第一次复习（rep=0）
        val againRes = SpacedRepetitionEngine.calculate(baseCard, SpacedRating.AGAIN)
        assertEquals(0, againRes.repetition)
        assertEquals(1, againRes.intervalDays)
        assertEquals(0, againRes.masteryLevel)

        val hardRes = SpacedRepetitionEngine.calculate(baseCard, SpacedRating.HARD)
        assertEquals(1, hardRes.repetition)
        assertEquals(1, hardRes.intervalDays)
        assertEquals(1, hardRes.masteryLevel)

        val goodRes = SpacedRepetitionEngine.calculate(baseCard, SpacedRating.GOOD)
        assertEquals(1, goodRes.repetition)
        assertEquals(1, goodRes.intervalDays)
        assertEquals(2, goodRes.masteryLevel)

        val easyRes = SpacedRepetitionEngine.calculate(baseCard, SpacedRating.EASY)
        assertEquals(1, easyRes.repetition)
        assertEquals(2, easyRes.intervalDays)
        assertEquals(2, easyRes.masteryLevel)
    }

    @Test
    fun testSecondRepetitionIntervals() {
        val cardAfterFirst = baseCard.copy(repetition = 1, intervalDays = 1, easeFactor = 2.5)

        val hardRes = SpacedRepetitionEngine.calculate(cardAfterFirst, SpacedRating.HARD)
        assertEquals(2, hardRes.repetition)
        assertEquals(3, hardRes.intervalDays)

        val goodRes = SpacedRepetitionEngine.calculate(cardAfterFirst, SpacedRating.GOOD)
        assertEquals(2, goodRes.repetition)
        assertEquals(6, goodRes.intervalDays)

        val easyRes = SpacedRepetitionEngine.calculate(cardAfterFirst, SpacedRating.EASY)
        assertEquals(2, easyRes.repetition)
        assertEquals(8, easyRes.intervalDays)
    }

    @Test
    fun testThirdRepetitionExponentialGrowth() {
        val cardAfterSecond = baseCard.copy(repetition = 2, intervalDays = 6, easeFactor = 2.5)

        val goodRes = SpacedRepetitionEngine.calculate(cardAfterSecond, SpacedRating.GOOD)
        assertEquals(3, goodRes.repetition)
        // 6 * 2.5 = 15 天
        assertEquals(15, goodRes.intervalDays)

        // 再次遗忘（AGAIN）必须打回起点
        val againRes = SpacedRepetitionEngine.calculate(cardAfterSecond, SpacedRating.AGAIN)
        assertEquals(0, againRes.repetition)
        assertEquals(1, againRes.intervalDays)
        assertEquals(0, againRes.masteryLevel)
        assertTrue(againRes.easeFactor < 2.5) // 简易度降低
    }

    @Test
    fun testEaseFactorBounds() {
        // 极低简易度不低于 1.3
        var card = baseCard.copy(easeFactor = 1.35)
        repeat(5) {
            val res = SpacedRepetitionEngine.calculate(card, SpacedRating.AGAIN)
            card = card.copy(easeFactor = res.easeFactor)
        }
        assertEquals(1.3, card.easeFactor, 0.001)

        // 极高简易度不高于 3.0
        var easyCard = baseCard.copy(easeFactor = 2.95)
        repeat(5) {
            val res = SpacedRepetitionEngine.calculate(easyCard, SpacedRating.EASY)
            easyCard = easyCard.copy(easeFactor = res.easeFactor)
        }
        assertEquals(3.0, easyCard.easeFactor, 0.001)
    }

    @Test
    fun testRetrievabilityCurve() {
        val now = System.currentTimeMillis()
        val oneDayMs = 86400000L

        // 刚刚复习过 (t=0)
        val freshCard = baseCard.copy(lastReviewedAt = now, intervalDays = 10)
        val r0 = SpacedRepetitionEngine.calculateRetrievability(freshCard, now)
        assertEquals(100, r0)

        // 恰好到达目标间隔天数 (t = interval = 10 天)，预期留存率在 90% 附近
        val dueCard = baseCard.copy(lastReviewedAt = now - 10 * oneDayMs, intervalDays = 10)
        val rDue = SpacedRepetitionEngine.calculateRetrievability(dueCard, now)
        assertTrue("At due date, retention should be around 90%, actual: $rDue", rDue in 88..92)

        // 严重逾期 (t = 25 天, interval = 5 天)，留存率显著下降
        val overdueCard = baseCard.copy(lastReviewedAt = now - 25 * oneDayMs, intervalDays = 5)
        val rOverdue = SpacedRepetitionEngine.calculateRetrievability(overdueCard, now)
        assertTrue("Overdue retention should drop, actual: $rOverdue", rOverdue in 10..65)
    }

    @Test
    fun testPreviewIntervals() {
        val card = baseCard.copy(repetition = 1, intervalDays = 1)
        val preview = SpacedRepetitionEngine.previewNextIntervals(card)

        assertEquals(1, preview[SpacedRating.AGAIN])
        assertEquals(3, preview[SpacedRating.HARD])
        assertEquals(6, preview[SpacedRating.GOOD])
        assertEquals(8, preview[SpacedRating.EASY])
    }

    @Test
    fun testQuizRatingMapping() {
        assertEquals(SpacedRating.AGAIN, SpacedRating.fromQuizRating(QuizRating.FORGOT))
        assertEquals(SpacedRating.HARD, SpacedRating.fromQuizRating(QuizRating.HESITANT))
        assertEquals(SpacedRating.GOOD, SpacedRating.fromQuizRating(QuizRating.MASTERED))
    }
}
