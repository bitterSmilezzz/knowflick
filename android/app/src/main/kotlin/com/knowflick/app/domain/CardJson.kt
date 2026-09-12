package com.knowflick.app.domain

import java.time.Instant
import java.time.format.DateTimeParseException
import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/**
 * KnowledgeCard 的 JSON 编解码。
 *
 * 线格式与 macOS（Swift Codable / ISO8601）逐字段对齐；解码语义移植自 Swift 侧自定义
 * `init(from:)`：
 * - 必填字段：id/category/headline/summary/details/source；links 缺省为空
 * - createdAt 缺省 = 当前时间；其余可选字段缺省 = null / false / 0
 * - 旧数据无 isFavorite：从「swiped == right」回填；favoritedAt 缺省回填 seenAt
 * - 未知 source 值兜底 SEED；日期兼容秒级/毫秒级 ISO8601 与 epoch 数字
 */
object CardJson {

    /** 与 Swift `JSONEncoder.dateEncodingStrategy = .iso8601` 一致：秒级 ISO8601（UTC，Z 后缀） */
    fun encodeDate(epochMillis: Long): String = Instant.ofEpochMilli(epochMillis).toString()

    /** 宽松日期解码：ISO8601（含毫秒级）→ epoch 数字（秒级启发式 ×1000）→ null */
    fun decodeDate(raw: String?): Long? {
        if (raw == null) return null
        return try {
            Instant.parse(raw).toEpochMilli()
        } catch (_: DateTimeParseException) {
            epochToMillis(raw.toLongOrNull())
                ?: raw.toDoubleOrNull()?.takeIf { it.isFinite() }?.let { epochToMillis(it.toLong()) }
        }
    }

    /** epoch 秒/毫秒启发式：|v| < 10^10 视为秒级时间戳（毫秒时间戳为 13 位数字） */
    private fun epochToMillis(seconds: Long?): Long? = seconds?.let {
        if (it < 10_000_000_000L) it * 1000 else it
    }

    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.content

    private fun JsonObject.longField(key: String): Long? =
        (this[key] as? JsonPrimitive)?.let {
            val numeric = it.longOrNull
            if (numeric != null) epochToMillis(numeric) else CardJson.decodeDate(it.content)
        }

    private fun JsonObject.intField(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull

    private fun JsonObject.boolField(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull

    fun fromJsonElement(element: JsonElement): KnowledgeCard {
        val obj = element.jsonObject
        val swiped = obj.str("swiped")?.let(SwipeDirection::fromRaw)
        val isFavorite = obj.boolField("isFavorite")
            // 旧数据无 isFavorite 字段：从「右划感兴趣」回填（与 Swift 解码语义一致）
            ?: (swiped == SwipeDirection.RIGHT)
        val favoritedAt = obj.longField("favoritedAt")
            ?: if (isFavorite) obj.longField("seenAt") else null

        return KnowledgeCard(
            id = obj.str("id") ?: java.util.UUID.randomUUID().toString().uppercase(),
            category = obj.str("category") ?: "",
            headline = obj.str("headline") ?: "",
            summary = obj.str("summary") ?: "",
            details = obj.str("details") ?: "",
            links = (obj["links"] as? JsonArray)?.map { link ->
                val linkObj = link.jsonObject
                ScienceLink(title = linkObj.str("title") ?: "", url = linkObj.str("url") ?: "")
            } ?: emptyList(),
            source = CardSource.fromRaw(obj.str("source")),
            createdAt = obj.longField("createdAt") ?: System.currentTimeMillis(),
            seenAt = obj.longField("seenAt"),
            swiped = swiped,
            isFavorite = isFavorite,
            favoritedAt = favoritedAt,
            reviewCount = obj.intField("reviewCount") ?: 0,
            masteryLevel = obj.intField("masteryLevel") ?: 0,
            lastReviewedAt = obj.longField("lastReviewedAt"),
        )
    }

    fun toJsonElement(card: KnowledgeCard): JsonObject = buildJsonObject {
        put("id", card.id)
        put("category", card.category)
        put("headline", card.headline)
        put("summary", card.summary)
        put("details", card.details)
        put(
            "links",
            JsonArray(card.links.map { link ->
                buildJsonObject {
                    put("title", link.title)
                    put("url", link.url)
                }
            }),
        )
        put("source", card.source.raw)
        put("createdAt", encodeDate(card.createdAt))
        card.seenAt?.let { put("seenAt", encodeDate(it)) }
        card.swiped?.let { put("swiped", it.raw) }
        put("isFavorite", card.isFavorite)
        card.favoritedAt?.let { put("favoritedAt", encodeDate(it)) }
        put("reviewCount", card.reviewCount)
        put("masteryLevel", card.masteryLevel)
        card.lastReviewedAt?.let { put("lastReviewedAt", encodeDate(it)) }
    }

    object CardJsonSerializer : KSerializer<KnowledgeCard> {
        override val descriptor: SerialDescriptor = JsonObject.serializer().descriptor

        override fun serialize(encoder: Encoder, value: KnowledgeCard) {
            val jsonEncoder = encoder as? JsonEncoder
                ?: throw IllegalStateException("KnowledgeCard 仅支持 JSON 编解码")
            jsonEncoder.encodeJsonElement(toJsonElement(value))
        }

        override fun deserialize(decoder: Decoder): KnowledgeCard {
            val jsonDecoder = decoder as? JsonDecoder
                ?: throw IllegalStateException("KnowledgeCard 仅支持 JSON 编解码")
            return fromJsonElement(jsonDecoder.decodeJsonElement())
        }
    }

    /** 卡片列表编解码（cards.json 线格式 = 卡片对象数组） */
    object CardListSerializer : KSerializer<List<KnowledgeCard>> {
        override val descriptor: SerialDescriptor = JsonArray.serializer().descriptor

        override fun serialize(encoder: Encoder, value: List<KnowledgeCard>) {
            val jsonEncoder = encoder as? JsonEncoder
                ?: throw IllegalStateException("卡片列表仅支持 JSON 编解码")
            jsonEncoder.encodeJsonElement(JsonArray(value.map(CardJson::toJsonElement)))
        }

        override fun deserialize(decoder: Decoder): List<KnowledgeCard> {
            val jsonDecoder = decoder as? JsonDecoder
                ?: throw IllegalStateException("卡片列表仅支持 JSON 编解码")
            return jsonDecoder.decodeJsonElement().jsonArray.map(CardJson::fromJsonElement)
        }
    }
}
