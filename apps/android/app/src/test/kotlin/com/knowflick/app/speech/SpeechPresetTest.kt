package com.knowflick.app.speech

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 听书档位与睡前淡出的契约测试。
 *
 * 档位数值与 mac 端 `SpeechPresetTests.swift` 逐条相同：同一档在手机与桌面上必须
 * 给出同样的语速/音调/停顿，否则「双端一致」在耳朵层面就是假的。
 */
class SpeechPresetTest {

    @Test
    fun presetValuesMatchAcrossPlatforms() {
        assertEquals("standard", SpeechPreset.STANDARD.id)
        assertEquals(1.00f, SpeechPreset.STANDARD.speed, 0.0001f)
        assertEquals(1.00f, SpeechPreset.STANDARD.pitch, 0.0001f)
        assertEquals(1.5, SpeechPreset.STANDARD.gapSeconds, 0.0001)

        assertEquals(0.92f, SpeechPreset.WARM.speed, 0.0001f)
        assertEquals(0.95f, SpeechPreset.WARM.pitch, 0.0001f)
        assertEquals(2.0, SpeechPreset.WARM.gapSeconds, 0.0001)

        assertEquals(1.18f, SpeechPreset.COMMUTE.speed, 0.0001f)
        assertEquals(0.8, SpeechPreset.COMMUTE.gapSeconds, 0.0001)

        assertEquals(0.85f, SpeechPreset.BEDTIME.speed, 0.0001f)
        assertEquals(0.90f, SpeechPreset.BEDTIME.pitch, 0.0001f)
        assertEquals(2.5, SpeechPreset.BEDTIME.gapSeconds, 0.0001)
        assertEquals(20, SpeechPreset.BEDTIME.sleepMinutes)
        assertTrue(SpeechPreset.BEDTIME.fadesOut)
    }

    @Test
    fun onlyBedtimePresetTouchesTheSleepTimer() {
        assertEquals(0, SpeechPreset.STANDARD.sleepMinutes)
        assertEquals(0, SpeechPreset.WARM.sleepMinutes)
        assertEquals(0, SpeechPreset.COMMUTE.sleepMinutes)
        assertEquals(20, SpeechPreset.BEDTIME.sleepMinutes)
    }

    @Test
    fun matchRecoversThePresetFromItsOwnValues() {
        SpeechPreset.entries.forEach { preset ->
            val matched = SpeechPreset.match(preset.speed, preset.pitch, preset.gapSeconds)
            assertEquals(preset, matched)
        }
    }

    @Test
    fun handTunedValuesFallBackToCustom() {
        // 手拖语速/音调/停顿后不能还顶着某档的名字，否则状态是撒谎的
        assertNull(SpeechPreset.match(1.05f, 1.00f, 1.5))
        assertNull(SpeechPreset.match(1.00f, 1.10f, 1.5))
        assertNull(SpeechPreset.match(1.00f, 1.00f, 3.0))
        assertNull(SpeechPreset.match(0.75f, 1.00f, 0.8))
    }

    @Test
    fun matchToleratesSerializationNoiseButNotARealChange() {
        assertNotNull(SpeechPreset.match(0.9200001f, 0.95f, 2.0))
        // 0.05 已经超出容差（0.02），必须是「自定义」
        assertNull(SpeechPreset.match(0.97f, 0.95f, 2.0))
    }

    @Test
    fun byIdResolvesUnknownToNull() {
        assertEquals(SpeechPreset.WARM, SpeechPreset.byId("warm"))
        assertNull(SpeechPreset.byId("nope"))
        assertNull(SpeechPreset.byId(null))
    }
}

class SleepFadeTest {

    @Test
    fun outsideTheWindowNothingChanges() {
        val plan = SleepFade.plan(remainingSeconds = 31)
        assertEquals(1f, plan.volume, 0.0001f)
        assertEquals(1f, plan.speedScale, 0.0001f)

        val edge = SleepFade.plan(remainingSeconds = SleepFade.DEFAULT_WINDOW_SECONDS)
        assertEquals(1f, edge.volume, 0.0001f)
    }

    @Test
    fun volumeAndSpeedRampMonotonicallyToTheFloor() {
        var previousVolume = 1.0f
        var previousSpeed = 1.0f
        for (remaining in 29 downTo 0) {
            val plan = SleepFade.plan(remaining)
            assertTrue("音量必须单调下降 @${remaining}s", plan.volume <= previousVolume + 1e-6f)
            assertTrue("语速必须单调下降 @${remaining}s", plan.speedScale <= previousSpeed + 1e-6f)
            previousVolume = plan.volume
            previousSpeed = plan.speedScale
        }
        assertEquals(SleepFade.MIN_VOLUME, SleepFade.plan(0).volume, 0.0001f)
        assertEquals(SleepFade.MIN_SPEED_SCALE, SleepFade.plan(0).speedScale, 0.0001f)
    }

    @Test
    fun halfWayThroughTheWindowIsHalfWayDown() {
        val plan = SleepFade.plan(15, windowSeconds = 30)
        assertEquals(0.575f, plan.volume, 0.001f)   // 0.15 + 0.85 * 0.5
        assertEquals(0.95f, plan.speedScale, 0.001f)
    }

    @Test
    fun zeroWindowMeansHardStop() {
        val plan = SleepFade.plan(1, windowSeconds = 0)
        assertEquals(1f, plan.volume, 0.0001f)
        assertEquals(1f, plan.speedScale, 0.0001f)
    }

    @Test
    fun negativeRemainingDoesNotGoBelowTheFloor() {
        val plan = SleepFade.plan(-5)
        assertEquals(SleepFade.MIN_VOLUME, plan.volume, 0.0001f)
        assertEquals(SleepFade.MIN_SPEED_SCALE, plan.speedScale, 0.0001f)
    }
}
