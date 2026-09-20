package com.knowflick.app.ai

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer

/** 生成全链路（MockWebServer）：流式产出 / 429 重试 / 错误体透出 / 本地免密 */
class AiServiceGenerateTest {
    private val details = "这是分批生成的深入说明内容。".repeat(12)

    private fun sseBody(headline: String): String {
        val card = "{\"category\":\"AI\",\"headline\":\"$headline\",\"summary\":\"摘要\",\"details\":\"$details\",\"searchKeywords\":[],\"sources\":[]}"
        // 生成路径约定：delta.content 是「卡片 JSON 数组」的字符串形式（转义内嵌引号）
        val content = "[$card]".replace("\"", "\\\"")
        return "data: {\"choices\":[{\"delta\":{\"content\":\"$content\"}}]}\n\ndata: [DONE]\n\n"
    }

    @Test
    fun generateCardsStreamsAndParsesUsableCards() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody(sseBody("碳纤维的强度密码")))
        server.start()
        val service = AiService(
            client = okhttp3.OkHttpClient(),
            retryBaseDelayMs = 1,
        )
        val settings = AiSettings(baseURL = server.url("/v1").toString(), model = "test-model")
        val cards = service.generateCards(settings, apiKey = "k", count = 1, excludeHeadlines = emptyList())
        assertEquals(1, cards.size)
        assertEquals("碳纤维的强度密码".let { cards[0].headline }, cards[0].headline)
        assertEquals("ai", cards[0].source.raw)
        assertTrue(cards[0].details.length >= 80)
        // 请求体含 stream=true 与 max_tokens
        val recorded = server.takeRequest()
        val body = recorded.body.readUtf8()
        assertTrue(body.contains("\"stream\":true"))
        assertTrue(body.contains("max_tokens"))
        server.shutdown()
    }

    @Test
    fun retriesOn429BeforeFirstObject() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(429).setBody("{\"error\":{\"message\":\"请稍后重试\"}}"))
        server.enqueue(MockResponse().setBody(sseBody("重试成功")))
        server.start()
        val service = AiService(client = okhttp3.OkHttpClient(), retryBaseDelayMs = 1)
        val settings = AiSettings(baseURL = server.url("/v1").toString(), model = "test-model")
        val cards = service.generateCards(settings, apiKey = "k", count = 1, excludeHeadlines = emptyList())
        assertEquals(1, cards.size)
        assertEquals(2, server.requestCount)
        server.shutdown()
    }

    @Test
    fun nonRetryableStatusSurfacesServerMessage() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(401).setBody("{\"error\":{\"message\":\"密钥无效\"}}"))
        server.start()
        val service = AiService(client = okhttp3.OkHttpClient(), retryBaseDelayMs = 1)
        val settings = AiSettings(baseURL = server.url("/v1").toString(), model = "test-model")
        try {
            service.generateCards(settings, apiKey = "bad", count = 1, excludeHeadlines = emptyList())
            org.junit.Assert.fail("401 应抛错")
        } catch (e: AiError.HttpStatus) {
            assertTrue(e.message!!.contains("密钥无效"))
        }
        server.shutdown()
    }

    @Test
    fun localLoopbackDoesNotRequireKey() = runTest {
        assertEquals(false, AiService.requiresKey("http://127.0.0.1:31415/v1"))
        assertEquals(true, AiService.requiresKey("https://api.deepseek.com"))
    }

    @Test
    fun localLoopbackNeverReceivesStaleCloudCredential() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody(sseBody("本地密钥隔离")))
        server.start()
        try {
            val service = AiService(client = okhttp3.OkHttpClient(), retryBaseDelayMs = 1)
            val settings = AiSettings(baseURL = server.url("/v1").toString(), model = "test-model")

            service.generateCards(settings, apiKey = "stale-cloud-secret", count = 1, excludeHeadlines = emptyList())

            assertEquals(null, server.takeRequest().getHeader("Authorization"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun generateCardsSplitsBatchesWhenCountExceedsLimit() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody(sseBody("量子纠缠与信息守恒")))
        server.enqueue(MockResponse().setBody(sseBody("深海热泉生态系统的能量来源")))
        server.start()
        try {
            val service = AiService(client = okhttp3.OkHttpClient(), retryBaseDelayMs = 1)
            val settings = AiSettings(baseURL = server.url("/v1").toString(), model = "test-model")
            val cards = service.generateCards(settings, apiKey = "k", count = 8, excludeHeadlines = emptyList())
            assertEquals(2, cards.size)
            assertEquals(2, server.requestCount)
        } finally {
            server.shutdown()
        }
    }
}
