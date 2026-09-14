package com.knowflick.app.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** 卡片 JSON 编解码：线格式与 Swift Codable 对齐 + 宽松解码语义 */
class CardJsonTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun encode(card: KnowledgeCard): String =
        json.encodeToString(CardJson.CardJsonSerializer, card)

    private fun decode(text: String): KnowledgeCard =
        json.decodeFromString(CardJson.CardJsonSerializer, text)

    @Test
    fun roundTripPreservesAllFields() {
        val card = KnowledgeCard(
            id = "11111111-2222-3333-4444-555555555555",
            category = "物理",
            headline = "量子纠缠",
            summary = "摘要",
            details = "正文\n\n第二段",
            links = listOf(ScienceLink("维基", "https://example.com")),
            source = CardSource.AI,
            createdAt = 1_700_000_000_000,
            seenAt = 1_700_000_100_000,
            swiped = SwipeDirection.RIGHT,
            isFavorite = true,
            favoritedAt = 1_700_000_100_000,
            reviewCount = 3,
            masteryLevel = 2,
            lastReviewedAt = 1_700_000_200_000,
        )
        val restored = decode(encode(card))
        assertEquals(card, restored)
    }

    @Test
    fun wireFormatMatchesSwiftIso8601() {
        // Swift .iso8601 编码 "2023-11-14T22:13:20Z"；Android 端须可解码
        val swift = """
            {"id":"11111111-2222-3333-4444-555555555555","category":"物理","headline":"量子纠缠","summary":"摘要","details":"正文","source":"ai","createdAt":"2023-11-14T22:13:20Z","seenAt":"2023-11-14T22:13:21Z","swiped":"right","isFavorite":true}
        """.trimIndent()
        val card = decode(swift)
        assertEquals(1_700_000_000_000L, card.createdAt)
        assertEquals(1_700_000_001_000L, card.seenAt)
        assertEquals(SwipeDirection.RIGHT, card.swiped)
        assertTrue(card.isFavorite)
    }

    @Test
    fun legacyDataWithoutFavoriteBackfillsFromSwipe() {
        val legacy = """
            {"id":"1","category":"历史","headline":"标题","summary":"摘要","details":"正文","source":"seed","createdAt":"2023-11-14T22:13:20Z","swiped":"right","seenAt":"2023-11-14T22:13:20Z"}
        """.trimIndent()
        val card = decode(legacy)
        assertTrue(card.isFavorite, "旧数据无 isFavorite 应从右划回填")
        assertEquals(card.seenAt, card.favoritedAt, "favoritedAt 应回填 seenAt")
    }

    @Test
    fun unknownSourceFallsBackToSeed() {
        val card = decode("""{"id":"1","category":"历史","headline":"t","summary":"s","details":"d","source":"alien"}""")
        assertEquals(CardSource.SEED, card.source)
    }

    @Test
    fun toleratesFractionalSecondsAndEpochDates() {
        val withMillis = decode(
            """{"id":"1","category":"历史","headline":"t","summary":"s","details":"d","source":"seed","createdAt":"2026-01-02T03:04:05.678Z"}""",
        )
        assertEquals(1_767_323_045_678L, withMillis.createdAt)

        val epoch = decode(
            """{"id":"1","category":"历史","headline":"t","summary":"s","details":"d","source":"seed","createdAt":1767323045}""",
        )
        assertEquals(1_767_323_045_000L, epoch.createdAt)
    }

    @Test
    fun encodedDatesUseIso8601() {
        val card = KnowledgeCard.create("物理", "标题", "摘要", "正文", source = CardSource.IMPORTED, createdAt = 1_700_000_000_000)
        assertTrue(encode(card).contains("\"createdAt\":\"2023-11-14T22:13:20Z\""))
    }

    @Test
    fun fnvHashIsCrossPlatformStable() {
        // macOS 端锚点：deterministicHash("knowflick") == 10604710463354862449（无符号）
        // 超出 Long 有符号范围，2^64 补码表示：
        assertEquals(-7842033610354689167L, CardArrange.deterministicHash("knowflick"))
        assertEquals(-143189547715103932L, CardArrange.deterministicHash("量子纠缠"))
    }

    @Test
    fun jsonElementHelpersIgnoreNonStringTypes() {
        val obj = buildJsonObject { put("headline", 42) }
        val card = CardJson.fromJsonElement(obj)
        assertEquals("42", card.headline)   // 数字按字符串形式宽容处理（外部工具产物）
        assertFalse(card.isFavorite)
    }
}
