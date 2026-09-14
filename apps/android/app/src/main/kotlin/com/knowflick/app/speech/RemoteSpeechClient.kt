package com.knowflick.app.speech

import com.knowflick.app.net.executeCancellable
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * 远程语音客户端：POST {base}/v1/audio/speech（OpenAI 兼容，如 Kokoro-FastAPI / CosyVoice 网关），
 * 返回音频字节交由 MediaPlayer 播放。HTTPS/回环与免密策略由 [SpeechChannelPolicy] 决策。
 */
class RemoteSpeechClient(
    private val client: OkHttpClient = defaultClient(),
) {
    private val jsonMedia = "application/json; charset=utf-8".toMediaTypeOrNull()!!

    /** 合成音频：返回原始音频字节（mp3/wav 由服务端决定，MediaPlayer 自适应） */
    suspend fun synthesize(
        settings: SpeechSettings,
        apiKey: String,
        text: String,
        decision: SpeechChannelPolicy.Decision.Remote,
    ): ByteArray {
        val body = buildJsonObject {
            put("model", settings.model)
            put("input", text)
            put("voice", settings.voice)
            put("speed", settings.speed)
            put("response_format", "mp3")
        }
        val request = Request.Builder()
            .url(decision.url)
            .post(body.toString().toRequestBody(jsonMedia))
            .header("Content-Type", "application/json")
            .apply { if (decision.needsKey && apiKey.isNotBlank()) header("Authorization", "Bearer $apiKey") }
            .build()
        return client.executeCancellable(request) { response ->
            if (!response.isSuccessful) {
                val detail = response.body?.string().orEmpty()
                throw SpeechError.HttpStatus(response.code, extractMessage(detail))
            }
            val bytes = response.body?.bytes() ?: throw SpeechError.Network("无响应体")
            if (bytes.isEmpty()) throw SpeechError.Network("服务端返回空音频")
            bytes
        }
    }

    companion object {
        fun extractMessage(body: String): String = runCatching {
            val obj = Json.parseToJsonElement(body)
            val root = obj as kotlinx.serialization.json.JsonObject
            val error = root["error"] as? kotlinx.serialization.json.JsonObject
            (error?.get("message") as? kotlinx.serialization.json.JsonPrimitive)?.content
                ?: (root["message"] as? kotlinx.serialization.json.JsonPrimitive)?.content
        }.getOrNull() ?: body.take(300)

        private fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            // 整体呼叫上限：持续吐字节的响应不会触发 readTimeout，需要总时长兜底。
            .callTimeout(180, TimeUnit.SECONDS)
            .build()
    }
}

sealed class SpeechError(message: String) : Exception(message) {
    class HttpStatus(val code: Int, detail: String) : SpeechError("语音服务返回 $code：${detail.take(200)}")
    class Network(msg: String) : SpeechError("语音网络错误：$msg")
}
