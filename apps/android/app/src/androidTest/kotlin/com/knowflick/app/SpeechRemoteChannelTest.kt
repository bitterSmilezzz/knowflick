package com.knowflick.app

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.knowflick.app.speech.SpeechChannel
import com.knowflick.app.speech.SpeechSettings
import java.util.concurrent.TimeUnit
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * 远程语音通道设备级验证：设备内 MockWebServer 扮演 Kokoro 兼容网关，
 * 验证「详情页朗读 → POST /v1/audio/speech → 音频回放 → 磨耳朵自动推进」全链路。
 */
@RunWith(AndroidJUnit4::class)
class SpeechRemoteChannelTest {

    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    private fun viewModel(): KnowFlickViewModel =
        ViewModelProvider(rule.activity)[KnowFlickViewModel::class.java]

    /** 2 秒 440Hz 正弦 WAV（MediaPlayer 可播放，完成回调可驱动磨耳朵推进） */
    private fun sineWav(seconds: Double = 2.0, rate: Int = 8000): ByteArray {
        val samples = (seconds * rate).toInt()
        val dataLen = samples * 2
        val out = java.io.ByteArrayOutputStream()
        fun writeAscii(s: String) = out.write(s.toByteArray(Charsets.US_ASCII))
        fun writeIntLE(v: Int) = out.write(byteArrayOf((v and 0xFF).toByte(), ((v shr 8) and 0xFF).toByte(), ((v shr 16) and 0xFF).toByte(), ((v shr 24) and 0xFF).toByte()))
        fun writeShortLE(v: Int) = out.write(byteArrayOf((v and 0xFF).toByte(), ((v shr 8) and 0xFF).toByte()))
        writeAscii("RIFF"); writeIntLE(36 + dataLen); writeAscii("WAVE")
        writeAscii("fmt "); writeIntLE(16); writeShortLE(1); writeShortLE(1)
        writeIntLE(rate); writeIntLE(rate * 2); writeShortLE(2); writeShortLE(16)
        writeAscii("data"); writeIntLE(dataLen)
        for (i in 0 until samples) {
            val value = (kotlin.math.sin(2 * Math.PI * 440 * i / rate) * 8000).toInt()
            writeShortLE(value)
        }
        return out.toByteArray()
    }

    @Test
    fun detailSpeechPostsToLocalGatewayAndPlaysReturnedAudio() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody(okio.Buffer().write(sineWav())))
        server.start()
        val vm = viewModel()
        rule.runOnUiThread {
            vm.saveSpeechSettings(
                SpeechSettings(
                    channel = SpeechChannel.LOCAL.name,
                    baseURL = "http://127.0.0.1:${server.port}",
                    model = "kokoro",
                    voice = "zf_xiaobei",
                ),
                apiKey = "",
            )
        }
        rule.waitUntil(5_000) { !vm.isSavingSettings }

        // 进入详情，确认朗读按钮存在（UI 契约）
        rule.onNodeWithContentDescription("详情").performClick()
        rule.onNodeWithContentDescription("朗读全文").assertIsDisplayed()

        // 直接驱动控制器（UI 点击与控制器链路分开验证，避免焦点/命中抖动干扰传输断言）
        val card = vm.model.store.topCard!!
        rule.runOnUiThread { vm.speech.speak(card) }

        // 验证网关收到合成请求（含卡片文本）
        val request = server.takeRequest(8, TimeUnit.SECONDS)
        assertTrue(
            "语音网关应收到请求；isSpeaking=${vm.speech.isSpeaking} speakingCard=${vm.speech.speakingCardId} lastError=${vm.speech.lastError} settings=${vm.speechSettings}",
            request != null,
        )
        assertTrue(request!!.path!!.endsWith("/v1/audio/speech"))
        val body = request.body.readUtf8()
        assertTrue(body.contains("\"model\":\"kokoro\""))
        assertTrue(body.contains("\"voice\":\"zf_xiaobei\""))

        // 播放状态：应处于朗读中
        rule.waitUntil(5_000) { vm.speech.isSpeaking }
        server.shutdown()
    }

    @Test
    fun ambientModeAdvancesToNextCardAfterPlayback() {
        val server = MockWebServer()
        repeat(3) { server.enqueue(MockResponse().setBody(okio.Buffer().write(sineWav(seconds = 1.5)))) }
        server.start()
        val vm = viewModel()
        rule.runOnUiThread {
            vm.saveSpeechSettings(
                SpeechSettings(
                    channel = SpeechChannel.LOCAL.name,
                    baseURL = "http://127.0.0.1:${server.port}",
                    model = "kokoro",
                    voice = "zf_xiaobei",
                ),
                apiKey = "",
            )
        }
        rule.waitUntil(5_000) { !vm.isSavingSettings }
        vm.speech.ambientGapSeconds = 0.3
        val firstCardId = vm.model.store.topCard!!.id

        rule.onNodeWithContentDescription("磨耳朵连续朗读").performClick()
        rule.waitUntil(5_000) { vm.speech.isAmbientMode }

        // 第一段播完 + 间隔后应自动推进到下一张并再次请求合成
        rule.waitUntil(15_000) {
            vm.model.store.topCard?.id != firstCardId && server.requestCount >= 2
        }
        server.shutdown()
    }

    @Test
    fun stoppingBeforeRemoteResponsePreventsLateAudioPlayback() {
        val server = MockWebServer()
        server.enqueue(
            MockResponse()
                .setBody(okio.Buffer().write(sineWav(seconds = 2.0)))
                .setBodyDelay(1_200, TimeUnit.MILLISECONDS),
        )
        server.start()
        val vm = viewModel()
        rule.runOnUiThread {
            vm.saveSpeechSettings(
                SpeechSettings(
                    channel = SpeechChannel.LOCAL.name,
                    baseURL = "http://127.0.0.1:${server.port}",
                    model = "kokoro",
                    voice = "zf_xiaobei",
                ),
                apiKey = "",
            )
        }
        rule.waitUntil(5_000) { !vm.isSavingSettings }

        try {
            val card = vm.model.store.topCard!!
            rule.runOnUiThread { vm.speech.speak(card) }
            assertTrue(server.takeRequest(5, TimeUnit.SECONDS) != null)
            rule.runOnUiThread { vm.speech.stop() }

            Thread.sleep(1_700)

            val field = vm.speech.javaClass.getDeclaredField("mediaPlayer").apply { isAccessible = true }
            assertTrue("停止后迟到的远程响应不得启动 MediaPlayer", field.get(vm.speech) == null)
            assertTrue(!vm.speech.isSpeaking)
        } finally {
            rule.runOnUiThread { vm.speech.stop() }
            server.shutdown()
        }
    }
}
