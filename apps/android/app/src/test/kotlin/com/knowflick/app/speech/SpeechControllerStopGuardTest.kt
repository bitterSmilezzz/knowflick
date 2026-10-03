package com.knowflick.app.speech

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * 停止路径护栏（A7）：stop() 幂等 + 前台保护丢失路径不回打服务。
 * 通知与服务生命周期本身依赖真机行为，由 lint + CI 与仪器测试兜底。
 */
@Config(sdk = [35])
@RunWith(RobolectricTestRunner::class)
class SpeechControllerStopGuardTest {

    private val app: Application = ApplicationProvider.getApplicationContext()

    @Test
    fun stopRequestsServiceStopExactlyOnce() {
        val controller = SpeechController(app)

        // speakText 不依赖 TTS 引擎就绪即可进入播放态
        controller.speakText("测试朗读文本")
        assertTrue(controller.isSpeaking, "前置：应处于播放态")

        controller.stop()
        val first = shadowOf(app).nextStartedService
        assertNotNull(first, "首次 stop() 应请求服务停止")
        assertEquals(SpeechPlaybackService.ACTION_STOP, first.action)

        // 服务侧 STOP 处理会再次回调 stop()：必须早退，否则 STOP→stop()→STOP 自激成死循环
        controller.stop()
        assertNull(shadowOf(app).nextStartedService, "重复 stop() 不得再次启动 STOP intent")
    }

    @Test
    fun stopOnIdleControllerDoesNotWakeService() {
        val controller = SpeechController(app)

        controller.stop()
        assertNull(shadowOf(app).nextStartedService, "空闲态 stop() 不应唤醒服务再停一次")
        assertFalse(controller.isSpeaking)
    }

    @Test
    fun foregroundServiceLostStopsPlaybackWithoutServiceRoundTrip() {
        val controller = SpeechController(app)
        controller.speakText("测试朗读文本")

        controller.onForegroundServiceLost("测试：前台保护被拒")

        assertEquals("测试：前台保护被拒", controller.lastError)
        assertFalse(controller.isSpeaking)
        assertFalse(controller.isPaused)
        assertNull(controller.speakingCardId)
        assertNull(
            shadowOf(app).nextStartedService,
            "前台保护丢失路径不得回打 stopService（服务在自行收尾）",
        )
    }
}
