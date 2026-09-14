package com.knowflick.app.ai

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer

/** SSE 解析 / 增量扫描 / endpoint 拼接口径 */
class AiServiceUtilTest {
    private fun sse(vararg payloads: String, done: Boolean = true): String =
        payloads.joinToString("\n\n") { "data: {\"choices\":[{\"delta\":{\"content\":\"$it\"}}]}" } +
            (if (done) "\n\ndata: [DONE]\n\n" else "")

    @Test
    fun sseParserHandlesDeltaMessageDoneAndKeepAlive() {
        assertEquals("碳纤维", AiService.sseContentDelta("data: {\"choices\":[{\"delta\":{\"content\":\"碳纤维\"}}]}"))
        assertEquals("完整回复", AiService.sseContentDelta("data: {\"choices\":[{\"message\":{\"content\":\"完整回复\"}}]}"))
        assertEquals(null, AiService.sseContentDelta("data: [DONE]"))
        assertEquals(null, AiService.sseContentDelta(": keep-alive"))
    }

    @Test
    fun incrementalScannerMatchesWholeScanAcrossSplits() {
        val card1 = "{\"category\":\"AI\",\"headline\":\"增量扫描\",\"summary\":\"s\",\"details\":\"d\"}"
        val card2 = "{\"category\":\"物理\",\"headline\":\"量子 \\\" 引号\",\"summary\":\"s\",\"details\":\"dd\"}"
        val text = "前缀 $card1 中间 $card2 尾部"
        val whole = AiPayloadParser.parseObjects(text)
        assertEquals(2, whole.size)
        val scanner = AiObjectScanner()
        var index = 0
        while (index < text.length) {
            val end = minOf(index + 7, text.length)
            scanner.append(text.substring(index, end))
            index = end
        }
        assertEquals(whole.map { it.headline }, scanner.objects.map { obj ->
            runCatching {
                kotlinx.serialization.json.Json.decodeFromJsonElement(AiCardPayload.serializer(), obj)
            }.getOrNull()?.headline
        })
    }

    @Test
    fun completionURLPreservesCustomPrefixAndCompletesBareDomain() {
        assertTrue(AiService.completionURL("https://api.example.com").toString().endsWith("/v1/chat/completions"))
        assertTrue(AiService.completionURL("https://open.bigmodel.cn/api/paas/v4").toString().endsWith("/api/paas/v4/chat/completions"))
        // 尾部斜杠剥除
        assertTrue(AiService.completionURL("https://example.com/v1/").toString().endsWith("/v1/chat/completions"))
    }

    @Test
    fun errorMessageExtractsServerMessage() {
        assertEquals("配额不足", AiService.errorMessage("{\"error\":{\"message\":\"配额不足\"}}"))
        assertEquals("模型不存在", AiService.errorMessage("{\"message\":\"配额不足\"}".replace("配额不足", "模型不存在")))
        assertTrue(AiService.errorMessage("plain text").startsWith("plain"))
    }
}
