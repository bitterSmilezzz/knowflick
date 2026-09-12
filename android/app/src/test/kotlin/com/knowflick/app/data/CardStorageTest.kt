package com.knowflick.app.data

import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
import java.io.File
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** 持久化层：镜像 macOS StorageTests 的核心承诺 */
class CardStorageTest {
    private val baseDir = File(System.getProperty("java.io.tmpdir"), "knowflick-test-" + System.nanoTime())
    private val storage = CardStorage(baseDir)

    @AfterTest
    fun cleanup() {
        baseDir.deleteRecursively()
    }

    private fun makeCard(headline: String) =
        KnowledgeCard.create("学习", headline, "摘要", "正文", source = CardSource.IMPORTED)

    @Test
    fun roundTripPreservesCards() {
        storage.saveCards(listOf(makeCard("内容卡")))
        assertEquals(listOf("内容卡"), storage.loadCards().map { it.headline })
    }

    @Test
    fun backupRotationKeepsPreviousVersion() {
        storage.saveCards(listOf(makeCard("第一版")))
        storage.saveCards(listOf(makeCard("第二版")))
        storage.saveCards(listOf(makeCard("第三版")))
        val backup = CardFileIO.decodeList(CardFileIO.backupFile(baseDir).readText())
        // 备份必须是「上一版」（第二版）
        assertEquals(listOf("第二版"), backup.map { it.headline })
    }

    @Test
    fun corruptedMainFallsBackToBackupAndRepairs() {
        storage.saveCards(listOf(makeCard("健康版")))
        cardsFile().writeText("{ not valid json")

        assertEquals(listOf("健康版"), storage.loadCards().map { it.headline })
        // 恢复后主文件重建为健康内容
        assertEquals(listOf("健康版"), CardFileIO.decodeList(cardsFile().readText()).map { it.headline })
    }

    @Test
    fun corruptionDoesNotPolluteBackup() {
        storage.saveCards(listOf(makeCard("健康版")))
        cardsFile().writeText("{ corrupt")
        storage.loadCards()   // 触发恢复（置位损坏标记）
        // 下一次保存轮转的备份不应包含坏字节
        storage.saveCards(listOf(makeCard("新版")))
        val backup = CardFileIO.decodeList(CardFileIO.backupFile(baseDir).readText())
        assertEquals(listOf("健康版"), backup.map { it.headline })
    }

    @Test
    fun bothFilesCorruptedYieldsEmptyAndFlags() {
        cardsFile().writeText("{ bad")
        CardFileIO.backupFile(baseDir).writeText("{ also bad")
        assertTrue(storage.loadCards().isEmpty(), "两级文件全损坏 → 空库")
        // 损坏标记置位：后续保存用新数据做备份起点（坏字节不进备份）
        storage.saveCards(listOf(makeCard("新内容")))
        assertEquals(listOf("新内容"), CardFileIO.decodeList(CardFileIO.backupFile(baseDir).readText()).map { it.headline })
    }

    @Test
    fun settingsJsonRoundTrip() {
        storage.saveSettingsJson("""{"apiKeySet":true}""")
        assertEquals("""{"apiKeySet":true}""", storage.loadSettingsJson())
    }

    private fun cardsFile(): File = File(baseDir, "cards.json")
}
