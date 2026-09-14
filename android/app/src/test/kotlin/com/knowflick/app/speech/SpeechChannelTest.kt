package com.knowflick.app.speech

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer

/** 语音通道策略与远程客户端（MockWebServer，不请求真实服务） */
class SpeechChannelTest {

    @Test
    fun systemChannelDoesNotRequireConfiguration() {
        val decision = SpeechChannelPolicy.decide(SpeechSettings(channel = "SYSTEM"), apiKey = "")
        assertTrue(decision is SpeechChannelPolicy.Decision.SystemTts)
    }

    @Test
    fun cloudRequiresHttpsAndKey() {
        val insecure = SpeechChannelPolicy.decide(
            SpeechSettings(channel = "CLOUD", baseURL = "http://api.example.com", model = "kokoro"),
            apiKey = "k",
        )
        assertTrue(insecure is SpeechChannelPolicy.Decision.Invalid, "云端必须 HTTPS")

        val noKey = SpeechChannelPolicy.decide(
            SpeechSettings(channel = "CLOUD", baseURL = "https://api.example.com", model = "kokoro"),
            apiKey = "",
        )
        assertTrue(noKey is SpeechChannelPolicy.Decision.Invalid, "云端必须有密钥")

        val ok = SpeechChannelPolicy.decide(
            SpeechSettings(channel = "CLOUD", baseURL = "https://api.example.com", model = "kokoro"),
            apiKey = "sk-1",
        )
        assertTrue(ok is SpeechChannelPolicy.Decision.Remote)
        assertTrue((ok as SpeechChannelPolicy.Decision.Remote).needsKey)
    }

    @Test
    fun localAllowsLoopbackHttpAndNoKey() {
        val ok = SpeechChannelPolicy.decide(
            SpeechSettings(channel = "LOCAL", baseURL = "http://127.0.0.1:8880", model = "kokoro"),
            apiKey = "",
        )
        assertTrue(ok is SpeechChannelPolicy.Decision.Remote)
        assertEquals("http://127.0.0.1:8880/v1/audio/speech", (ok as SpeechChannelPolicy.Decision.Remote).url)

        val nonLoopback = SpeechChannelPolicy.decide(
            SpeechSettings(channel = "LOCAL", baseURL = "http://192.168.1.5:8880", model = "kokoro"),
            apiKey = "",
        )
        assertTrue(nonLoopback is SpeechChannelPolicy.Decision.Invalid, "本地通道限定回环地址")

        val lookalike = SpeechChannelPolicy.decide(
            SpeechSettings(channel = "LOCAL", baseURL = "https://localhost.attacker.example/v1", model = "kokoro"),
            apiKey = "",
        )
        assertTrue(lookalike is SpeechChannelPolicy.Decision.Invalid, "主机名只含 localhost 字样不能冒充回环地址")
    }

    @Test
    fun audioSpeechURLPreservesCustomPrefix() {
        assertEquals("http://127.0.0.1:31415/v1/audio/speech", SpeechChannelPolicy.audioSpeechURL("http://127.0.0.1:31415/v1"))
        assertEquals("https://host.example.com/custom/v1/audio/speech", SpeechChannelPolicy.audioSpeechURL("https://host.example.com/custom/v1/"))
        assertEquals("https://host.example.com/v1/audio/speech", SpeechChannelPolicy.audioSpeechURL("https://host.example.com"))
    }

    @Test
    fun speechSettingsJsonNeverCarriesKey() {
        val settings = SpeechSettings(channel = "LOCAL", baseURL = "http://127.0.0.1:8880", model = "kokoro", voice = "zf_xiaobei")
        val json = settings.toJson()
        assertTrue(!json.contains("sk-"), "语音 JSON 不含密钥")
        assertEquals(settings, SpeechSettings.fromJson(json))
    }

    @Test
    fun remoteClientSendsOpenAiCompatibleBodyAndReturnsAudio() = runTest {
        val server = MockWebServer()
        val audio = ByteArray(2048) { it.toByte() }
        server.enqueue(MockResponse().setBody(okio.Buffer().write(audio)))
        server.start()
        val client = RemoteSpeechClient()
        val settings = SpeechSettings(
            channel = "LOCAL",
            baseURL = server.url("/v1").toString().removeSuffix("/"),
            model = "kokoro",
            voice = "zf_xiaobei",
        )
        val decision = SpeechChannelPolicy.decide(settings, "stale-cloud-secret") as SpeechChannelPolicy.Decision.Remote
        val bytes = client.synthesize(settings, "stale-cloud-secret", "你好，世界", decision)
        assertEquals(2048, bytes.size)
        val recorded = server.takeRequest()
        assertEquals("/v1/audio/speech", recorded.path)
        val body = recorded.body.readUtf8()
        assertTrue(body.contains("\"model\":\"kokoro\""))
        assertTrue(body.contains("\"voice\":\"zf_xiaobei\""))
        assertTrue(body.contains("\"input\":\"你好，世界\""))
        assertEquals(null, recorded.getHeader("Authorization"), "本地语音网关不得收到旧云端密钥")
        server.shutdown()
    }

    @Test
    fun remoteClientSurfacesServerError() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(401).setBody("{\"error\":{\"message\":\"语音密钥无效\"}}"))
        server.start()
        val client = RemoteSpeechClient()
        val settings = SpeechSettings(channel = "LOCAL", baseURL = server.url("/v1").toString().removeSuffix("/"), model = "kokoro")
        val decision = SpeechChannelPolicy.decide(settings, "") as SpeechChannelPolicy.Decision.Remote
        try {
            client.synthesize(settings, "", "文本", decision)
            org.junit.Assert.fail("401 应抛错")
        } catch (e: SpeechError.HttpStatus) {
            assertTrue(e.message!!.contains("语音密钥无效"))
        } finally {
            server.shutdown()
        }
    }
}
