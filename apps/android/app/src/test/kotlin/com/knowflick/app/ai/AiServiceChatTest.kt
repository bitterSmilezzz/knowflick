package com.knowflick.app.ai

import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer

class AiServiceChatTest {

    private fun sampleCard() = KnowledgeCard(
        id = "test-card-1",
        category = "量子物理",
        headline = "薛定谔的猫与叠加态",
        summary = "微观粒子在被观测前处于所有可能状态的线性叠加中。",
        details = "1935年埃尔温·薛定谔提出了著名的思想实验...\n\n在哥本哈根诠释下，波函数在观测瞬间坍缩。",
        links = emptyList(),
        source = CardSource.SEED,
        createdAt = System.currentTimeMillis(),
    )

    @Test
    fun streamCardChatStreamsDeltas() = runTest {
        val server = MockWebServer()
        val sseStream = buildString {
            append("data: {\"choices\":[{\"delta\":{\"content\":\"微观粒子\"}}]}\n\n")
            append("data: {\"choices\":[{\"delta\":{\"content\":\"处于叠加态\"}}]}\n\n")
            append("data: {\"choices\":[{\"delta\":{\"content\":\"直到被观测。\"}}]}\n\n")
            append("data: [DONE]\n\n")
        }
        server.enqueue(MockResponse().setBody(sseStream))
        server.start()

        val service = AiService(client = okhttp3.OkHttpClient(), retryBaseDelayMs = 1)
        val settings = AiSettings(baseURL = server.url("/v1").toString(), model = "test-chat-model")
        val deltas = mutableListOf<String>()

        service.streamCardChat(
            card = sampleCard(),
            history = emptyList(),
            userPrompt = "请用通俗比喻解释一下",
            settings = settings,
            apiKey = "key-123",
            onDelta = { deltas.add(it) },
        )

        assertEquals(listOf("微观粒子", "处于叠加态", "直到被观测。"), deltas)
        val recorded = server.takeRequest()
        val requestBody = recorded.body.readUtf8()
        assertTrue(requestBody.contains("test-chat-model"))
        assertTrue(requestBody.contains("薛定谔的猫与叠加态"))
        assertTrue(requestBody.contains("请用通俗比喻解释一下"))
        assertTrue(requestBody.contains("\"stream\":true"))

        server.shutdown()
    }

    @Test
    fun streamCardChatRetriesOn429() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(429).setBody("{\"error\":{\"message\":\"Rate limit exceeded\"}}"))
        server.enqueue(MockResponse().setBody("data: {\"choices\":[{\"delta\":{\"content\":\"重试成功回答\"}}]}\n\ndata: [DONE]\n\n"))
        server.start()

        val service = AiService(client = okhttp3.OkHttpClient(), retryBaseDelayMs = 1)
        val settings = AiSettings(baseURL = server.url("/v1").toString(), model = "test-chat-model")
        val deltas = mutableListOf<String>()

        service.streamCardChat(
            card = sampleCard(),
            history = emptyList(),
            userPrompt = "为什么会这样？",
            settings = settings,
            apiKey = "key-123",
            onDelta = { deltas.add(it) },
        )

        assertEquals(listOf("重试成功回答"), deltas)
        assertEquals(2, server.requestCount)

        server.shutdown()
    }

    @Test
    fun streamCardChatFailsWhenKeyMissing() = runTest {
        val service = AiService(client = okhttp3.OkHttpClient())
        val settings = AiSettings(baseURL = "https://api.deepseek.com", model = "deepseek-chat")

        assertFailsWith<AiError.MissingKey> {
            service.streamCardChat(
                card = sampleCard(),
                history = emptyList(),
                userPrompt = "问",
                settings = settings,
                apiKey = "",
                onDelta = {},
            )
        }
    }

    @Test
    fun systemPromptContainsCardContext() {
        val card = sampleCard()
        val prompt = AiService.buildCardChatSystemPrompt(card)

        assertTrue(prompt.contains(card.category))
        assertTrue(prompt.contains(card.headline))
        assertTrue(prompt.contains(card.summary))
        assertTrue(prompt.contains("AI 知识导师"))
        assertTrue(prompt.contains("导师回复原则"))
    }
}
