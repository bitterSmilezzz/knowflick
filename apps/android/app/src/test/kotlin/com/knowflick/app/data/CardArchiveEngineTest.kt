package com.knowflick.app.data

import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
import java.io.ByteArrayInputStream
import java.util.zip.ZipInputStream
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class CardArchiveEngineTest {

    private val sampleCards = listOf(
        KnowledgeCard.create(
            category = "认知科学",
            headline = "邓宁-克鲁格效应",
            summary = "能力欠缺者容易产生虚幻优越感，高能力者反而容易低估自己。",
            details = "邓宁-克鲁格效应是一种认知偏差，能力不足的人往往无法正确认识到自身的无知。\n随着学习深入，人们才会意识到知识的浩瀚。",
            source = CardSource.SEED,
        ).copy(
            id = "CARD_1",
            isFavorite = true,
            favoritedAt = 1700000000000L,
            seenAt = 1700000001000L,
        ),
        KnowledgeCard.create(
            category = "心智模型",
            headline = "第一性原理",
            summary = "透过现象看本质，从最底层基础真理向上推演推导。",
            details = "第一性原理思维由亚里士多德提出，马斯克将其在商业中发扬光大。",
            source = CardSource.AI,
        ).copy(
            id = "CARD_2",
            isFavorite = false,
            seenAt = null,
        ),
    )

    @Test
    fun testBuildFullBackupZip() {
        val settingsJson = "{\"baseURL\":\"https://api.openai.com/v1\",\"model\":\"gpt-4o\"}"
        val zipBytes = CardArchiveEngine.buildFullBackupZip(sampleCards, settingsJson)
        assertTrue(zipBytes.isNotEmpty())

        val entries = mutableMapOf<String, ByteArray>()
        ByteArrayInputStream(zipBytes).use { bais ->
            ZipInputStream(bais).use { zis ->
                var entry = zis.nextEntry
                while (entry != null) {
                    entries[entry.name] = zis.readBytes()
                    zis.closeEntry()
                    entry = zis.nextEntry
                }
            }
        }

        assertTrue(entries.containsKey("cards.json"))
        assertTrue(entries.containsKey("manifest.json"))
        assertTrue(entries.containsKey("settings.json"))
        assertTrue(entries.containsKey("README.txt"))

        val cardsJsonText = String(entries["cards.json"]!!, Charsets.UTF_8)
        val decodedCards = CardFileIO.decodeList(cardsJsonText)
        assertEquals(2, decodedCards.size)
        assertEquals("CARD_1", decodedCards[0].id)
        assertEquals("邓宁-克鲁格效应", decodedCards[0].headline)
        assertTrue(decodedCards[0].isFavorite)

        val manifestText = String(entries["manifest.json"]!!, Charsets.UTF_8)
        assertTrue(manifestText.contains("\"totalCards\":2") || manifestText.contains("\"totalCards\": 2"))
        assertTrue(manifestText.contains("\"favoriteCards\":1") || manifestText.contains("\"favoriteCards\": 1"))

        val settingsText = String(entries["settings.json"]!!, Charsets.UTF_8)
        assertEquals(settingsJson, settingsText)
    }

    @Test
    fun testBuildObsidianVaultZip() {
        val zipBytes = CardArchiveEngine.buildObsidianVaultZip(sampleCards)
        assertTrue(zipBytes.isNotEmpty())

        val entries = mutableMapOf<String, ByteArray>()
        ByteArrayInputStream(zipBytes).use { bais ->
            ZipInputStream(bais).use { zis ->
                var entry = zis.nextEntry
                while (entry != null) {
                    entries[entry.name] = zis.readBytes()
                    zis.closeEntry()
                    entry = zis.nextEntry
                }
            }
        }

        assertTrue(entries.containsKey("README.md"))
        val cardEntries = entries.keys.filter { it.startsWith("cards/") && it.endsWith(".md") }
        assertEquals(2, cardEntries.size)

        val card1EntryName = cardEntries.firstOrNull { it.contains("邓宁-克鲁格效应") }
        assertNotNull(card1EntryName)
        val card1Md = String(entries[card1EntryName]!!, Charsets.UTF_8)
        assertTrue(card1Md.contains("category: \"认知科学\""))
        assertTrue(card1Md.contains("knowflick"))
        assertTrue(card1Md.contains("[[认知科学]]"))
        assertTrue(card1Md.contains("能力欠缺者容易产生虚幻优越感"))
    }

    @Test
    fun testBuildJsonArchive() {
        val jsonBytes = CardArchiveEngine.buildJsonArchive(sampleCards)
        val jsonText = String(jsonBytes, Charsets.UTF_8)
        val decoded = CardFileIO.decodeList(jsonText)
        assertEquals(2, decoded.size)
        assertEquals("邓宁-克鲁格效应", decoded[0].headline)
        assertEquals("第一性原理", decoded[1].headline)
    }

    @Test
    fun testBuildMarkdownSingle() {
        val mdBytes = CardArchiveEngine.buildMarkdownSingle(sampleCards, "我的知识库导出")
        val mdText = String(mdBytes, Charsets.UTF_8)
        assertTrue(mdText.contains("# 📚 我的知识库导出"))
        assertTrue(mdText.contains("## 📑 目录索引"))
        assertTrue(mdText.contains("邓宁-克鲁格效应"))
        assertTrue(mdText.contains("第一性原理"))
        assertTrue(mdText.contains("## 💡 知识笔记详情"))
    }

    @Test
    fun testBuildAnkiTSV() {
        val tsvBytes = CardArchiveEngine.buildAnkiTSV(sampleCards)
        val tsvText = String(tsvBytes, Charsets.UTF_8)
        assertTrue(tsvText.startsWith("front\tback\tcategory"))
        assertTrue(tsvText.contains("邓宁-克鲁格效应"))
        assertTrue(tsvText.contains("认知科学"))
        assertTrue(tsvText.contains("第一性原理"))
        assertTrue(tsvText.contains("心智模型"))
    }

    @Test
    fun testGenerateExportDataForAllFormats() {
        ArchiveExportFormat.entries.forEach { format ->
            val (filename, bytes) = CardArchiveEngine.generateExportData(
                cards = sampleCards,
                format = format,
                settingsJson = "{}",
            )
            assertTrue(filename.endsWith(".${format.fileExtension}"), "格式 ${format.name} 文件名后缀不匹配: $filename")
            assertTrue(bytes.isNotEmpty(), "格式 ${format.name} 导出字节为空")
        }
    }
}
