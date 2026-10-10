package com.knowflick.app.domain

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 学科注册表的契约测试。
 *
 * 关键作用是把 Android 内嵌表钉在 `shared/assets/taxonomy_map.json` 上——
 * macOS 端有同样的测试。这样「双端学科表不一致」这种只有真机对照才会暴露的问题，
 * 在单测阶段就红，而不是等用户发现手机上少一个分支。
 */
class SubjectRegistryTest {

    private fun fixture(): JsonObject {
        val file = generateSequence(File(System.getProperty("user.dir"))) { it.parentFile }
            .map { File(it, "shared/assets/taxonomy_map.json") }
            .firstOrNull { it.isFile }
            ?: error("找不到 shared/assets/taxonomy_map.json，无法校验双端学科表一致性")
        return Json.parseToJsonElement(file.readText()) as JsonObject
    }

    @Test
    fun embeddedLevelsMatchSharedFixture() {
        val expected = fixture().obj("levels").entries.associate { (key, value) ->
            key.toInt() to (value as JsonPrimitive).content
        }
        assertEquals(expected, SubjectRegistry.levels)
    }

    @Test
    fun embeddedSubjectsMatchSharedFixture() {
        val expected = fixture().arr("subjects").map { entry ->
            val obj = entry as JsonObject
            SubjectSpec(
                slug = obj.str("slug")!!,
                name = obj.str("name")!!,
                tracks = (obj["tracks"] as? JsonArray)?.map { (it as JsonPrimitive).content } ?: emptyList(),
                branches = (obj["branches"] as? JsonArray).orEmpty().map { branch ->
                    BranchSpec(branch.jsonObject.str("slug")!!, branch.jsonObject.str("name")!!)
                },
            )
        }
        assertEquals("学科与分支必须与共享契约夹具逐条一致", expected, SubjectRegistry.subjects)
    }

    @Test
    fun embeddedLegacyCategoryMapMatchesSharedFixture() {
        val expected = fixture().obj("legacyCategoryMap").mapValues { entry ->
            val obj = entry.value as JsonObject
            LegacyMapping(
                subject = obj.str("subject")!!,
                branch = obj.str("branch"),
                track = obj.str("track"),
            )
        }
        assertEquals(expected, SubjectRegistry.legacyCategoryMap)
    }

    @Test
    fun everyFixtureSubjectAndBranchResolves() {
        for (spec in SubjectRegistry.subjects) {
            assertEquals(spec, SubjectRegistry.subject(spec.slug))
            for (branch in spec.branches) {
                assertEquals(branch, spec.branch(branch.slug))
            }
        }
        // 映射表里出现的 slug 必须真实存在，否则界面上会点出空分支
        for (mapping in SubjectRegistry.legacyCategoryMap.values) {
            assertTrue("未知学科 ${mapping.subject}", SubjectRegistry.subject(mapping.subject) != null)
            mapping.branch?.let {
                assertTrue("学科 ${mapping.subject} 没有分支 $it", SubjectRegistry.subject(mapping.subject)!!.branch(it) != null)
            }
        }
    }

    @Test
    fun explicitFieldsWinAndLegacyCategoryFillsGaps() {
        val legacy = card(category = "中级会计")
        val taxonomy = SubjectRegistry.taxonomyOf(legacy)
        assertEquals("accounting", taxonomy.subject)
        assertEquals("中级会计", taxonomy.track)
        assertNull("历史卡没有内容难度，不能凭空补", taxonomy.level)

        val explicit = card(category = "冷知识").copy(subject = "english", branch = "grammar", level = 3)
        val explicitTaxonomy = SubjectRegistry.taxonomyOf(explicit)
        assertEquals("english", explicitTaxonomy.subject)
        assertEquals("grammar", explicitTaxonomy.branch)
        assertEquals(3, explicitTaxonomy.level)
    }

    @Test
    fun unmappedCategoryStaysUngraded() {
        val taxonomy = SubjectRegistry.taxonomyOf(card(category = "物理"))
        assertNull("未列入映射表的学科不得被硬塞进冷知识", taxonomy.subject)
        assertEquals("未分级", SubjectRegistry.displayName(null))
        assertEquals("L2 基础", SubjectRegistry.levelName(2))
    }

    @Test
    fun validationRejectsUnknownBranchAndLevelOutOfRange() {
        val bad = card().copy(subject = "english", branch = "nope", level = 9, track = "不存在的标尺")
        val issues = SubjectRegistry.validationIssues(bad)
        assertTrue("应报分支不属于学科：$issues", issues.any { it.contains("分支 nope") })
        assertTrue("应报难度越界：$issues", issues.any { it.contains("难度") })
        assertTrue("应报标尺不在候选：$issues", issues.any { it.contains("标尺") })
        assertTrue(SubjectRegistry.validationIssues(card().copy(subject = "english", branch = "grammar", level = 2)).isEmpty())
    }

    @Test
    fun taxonomyFieldsRoundTripThroughWireFormat() {
        val card = card(headline = "定语从句三步拆解").copy(
            subject = "english",
            branch = "grammar",
            level = 4,
            track = "大学英语六级",
            orderKey = "en/grammar/0042",
            prereq = listOf("AAA", "BBB"),
        )
        val restored = CardJson.decodeList(CardJson.encodeList(listOf(card))).first()
        assertEquals(card, restored)
    }

    @Test
    fun legacyWirePayloadWithoutTaxonomyKeysStillDecodes() {
        val legacy = """[{"id":"X1","category":"冷知识","headline":"标题","summary":"摘要","details":"正文","source":"seed","createdAt":"2026-01-01T00:00:00Z"}]"""
        val card = CardJson.decodeList(legacy).first()
        assertNull(card.subject)
        assertNull(card.level)
        assertEquals(emptyList<String>(), card.prereq)
        // 未分级的卡不写新键：旧版本 App 收到同步包也不会遇到未知字段
        val encoded = CardJson.encodeList(listOf(card))
        assertTrue("未分级卡不应写出 subject 键", !encoded.contains("\"subject\""))
        assertTrue("未分级卡不应写出 prereq 键", !encoded.contains("\"prereq\""))
    }

    @Test
    fun mergeKeepsGradingFromTheEndThatHasIt() {
        val graded = card().copy(subject = "accounting", branch = "cost", level = 3, orderKey = "k1", prereq = listOf("P1"))
        val ungraded = card().copy(createdAt = graded.createdAt + 10_000L)   // 更新，但没分级
        val merged = CardStore.mergeCard(graded, ungraded)
        assertEquals("accounting", merged.subject)
        assertEquals("cost", merged.branch)
        assertEquals(3, merged.level)
        assertEquals("k1", merged.orderKey)
        assertEquals(listOf("P1"), merged.prereq)
    }

    @Test
    fun shardPartitionPutsEveryCardInExactlyOneShard() {
        val cards = listOf(
            card(category = "AI"),
            card(category = "AI Agent"),
            card(category = "投资理财"),
            card(category = "中级会计"),
            card(category = "物理"),          // 未分级
        )
        val summaries = SubjectRegistry.subjectSummaries(cards)
        assertEquals("分片摘要必须覆盖全部卡片", cards.size, summaries.sumOf { it.count })
        assertEquals("未分级固定排在末尾", "未分级", summaries.last().name)
        assertEquals(listOf("ai", "ai"), listOf(
            SubjectRegistry.shardSlugOf(cards[0]),
            SubjectRegistry.shardSlugOf(cards[1]),
        ))
        assertNull(SubjectRegistry.shardSlugOf(cards[4]))
        assertEquals(2, SubjectRegistry.cardsIn(cards, "ai").size)
        assertEquals(1, SubjectRegistry.cardsIn(cards, null).size)
    }

    @Test
    fun explicitlyGradedCardsJoinTheirShardEvenWithLegacyCategory() {
        val englishUnderTrivia = card(category = "冷知识").copy(subject = "english", branch = "grammar")
        assertEquals("english", SubjectRegistry.shardSlugOf(englishUnderTrivia))
        assertEquals(1, SubjectRegistry.cardsIn(listOf(englishUnderTrivia), "english").size)
        assertTrue(SubjectRegistry.cardsIn(listOf(englishUnderTrivia), "trivia").isEmpty())
    }

    private fun card(
        category: String = "冷知识",
        headline: String = "标题",
    ) = KnowledgeCard(
        id = "CARD-1",
        category = category,
        headline = headline,
        summary = "摘要",
        details = "正文",
        links = emptyList(),
        source = CardSource.SEED,
        createdAt = 1_800_000_000_000L,
    )

    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.content
    private fun JsonObject.obj(key: String): JsonObject = this[key] as JsonObject
    private fun JsonObject.arr(key: String): JsonArray = this[key] as JsonArray
}
