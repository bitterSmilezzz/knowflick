package com.knowflick.app.ai

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** AI 服务设置（settings.json 线格式不含任何密钥；密钥走 CredentialStore/Keystore） */
@Serializable
data class AiSettings(
    val providerId: String = "deepseek",
    val baseURL: String = "",
    val model: String = "",
    val autoGenerate: Boolean = true,
    val enableSeed: Boolean = true,
    val enableAI: Boolean = true,
    val showAIMark: Boolean = true,
    val preferredCategories: List<String> = emptyList(),
) {
    val isConfigured: Boolean get() = baseURL.isNotBlank() && model.isNotBlank()

    fun toJson(): String = json.encodeToString(serializer(), this)

    companion object {
        private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

        fun fromJson(text: String): AiSettings? = runCatching { json.decodeFromString(serializer(), text) }.getOrNull()

        fun defaultFor(preset: AiProviderPreset): AiSettings = AiSettings(
            providerId = preset.id,
            baseURL = preset.defaultBaseURL,
            model = preset.defaultModel,
        )
    }
}

/** AI 调用错误通道（与 macOS AIError 一等语义对齐） */
sealed class AiError(message: String) : Exception(message) {
    class MissingKey : AiError("未配置 API Key，请到设置里填写")
    class BadRequest(msg: String) : AiError("请求参数错误：$msg")
    class Network(msg: String) : AiError("网络错误：$msg")
    class HttpStatus(val code: Int, detail: String) : AiError("API 返回 $code：${detail.take(200)}")
    class Parse(msg: String) : AiError("解析失败：$msg")
    class NoUsableCards : AiError("AI 返回的内容没有可用的新卡片（重复或内容过短），请再试一次")
}
