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

    @Test
    fun updateCardsRebasesOntoLatestStateUnderLock() {
        // A5 契约：updateCards 以锁内最新卡库为基线，调用方持有的旧快照不参与写回
        val appCard = makeCard("App写入卡").copy(id = "app-x")
        val widgetCard = makeCard("微件当前卡").copy(id = "widget-y")
        storage.saveCards(listOf(appCard, widgetCard))
        val stale = storage.loadCards()   // 微件在 App 写入前捕获的旧快照
        storage.saveCards(listOf(appCard.copy(isFavorite = true), widgetCard))

        val bases = mutableListOf<List<KnowledgeCard>>()
        val result = storage.updateCards { latest ->
            bases += latest
            latest.map { if (it.id == "widget-y") it.copy(isFavorite = true) else it }
        }

        assertTrue(result is CardSaveResult.Saved)
        assertEquals(1, bases.size)
        assertTrue(
            bases.single().first { it.id == "app-x" }.isFavorite,
            "transform 基线必须是锁内最新卡库，不得是调用方旧快照",
        )
        val final = storage.loadCards()
        assertTrue(final.first { it.id == "app-x" }.isFavorite, "App 写入不得被微件写回冲掉")
        assertTrue(final.first { it.id == "widget-y" }.isFavorite, "微件的增量必须落库")
    }

    @Test
    fun updateCardsExcludesConcurrentSaveCards() {
        // 读-改-写必须整体持锁：并发 saveCards 只能排在它之前或之后，不得插进中间
        val entered = java.util.concurrent.CountDownLatch(1)
        val release = java.util.concurrent.CountDownLatch(1)
        val updateDone = java.util.concurrent.CountDownLatch(1)
        val appCard = makeCard("App写入卡").copy(id = "app-x")
        val widgetCard = makeCard("微件当前卡").copy(id = "widget-y")
        storage.saveCards(listOf(appCard, widgetCard))

        Thread {
            storage.updateCards { cards ->
                entered.countDown()
                release.await(5, java.util.concurrent.TimeUnit.SECONDS)
                cards
            }
            updateDone.countDown()
        }.apply { start() }

        assertTrue(entered.await(5, java.util.concurrent.TimeUnit.SECONDS))
        val appWriteDone = java.util.concurrent.CountDownLatch(1)
        Thread {
            storage.saveCards(listOf(appCard.copy(isFavorite = true), widgetCard))
            appWriteDone.countDown()
        }.apply { start() }

        // 若锁被共享，App 写入必须排队等待；只有它插进了读-改-写中间才会提前完成
        assertTrue(
            !appWriteDone.await(150, java.util.concurrent.TimeUnit.MILLISECONDS),
            "saveCards 必须等待 updateCards 完成（同一把实例锁串行化）",
        )
        release.countDown()
        assertTrue(updateDone.await(5, java.util.concurrent.TimeUnit.SECONDS))
        assertTrue(appWriteDone.await(5, java.util.concurrent.TimeUnit.SECONDS))
        assertTrue(storage.loadCards().first { it.id == "app-x" }.isFavorite)
    }

    private fun cardsFile(): File = File(baseDir, "cards.json")
}
