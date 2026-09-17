package com.knowflick.app.speech

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SpeechSettingsTest {

    @Test
    fun speechSettingsSerializesPitchAndAmbientGap() {
        val settings = SpeechSettings(
            channel = "SYSTEM",
            speed = 1.25f,
            pitch = 1.1f,
            ambientGapSeconds = 2.5,
        )
        val json = settings.toJson()
        val restored = SpeechSettings.fromJson(json)
        assertEquals(settings, restored)
        assertEquals(1.25f, restored?.speed)
        assertEquals(1.1f, restored?.pitch)
        assertEquals(2.5, restored?.ambientGapSeconds)
    }

    @Test
    fun defaultValuesAreSensible() {
        val defaultSettings = SpeechSettings()
        assertEquals(1.0f, defaultSettings.speed)
        assertEquals(1.0f, defaultSettings.pitch)
        assertEquals(1.5, defaultSettings.ambientGapSeconds)
        assertEquals(SpeechChannel.SYSTEM, defaultSettings.channelEnum)
    }
}
