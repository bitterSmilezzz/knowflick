package com.knowflick.app.domain.spaced

import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FsrsEngineTest {

    private val baseCard = KnowledgeCard.create(
        category = "量子物理",
        headline = "薛定谔的猫",
        summary = "量子叠加态与宏观观测",
        details = "正文详情...",
        source = CardSource.SEED,
    )

    @Test
    fun `test initial review assigns correct stability and difficulty for all ratings`() {
        val againRes = FsrsEngine.calculate(baseCard, SpacedRating.AGAIN)
        val hardRes = FsrsEngine.calculate(baseCard, SpacedRating.HARD)
        val goodRes = FsrsEngine.calculate(baseCard, SpacedRating.GOOD)
        val easyRes = FsrsEngine.calculate(baseCard, SpacedRating.EASY)

        // 验证初次复习初始稳定性递增
        assertTrue("AGAIN S < HARD S", againRes.stability < hardRes.stability)
        assertTrue("HARD S < GOOD S", hardRes.stability < goodRes.stability)
        assertTrue("GOOD S < EASY S", goodRes.stability < easyRes.stability)

        // 验证初次复习难度递减（AGAIN 最难，EASY 最易）
        assertTrue("AGAIN D > HARD D", againRes.difficulty > hardRes.difficulty)
        assertTrue("HARD D > GOOD D", hardRes.difficulty > goodRes.difficulty)
        assertTrue("GOOD D > EASY D", goodRes.difficulty > easyRes.difficulty)

        // 验证重复计数
        assertEquals(0, againRes.repetition)
        assertEquals(1, goodRes.repetition)
        assertEquals(1, easyRes.repetition)
    }

    @Test
    fun `test retrievability formula power law decay`() {
        val s = 10.0 // 10 天稳定性
        val r0 = FsrsEngine.calculateRetrievability(0.0, s)
        val r5 = FsrsEngine.calculateRetrievability(5.0, s)
        val r10 = FsrsEngine.calculateRetrievability(10.0, s)
        val r30 = FsrsEngine.calculateRetrievability(30.0, s)

        assertEquals("0天留存率应为 100%", 1.0, r0, 0.001)
        assertTrue("5天留存率高于10天", r5 > r10)
        assertTrue("10天留存率高于30天", r10 > r30)
        // 稳定性定义为达到 90% 留存率的时间
        assertEquals("10天留存率应接近 0.90", 0.90, r10, 0.05)
    }

    @Test
    fun `test interval calculation matches target retention`() {
        val s = 14.0
        val interval90 = FsrsEngine.calculateInterval(s, 0.90)
        val interval85 = FsrsEngine.calculateInterval(s, 0.85)

        assertTrue("较低的目标留存率允许更长的复习间隔", interval85 > interval90)
        assertEquals("90%目标留存率下间隔应接近稳定性自身", s.toInt(), interval90)
    }

    @Test
    fun `test repeated success increases stability and repetition`() {
        val res1 = FsrsEngine.calculate(baseCard, SpacedRating.GOOD)
        val card1 = baseCard.copy(
            repetition = res1.repetition,
            intervalDays = res1.intervalDays,
            stability = res1.stability,
            difficulty = res1.difficulty,
            lastReviewedAt = res1.lastReviewedAt,
        )

        val res2 = FsrsEngine.calculate(card1, SpacedRating.GOOD)
        assertTrue("第二次成功复习后稳定性增长", res2.stability > res1.stability)
        assertTrue("第二次成功复习后间隔天数增长", res2.intervalDays > res1.intervalDays)
        assertEquals(2, res2.repetition)
    }

    @Test
    fun `test lapse reset drops stability and resets repetition`() {
        val res1 = FsrsEngine.calculate(baseCard, SpacedRating.GOOD)
        val card1 = baseCard.copy(
            repetition = 2,
            intervalDays = 6,
            stability = 6.0,
            difficulty = 4.0,
            lastReviewedAt = System.currentTimeMillis() - 7 * 86400 * 1000L,
        )

        val againRes = FsrsEngine.calculate(card1, SpacedRating.AGAIN)
        assertEquals(0, againRes.repetition)
        assertEquals(1, againRes.intervalDays)
        assertTrue("遗忘后稳定性显著下降", againRes.stability < card1.stability)
    }
}
