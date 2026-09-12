package com.knowflick.app.ai

import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.ScienceLink
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * OpenAI 兼容 Chat Completions 客户端（移植自 macOS AIService）：
 * - endpoint 拼接口径一致：保留服务商自定义前缀，仅裸域名补 /v1
 * - 流式生成 + 增量对象扫描，够数即停；429/5xx 指数退避重试
 * - 近重复抑制（归一化标题 + bigram Jaccard）与 ≥80 字门槛；超 6 张自动分批
 */
class AiService(
    private val client: OkHttpClient = defaultClient(),
    private val retryBaseDelayMs: Long = 1_000L,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val jsonMedia = "application/json; charset=utf-8".toMediaTypeOrNull()!!

    suspend fun ping(settings: AiSettings, apiKey: String) {
        val key = apiKey.trim()
        if (requiresKey(settings.baseURL) && key.isEmpty()) throw AiError.MissingKey()
        val body = buildJsonObject {
            put("model", settings.model.ifBlank { "gpt-4o-mini" })
            put("messages", buildJsonArray {
                add(buildJsonObject { put("role", "user"); put("content", "ping") })
            })
            put("max_tokens", 1)
            put("stream", false)
        }
        val request = Request.Builder()
            .url(completionURL(settings.baseURL))
            .post(body.toString().toRequestBody(jsonMedia))
            .header("Content-Type", "application/json")
            .header("User-Agent", userAgent())
            .apply { if (key.isNotEmpty()) header("Authorization", "Bearer $key") }
            .build()
        withContext(Dispatchers.IO) {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw AiError.HttpStatus(response.code, errorMessage(response.body?.string().orEmpty()))
                }
            }
        }
    }

    /** 生成知识卡片。onDelta 提供增量文本（生成中展示用）。上限 20；单请求 ≤6 张自动分批。 */
    suspend fun generateCards(
        settings: AiSettings,
        apiKey: String,
        count: Int,
        excludeHeadlines: List<String>,
        topic: String? = null,
        preferredSources: List<String> = emptyList(),
        onDelta: ((String) -> Unit)? = null,
    ): List<KnowledgeCard> {
        val key = apiKey.trim()
        if (requiresKey(settings.baseURL) && key.isEmpty()) throw AiError.MissingKey()
        if (settings.baseURL.isBlank()) throw AiError.BadRequest("baseURL 为空")
        if (count !in 1..20) throw AiError.BadRequest("生成数量须为 1–20")

        val seenHeadlines = excludeHeadlines.map { AiTextUtils.normalizeHeadline(it) }.toMutableSet()
        val excludedBigrams = excludeHeadlines.map { AiTextUtils.bigramSet(it) }.toMutableList()
        val excludeList = excludeHeadlines.take(100).toMutableList()
        val allCards = ArrayList<KnowledgeCard>(count)
        val now = System.currentTimeMillis()

        var remaining = count
        while (remaining > 0) {
            val batch = minOf(remaining, MAX_CARDS_PER_REQUEST)
            val payloads = requestBatch(settings, key, batch, topic, excludeList.take(100), onDelta)
            for (payload in payloads) {
                if (payload.details.length < 80) continue
                val headlineKey = AiTextUtils.normalizeHeadline(payload.headline)
                val bigram = AiTextUtils.bigramSet(payload.headline)
                if (headlineKey.isEmpty() || !seenHeadlines.add(headlineKey)) continue
                if (excludedBigrams.any { AiTextUtils.jaccard(bigram, it) > AiTextUtils.NEAR_DUPLICATE_THRESHOLD }) continue
                seenHeadlines += headlineKey
                excludedBigrams += bigram
                excludeList += payload.headline
                allCards += KnowledgeCard(
                    id = newId(),
                    category = com.knowflick.app.domain.CategoryRegistry.normalize(payload.category, custom = emptyList()),
                    headline = payload.headline,
                    summary = payload.summary,
                    details = payload.details,
                    links = AiTextUtils.buildSearchLinks(
                        keywords = payload.searchKeywords,
                        preferred = preferredSources,
                        aiSources = payload.sources,
                    ),
                    source = CardSource.AI,
                    createdAt = now,
                )
            }
            remaining -= batch
        }
        if (allCards.isEmpty()) throw AiError.NoUsableCards()
        return allCards
    }

    private suspend fun requestBatch(
        settings: AiSettings,
        apiKey: String,
        batchCount: Int,
        topic: String?,
        excludeList: List<String>,
        onDelta: ((String) -> Unit)?,
    ): List<AiCardPayload> {
        val body = buildJsonObject {
            put("model", settings.model)
            put("messages", buildJsonArray {
                add(buildJsonObject {
                    put("role", "system")
                    put("content", AiTextUtils.cardSystemPrompt(
                        categoryWhitelist = com.knowflick.app.domain.CategoryRegistry.BUILTIN_CATEGORY,
                        sourcesHint = "维基百科、国家地理、NASA 等权威科普站点",
                    ))
                })
                add(buildJsonObject {
                    put("role", "user")
                    put("content", AiTextUtils.cardUserPrompt(batchCount, topic, excludeList, categoryFilter = ""))
                })
            })
            put("temperature", 0.8)
            put("max_tokens", minOf(8192, maxOf(1200, batchCount * 900 + 400)))
            put("stream", true)
        }
        val request = Request.Builder()
            .url(completionURL(settings.baseURL))
            .post(body.toString().toRequestBody(jsonMedia))
            .header("Content-Type", "application/json")
            .header("User-Agent", userAgent())
            .apply { if (apiKey.isNotEmpty()) header("Authorization", "Bearer $apiKey") }
            .build()

        return withContext(Dispatchers.IO) {
            for (attempt in 0 until 3) {
                try {
                    client.newCall(request).execute().use { response ->
                        if (!response.isSuccessful) throw AiError.HttpStatus(response.code, errorMessage(response.body?.string().orEmpty()))
                        val source = response.body?.source() ?: throw AiError.Network("无响应体")
                        val scanner = AiObjectScanner()
                        while (true) {
                            val line = source.readUtf8Line() ?: break
                            if (line.trim() == "data: [DONE]") break
                            val delta = sseContentDelta(line)
                            if (delta.isNullOrEmpty()) continue
                            scanner.append(delta)
                            onDelta?.invoke(delta)
                            if (scanner.objects.size >= batchCount) break
                        }
                        val found = AiPayloadParser.parseObjects(scanner.objects.joinToString("") { it.toString() })
                        if (found.isEmpty()) throw AiError.Parse("AI 未返回可用回复，请重试")
                        return@withContext found
                    }
                } catch (e: AiError.HttpStatus) {
                    if ((e.code == 429 || e.code in 500..599) && attempt < 2) {
                        kotlinx.coroutines.delay(retryBaseDelayMs * (1L shl attempt))
                        continue
                    }
                    throw e
                }
            }
            throw AiError.Network("重试耗尽")
        }
    }

    companion object {
        private val jsonMedia = "application/json; charset=utf-8".toMediaTypeOrNull()
        private const val MAX_CARDS_PER_REQUEST = 6
        const val ANDROID_VERSION_NAME = "0.3.0"

        fun userAgent(): String = "KnowFlick-Android/$ANDROID_VERSION_NAME"

        /** 保留服务商自定义 API 前缀，只有裸域名才补 /v1（与 macOS 口径一致） */
        fun completionURL(baseURL: String): URL {
            val raw = baseURL.trim()
            val url = runCatching { URL(raw) }.getOrNull()
                ?: throw AiError.BadRequest("请输入有效的 HTTP(S) API Base URL")
            if (url.protocol !in listOf("https", "http")) throw AiError.BadRequest("请输入有效的 HTTP(S) API Base URL")
            var path = url.path ?: ""
            while (path.endsWith("/")) path = path.dropLast(1)
            if (!path.endsWith("/chat/completions")) {
                path += if (path.isEmpty()) "/v1/chat/completions" else "/chat/completions"
            }
            return URL(url.protocol, url.host, url.port, path)
        }

        /** "data: {json}" → 内容增量（兼容 delta.content / message.content） */
        fun sseContentDelta(line: String): String? {
            val trimmed = line.trim()
            if (!trimmed.startsWith("data:")) return null
            val payload = trimmed.drop(5).trim()
            if (payload.isEmpty() || payload == "[DONE]") return null
            return runCatching {
                val obj = Json.parseToJsonElement(payload).jsonObjectSafe()
                val choices = obj["choices"] as? kotlinx.serialization.json.JsonArray ?: return null
                val first = choices.firstOrNull() as? kotlinx.serialization.json.JsonObject ?: return null
                val delta = first["delta"] as? kotlinx.serialization.json.JsonObject
                val message = first["message"] as? kotlinx.serialization.json.JsonObject
                delta?.get("content")?.primitiveContent()
                    ?: message?.get("content")?.primitiveContent()
            }.getOrNull()
        }

        /** 从错误响应体提取 message 字段（上限 600 字符） */
        fun errorMessage(body: String): String = runCatching {
            val obj = Json.parseToJsonElement(body).jsonObjectSafe()
            val error = obj["error"] as? kotlinx.serialization.json.JsonObject
            (error?.get("message") as? kotlinx.serialization.json.JsonPrimitive)?.content
                ?: (obj["message"] as? kotlinx.serialization.json.JsonPrimitive)?.content
        }.getOrNull() ?: body.take(600)

        /** 本地部署识别：回环主机或 Ollama 默认端口（与 macOS 表驱动口径一致） */
        fun requiresKey(baseURL: String): Boolean = !AiProviderPresets.match(baseURL).let { it.id in AiProviderPresets.keylessIds }

        private fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(180, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()

    }
}

private fun newId(): String = java.util.UUID.randomUUID().toString().uppercase()

private fun kotlinx.serialization.json.JsonElement.jsonObjectSafe(): kotlinx.serialization.json.JsonObject =
    this as kotlinx.serialization.json.JsonObject

private fun kotlinx.serialization.json.JsonElement.primitiveContent(): String? =
    (this as? kotlinx.serialization.json.JsonPrimitive)?.content

