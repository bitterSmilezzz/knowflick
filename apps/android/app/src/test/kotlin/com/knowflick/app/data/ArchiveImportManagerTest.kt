package com.knowflick.app.data

import android.content.Context
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.CardStore
import com.knowflick.app.domain.KnowledgeCard
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@Config(sdk = [35])
@RunWith(RobolectricTestRunner::class)
class ArchiveImportManagerTest {

    private val context: Context get() = ApplicationProvider.getApplicationContext()

    private val sampleCards = listOf(
        KnowledgeCard.create(
            category = "认知心理",
            headline = "确认偏差",
            summary = "人们倾向于寻找能支持自己先入之见的信息。",
            details = "详细分析确认偏差在决策中的影响与应对方式。",
            source = CardSource.SEED,
        ).copy(id = "CARD_CONFIRM", isFavorite = true, seenAt = 1700000000000L),
        KnowledgeCard.create(
            category = "经济金融",
            headline = "沉没成本",
            summary = "过去的支出不应影响未来的理性抉择。",
            details = "理性经济人不应让覆水难收的沉没成本绑架决策。",
            source = CardSource.AI,
        ).copy(id = "CARD_SUNK", isFavorite = false, seenAt = null),
    )

    @Test
    fun testInspectAndRestoreZipArchive() {
        // 1. 生成并写入一个真实 ZIP 备份包
        val zipBytes = CardArchiveEngine.buildFullBackupZip(
            cards = sampleCards,
            settingsJson = "{\"baseURL\":\"test_url\"}",
        )
        val tempZip = File(context.cacheDir, "test_backup.zip")
        tempZip.writeBytes(zipBytes)

        val uri = Uri.fromFile(tempZip)

        // 2. 探测归档
        val previewResult = ArchiveImportManager.inspectArchive(context, uri)
        assertTrue(previewResult.isSuccess)

        val preview = previewResult.getOrThrow()
        assertTrue(preview.isZipArchive)
        assertEquals(2, preview.totalCards)
        assertEquals(1, preview.readCards)
        assertEquals(1, preview.favoritedCards)
        assertEquals(1, preview.sourcesSummary[CardSource.SEED])
        assertEquals(1, preview.sourcesSummary[CardSource.AI])
        assertNotNull(preview.settingsJson)
        assertTrue(preview.settingsJson!!.contains("test_url"))

        // 3. 测试 MERGE 恢复策略
        val store = CardStore(seedCards = emptyList())
        val restoreResult = ArchiveImportManager.applyRestore(store, preview, RestoreStrategy.MERGE)
        assertEquals(2, restoreResult.added)
        assertEquals(2, store.cards.size)

        // 4. 测试再次增量恢复（去重与进度合并）
        val secondRestoreResult = ArchiveImportManager.applyRestore(store, preview, RestoreStrategy.MERGE)
        assertEquals(0, secondRestoreResult.added)
        assertEquals(2, secondRestoreResult.restored)
        assertEquals(2, store.cards.size)

        // 5. 测试 OVERWRITE 覆盖策略
        val overwriteResult = ArchiveImportManager.applyRestore(store, preview, RestoreStrategy.OVERWRITE)
        assertEquals(2, overwriteResult.added)
        assertEquals(2, store.cards.size)

        tempZip.delete()
    }

    @Test
    fun testInspectAndRestoreJsonArchive() {
        // 1. 生成并写入 JSON 镜像
        val jsonBytes = CardArchiveEngine.buildJsonArchive(sampleCards)
        val tempJson = File(context.cacheDir, "test_cards.json")
        tempJson.writeBytes(jsonBytes)

        val uri = Uri.fromFile(tempJson)

        // 2. 探测归档
        val previewResult = ArchiveImportManager.inspectArchive(context, uri)
        assertTrue(previewResult.isSuccess)

        val preview = previewResult.getOrThrow()
        assertEquals(false, preview.isZipArchive)
        assertEquals(2, preview.totalCards)
        assertEquals(2, preview.parsedCards.size)

        // 3. 应用恢复
        val store = CardStore(seedCards = emptyList())
        val res = ArchiveImportManager.applyRestore(store, preview, RestoreStrategy.MERGE)
        assertEquals(2, res.added)
        assertEquals(2, store.cards.size)

        tempJson.delete()
    }
}
