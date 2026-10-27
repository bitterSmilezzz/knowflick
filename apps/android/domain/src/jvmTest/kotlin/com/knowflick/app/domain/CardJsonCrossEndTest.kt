package com.knowflick.app.domain

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 卡片线格式的跨端一致性检查（Kotlin 侧）。
 *
 * ADR-0002 §3 的硬契约是「两套共享同一份 `cards.json` 结构，拷过去就能打开，中间不经转换」。
 * 这条契约以前只有「读代码逐字段比对」这一种证据，没有实测——而兜底规则一旦在某端漂移，
 * 用户的卡片会在两端来回搬动时悄悄变形。
 *
 * 做法：同一份输入分别喂给两端的解析器，比**规范化后**（键排序）的输出。
 * 这里的期望值取自 workbench 侧同一份输入的实际输出
 * （`apps/workbench/src/domain/card.ts` 的 `cardFromJson` → `cardToJson`），
 * 对端见 `apps/workbench/src/domain/card.crossend.test.ts`。
 */
class CardJsonCrossEndTest {

    private val base = """
        {"id":"x1","category":"物理","headline":"标题","summary":"摘要","details":"详情",
         "source":"imported","createdAt":1759000000000}
    """.trimIndent()

    private fun canonical(listJson: String): String {
        val array = Json.parseToJsonElement(listJson) as JsonArray
        val element = array[0] as JsonObject
        return element.entries.sortedBy { it.key }
            .joinToString(",", "{", "}") { "\"${it.key}\":${it.value}" }
    }

    /** 单卡输入 → 两端都该产出同一串（键排序后）。 */
    private fun roundTrip(input: String): String {
        val cards = CardJson.decodeList("[$input]")
        assertEquals("应当解出一张卡", 1, cards.size)
        return canonical(CardJson.encodeList(cards))
    }

    @Test
    fun minimalCardWritesTheSameFieldsAsTheWorkbenchSide() {
        assertEquals(
            """{"category":"物理","createdAt":"2025-09-27T19:06:40Z","details":"详情","easeFactor":2.5,"headline":"标题","id":"x1","intervalDays":1,"isFavorite":false,"links":[],"masteryLevel":0,"repetition":0,"reviewCount":0,"source":"imported","summary":"摘要"}""",
            roundTrip(base),
        )
    }

    @Test
    fun unknownFieldsAndBlankTaxonomyAreDroppedOnBothSides() {
        val input = base.replace(
            "\"createdAt\"",
            "\"foo\":1,\"subject\":\"  \",\"level\":9,\"track\":\"\",\"createdAt\"",
        )
        // 未知字段、空串学科字段、越界 level 都不该出现在输出里
        assertEquals(
            """{"category":"物理","createdAt":"2025-09-27T19:06:40Z","details":"详情","easeFactor":2.5,"headline":"标题","id":"x1","intervalDays":1,"isFavorite":false,"links":[],"masteryLevel":0,"repetition":0,"reviewCount":0,"source":"imported","summary":"摘要"}""",
            roundTrip(input),
        )
    }

    @Test
    fun epochSecondsAreUpscaledToMillisecondsThenWrittenAsIso() {
        // |v| < 10^10 视为秒级时间戳：1700000000 → 2023-11-14T22:13:20Z
        assertEquals(
            """{"category":"物理","createdAt":"2023-11-14T22:13:20Z","details":"详情","easeFactor":2.5,"headline":"标题","id":"x1","intervalDays":1,"isFavorite":false,"links":[],"masteryLevel":0,"repetition":0,"reviewCount":0,"source":"imported","summary":"摘要"}""",
            roundTrip(base.replace("1759000000000", "1700000000")),
        )
    }

    @Test
    fun favoriteIsBackfilledFromRightSwipe() {
        val input = base.replace(
            "\"createdAt\"",
            "\"swiped\":\"right\",\"seenAt\":1759000000000,\"createdAt\"",
        )
        assertEquals(
            """{"category":"物理","createdAt":"2025-09-27T19:06:40Z","details":"详情","easeFactor":2.5,"favoritedAt":"2025-09-27T19:06:40Z","headline":"标题","id":"x1","intervalDays":1,"isFavorite":true,"links":[],"masteryLevel":0,"repetition":0,"reviewCount":0,"seenAt":"2025-09-27T19:06:40Z","source":"imported","summary":"摘要","swiped":"right"}""",
            roundTrip(input),
        )
    }

    @Test
    fun unknownSourceFallsBackToSeedOnBothSides() {
        assertEquals(
            """{"category":"物理","createdAt":"2025-09-27T19:06:40Z","details":"详情","easeFactor":2.5,"headline":"标题","id":"x1","intervalDays":1,"isFavorite":false,"links":[],"masteryLevel":0,"repetition":0,"reviewCount":0,"source":"seed","summary":"摘要"}""",
            roundTrip(base.replace("\"imported\"", "\"legacy\"")),
        )
    }
}
