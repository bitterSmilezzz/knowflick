package com.knowflick.app.ai

import kotlinx.serialization.Serializable

/** AI 返回的单张卡片载荷 */
@Serializable
data class AiCardPayload(
    val category: String = "",
    val headline: String = "",
    val summary: String = "",
    val details: String = "",
    val searchKeywords: List<String> = emptyList(),
    val sources: List<String> = emptyList(),
)

/** 生成批次解析：从顶层 JSON 数组字符串提取卡片对象 */
object AiPayloadParser {
    fun parseObjects(raw: String): List<AiCardPayload> {
        val scanner = AiObjectScanner()
        scanner.append(raw)
        return scanner.objects
    }
}
