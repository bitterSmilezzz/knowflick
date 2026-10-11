package com.knowflick.desktop

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.runComposeUiTest
import com.knowflick.app.data.AppModel
import com.knowflick.app.data.CardStorage
import com.knowflick.app.ui.KnowFlickTheme
import com.knowflick.app.ui.PaperTheme
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class DesktopSkeletonTest {

    private fun tempModel(prefix: String): Pair<AppModel, java.io.File> {
        val dir = Files.createTempDirectory(prefix).toFile()
        return AppModel(CardStorage(dir)).apply { bootstrap() } to dir
    }

    /** 领域层复用：卡库状态机 / JSON 往返 / 学科聚合在桌面 JVM 上跑通。 */
    @Test
    fun sharedDomainRunsOnDesktopJvm() {
        val line = DomainBridge.smokeLine()
        assertTrue(line.contains("卡库 2 张"), line)
        assertTrue(line.contains("JSON 往返 OK"), line)
    }

    /** 持久化层复用：写进临时目录 → 用共享 `CardStorage` 读回 → 灌进卡库状态机。 */
    @Test
    fun cardsRoundTripThroughSharedStorage() {
        val (_, dir) = tempModel("kf-desktop-test")
        CardStorage(dir).saveCards(DomainBridge.sampleCards())

        val model = AppModel(CardStorage(dir)).apply { bootstrap() }
        assertEquals(2, model.store.cards.size)
        assertEquals(1, model.store.cards.count { it.isFavorite })
        assertEquals(1, model.store.cards.count { it.seenAt != null })
    }

    /**
     * **桌面端现在能导入归档了**：JSON 镜像字节 → 共享 `ArchiveImportManager` 探测 →
     * 按 MERGE 合并进卡库 → 落盘。这里绕开原生对话框直接喂字节（对话框那层只有「取字节」），
     * 所以能在无头环境断言。
     */
    @Test
    fun importsArchiveBytesAndPersists() {
        val (model, dir) = tempModel("kf-desktop-import")
        val archive = DesktopArchiveActions.exportJson(DomainBridge.sampleCards())

        val result = DesktopArchiveActions.importBytes(model, "knowflick-cards.json", archive.toByteArray())

        assertTrue(result.isSuccess, result.exceptionOrNull()?.message)
        assertEquals(2, model.store.cards.size)
        // 落盘确实生效：换一个实例重新读，数据还在
        assertEquals(2, AppModel(CardStorage(dir)).apply { bootstrap() }.store.cards.size)
    }

    /** 非法内容要给出失败而不是崩：与 Android 端共用同一份引擎的失败语义。 */
    @Test
    fun rejectsNonArchiveBytes() {
        val (model, _) = tempModel("kf-desktop-bad-import")

        val result = DesktopArchiveActions.importBytes(model, "notes.txt", "这不是归档".toByteArray())

        assertTrue(result.isFailure)
        assertEquals(0, model.store.cards.size)
    }

    /** 导出走的是与 Android 端同一份 `CardExportEngine`；且导出的镜像能原样再导入（往返）。 */
    @Test
    fun exportsThroughSharedEngine() {
        val cards = DomainBridge.sampleCards()
        val markdown = DesktopArchiveActions.exportMarkdown(cards, "标题")
        assertTrue(markdown.contains("桌面宿主已接上共享领域层"), markdown.take(200))

        val json = DesktopArchiveActions.exportJson(cards)
        val reparsed = com.knowflick.app.data.CardFileIO.decodeListSalvaging(json)
        assertEquals(cards.size, reparsed.size)
        assertEquals(cards.map { it.id }, reparsed.map { it.id })
    }

    /** 端到端：共享存储 → 共享状态机 → **共享整屏**，离屏渲染。 */
    @OptIn(ExperimentalTestApi::class)
    @Test
    fun rendersLibraryLoadedFromSharedStorage() = runComposeUiTest {
        val (model, _) = tempModel("kf-desktop-ui-test")
        model.storage.saveCards(DomainBridge.sampleCards())
        model.bootstrap()

        setContent { KnowFlickTheme(paperTheme = PaperTheme.RICE_PAPER) { DesktopHost(DesktopHostState(model)) } }
        onNodeWithText("收藏 1").assertExists()
        onNodeWithText("历史 1").assertExists()
    }

    /**
     * 导入后**界面跟着更新**：状态容器把 version +1，宿主据此重读卡库。
     * 这条用例钉住的就是「导入完看不到卡片」这类最容易漏的接线。
     */
    @OptIn(ExperimentalTestApi::class)
    @Test
    fun importedCardsAppearInLibraryScreen() = runComposeUiTest {
        val (model, _) = tempModel("kf-desktop-ui-import")
        val state = DesktopHostState(model)

        setContent { KnowFlickTheme(paperTheme = PaperTheme.RICE_PAPER) { DesktopHost(state) } }
        onNodeWithText("收藏 0").assertExists()

        state.importBytes(
            fileName = "knowflick-cards.json",
            bytes = DesktopArchiveActions.exportJson(DomainBridge.sampleCards()).toByteArray(),
        )

        onNodeWithText("收藏 1").assertExists()
        onNodeWithText("桌面宿主已接上共享领域层").assertExists()
    }
}
