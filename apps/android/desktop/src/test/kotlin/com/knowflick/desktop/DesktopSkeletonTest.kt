package com.knowflick.desktop

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.runComposeUiTest
import com.knowflick.app.data.AppModel
import com.knowflick.app.data.CardStorage
import com.knowflick.app.ui.DesktopBackgroundImageCache
import com.knowflick.app.ui.KnowFlickTheme
import com.knowflick.app.ui.PaperTheme
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
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

    /**
     * **桌面端现在也有学习统计**：同一份共享 `StatsScreen`（同一个 `StatsCalculator` /
     * `LearningPlan` / 热力图组件），日期快照走 `rememberLearningDay` 的桌面实现（轮询）。
     * 这条用例也钉住了「统计 ⇄ 卡库」的导航接线。
     */
    @OptIn(ExperimentalTestApi::class)
    @Test
    fun statsScreenOpensOnDesktop() = runComposeUiTest {
        val (model, _) = tempModel("kf-desktop-stats")
        model.storage.saveCards(DomainBridge.sampleCards())
        model.bootstrap()
        val state = DesktopHostState(model)

        setContent { KnowFlickTheme(paperTheme = PaperTheme.RICE_PAPER) { DesktopHost(state) } }
        onNodeWithText("收藏 1").assertExists()

        state.openStats()
        onNodeWithText("今日已学/已复习").assertExists()

        state.closeStats()
        onNodeWithText("收藏 1").assertExists()
    }

    /**
     * **桌面端现在有测验能力**：编排来自 `:domain` 的 `QuizCycle`（与 Android 端同一份），
     * 界面来自 `:shared-ui` 的 `QuizScreen`（同一份）。这条用例走完「起一轮 → 评完 → 退出」，
     * 并确认评分真的经 SM-2 落进了卡库。
     */
    @OptIn(ExperimentalTestApi::class)
    @Test
    fun quizRunsOnDesktopThroughSharedCycle() = runComposeUiTest {
        val (model, _) = tempModel("kf-desktop-quiz")
        model.storage.saveCards(DomainBridge.sampleCards())
        model.bootstrap()
        val state = DesktopHostState(model)

        setContent { KnowFlickTheme(paperTheme = PaperTheme.RICE_PAPER) { DesktopHost(state) } }

        state.startQuiz()
        assertNotNull(state.quizSession, "起一轮后应有会话")
        // 共享 QuizScreen 的标题用的是 QuizType.label
        onNodeWithText("知识测验").assertExists()

        // 评完这一轮（每张都评「熟练掌握」）
        var guard = 0
        while (state.quizSession?.isFinished == false && guard++ < 20) {
            state.rateQuiz(com.knowflick.app.domain.QuizRating.MASTERED)
        }
        onNodeWithText("本轮记忆测验已完成").assertExists()

        // 评分经共享 QuizCycle 落到卡库：复习次数与复习时间都被写入
        assertTrue(model.store.cards.all { it.reviewCount > 0 }, "评分应经 SM-2 记进卡库")
        assertTrue(model.store.cards.all { it.lastReviewedAt != null })

        // 退出测验回到卡库界面
        state.exitQuiz()
        assertNull(state.quizSession)
        onNodeWithText("收藏 1").assertExists()
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

    /**
     * 底图接缝在桌面侧真的能解码：资源来自仓库根 `shared/assets`（经 `resources.srcDir` 打进 jar），
     * 由 `:shared-ui` 的 jvm actual 用 Skia 读——这是卡片视觉（刷卡页/详情页/海报）的前提。
     */
    @Test
    fun resolvesBackgroundImageFromBundledSharedAssets() {
        val image = DesktopBackgroundImageCache.image("ai")

        assertNotNull(image, "应从 classpath 的 bg/ai.webp 解出底图")
        assertTrue(image.width > 0 && image.height > 0)
        // 第二次走缓存
        assertNotNull(DesktopBackgroundImageCache.cached("ai"))
        // 不存在的 key 返回 null 而不是抛
        assertNull(DesktopBackgroundImageCache.image("definitely-not-a-key"))
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
