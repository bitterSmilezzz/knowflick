package com.knowflick.app.speech

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** 语音通道：系统 TTS / 云端 HTTPS / 本地回环网关（与 macOS 语音配置约定一致） */
enum class SpeechChannel { SYSTEM, CLOUD, LOCAL }

/**
 * 语音配置：与聊天模型分开；密钥走 CredentialStore（settings.json 不含密钥）。
 * 一次启用一套配置；远程失败时回退系统 TTS。
 */
@Serializable
data class SpeechSettings(
    val channel: String = SpeechChannel.SYSTEM.name,   // 存字符串便于 JSON 兼容
    val baseURL: String = "",
    val model: String = "kokoro",
    val voice: String = "zf_xiaobei",
    val speed: Float = 1.0f,
    val pitch: Float = 1.0f,
    val ambientGapSeconds: Double = 1.5,
) {
    val channelEnum: SpeechChannel get() = runCatching { SpeechChannel.valueOf(channel) }.getOrDefault(SpeechChannel.SYSTEM)

    /** 本地回环判定：127.0.0.1 / localhost / [::1] */
    val isLoopback: Boolean
        get() {
            val host = runCatching { java.net.URI(baseURL.trim()).host }
                .getOrNull()
                ?.lowercase()
                ?.trim('[', ']')
            return host == "127.0.0.1" || host == "localhost" || host == "::1"
        }

    fun toJson(): String = json.encodeToString(serializer(), this)

    companion object {
        private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

        fun fromJson(text: String): SpeechSettings? = runCatching { json.decodeFromString(serializer(), text) }.getOrNull()
    }
}

/** 语音通道决策：唯一入口，供 UI 校验与播放器共用（可 JVM 测试） */
object SpeechChannelPolicy {
    sealed class Decision {
        data object SystemTts : Decision()
        data class Remote(val url: String, val needsKey: Boolean) : Decision()
        data class Invalid(val reason: String) : Decision()
    }

    /** 决策：SYSTEM 直走系统 TTS；CLOUD 必须 HTTPS 且需密钥；LOCAL 允许回环 HTTP、免密 */
    fun decide(settings: SpeechSettings, apiKey: String): Decision = when (settings.channelEnum) {
        SpeechChannel.SYSTEM -> Decision.SystemTts
        SpeechChannel.CLOUD -> validate(settings, apiKey, requireHttps = true, requireKey = true)
        SpeechChannel.LOCAL -> {
            if (!settings.isLoopback) {
                Decision.Invalid("本地通道仅支持 127.0.0.1 / localhost 回环地址")
            } else {
                validate(settings, apiKey, requireHttps = false, requireKey = false)
            }
        }
    }

    private fun validate(settings: SpeechSettings, apiKey: String, requireHttps: Boolean, requireKey: Boolean): Decision {
        val base = settings.baseURL.trim()
        if (base.isEmpty()) return Decision.Invalid("请填写语音服务 Base URL")
        if (requireHttps && !base.startsWith("https://")) return Decision.Invalid("云端语音服务必须使用 HTTPS")
        if (!base.startsWith("https://") && !base.startsWith("http://")) return Decision.Invalid("Base URL 必须是 http(s) 地址")
        if (settings.model.isBlank()) return Decision.Invalid("请填写语音模型名")
        if (requireKey && apiKey.trim().isEmpty()) return Decision.Invalid("云端语音服务需要 API Key")
        return Decision.Remote(url = audioSpeechURL(base), needsKey = requireKey)
    }

    /** /v1/audio/speech 拼接：保留自定义前缀，裸域名补 /v1（与 AI endpoint 口径一致） */
    fun audioSpeechURL(baseURL: String): String {
        var base = baseURL.trim()
        while (base.endsWith("/")) base = base.dropLast(1)
        return when {
            base.endsWith("/v1") -> "$base/audio/speech"
            base.contains("/v1/") -> "$base/audio/speech"
            else -> "$base/v1/audio/speech"
        }
    }
}
