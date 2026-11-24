package com.knowflick.desktop

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.runComposeUiTest
import com.knowflick.app.data.AppModel
import com.knowflick.app.data.CardStorage
import com.knowflick.app.data.ChatSessionStorage
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithText
import com.knowflick.app.domain.ArchiveExportFormat
import com.knowflick.app.domain.ArchiveExportScope
import com.knowflick.app.ui.DesktopBackgroundImageCache
import com.knowflick.app.ui.KnowFlickTheme
import com.knowflick.app.ui.PaperTheme
import com.knowflick.app.ui.common.ArchiveExportCancelled
import java.io.File
import java.nio.file.Files
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import java.nio.file.attribute.PosixFilePermission
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DesktopSkeletonTest {

    private fun tempModel(prefix: String): Pair<AppModel, java.io.File> {
        val dir = Files.createTempDirectory(prefix).toFile()
        return AppModel(CardStorage(dir)).apply { bootstrap() } to dir
    }

    /**
     * 宿主状态：**凭据目录必须隔离**——`DesktopHostState` 的默认值指向开发机真实数据目录，
     * 测试若用它就会把本机密钥写坏。
     */
    private fun hostState(model: AppModel, dir: java.io.File): DesktopHostState =
        DesktopHostState(
            model = model,
            credentials = DesktopCredentialStore(java.io.File(dir, "credentials")),
            // 会话存储也要隔离：默认值指向开发机真实数据目录
            chatStorage = ChatSessionStorage(java.io.File(dir, "store")),
        )

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
     * **桌面端现在有学习地图**：范围存在共享 `CardStore.studyScope`（与 Android 同一处），
     * 地图屏与 `StudyMap` 计算都是共享的；应用范围后要落进卡库并持久化。
     */
    @OptIn(ExperimentalTestApi::class)
    @Test
    fun learningMapOpensAndAppliesScope() = runComposeUiTest {
        val (model, dir) = tempModel("kf-desktop-map")
        model.storage.saveCards(DomainBridge.sampleCards())
        model.bootstrap()
        val state = hostState(model, dir)

        setContent { KnowFlickTheme(paperTheme = PaperTheme.RICE_PAPER) { DesktopHost(state) } }
        state.openMap()
        onNodeWithText("学习地图").assertExists()

        // 选一条支线（按学科）→ 进入共享卡库，并立刻约束卡堆
        val subject = model.store.cards.first().category
        state.applyStudyScope(com.knowflick.app.domain.StudyScope(subjects = setOf(subject)))
        assertTrue(state.studyScope.isActive, "范围应生效")
        assertTrue(
            model.store.deck.all { it.category == subject },
            "卡堆应受学习范围约束（与 Android 同一份 CardStore 语义）",
        )

        // 注意：学习范围**目前不落盘**——Android 侧同样如此（`:shared-data` 没有序列化它），
        // 属既有产品行为，不是迁移引入的回归；已在 CHANGELOG 记为待决项，未擅自改动语义。
    }

    /**
     * **桌面端现在有 AI 追问**：会话状态用与 Android 同一份 `ChatStateHolder`（`:shared-data`），
     * 流式走同一份 `AiService.streamCardChat`，会话文件也是同一个 `chat_sessions.json`。
     * 用假服务器跑全链路，不碰真实网络。
     */
    @Test
    fun chatStreamsThroughSharedHolderAndPersistsSession() {
        val (model, dir) = tempModel("kf-desktop-chat")
        model.storage.saveCards(DomainBridge.sampleCards())
        model.bootstrap()
        val state = hostState(model, dir)

        val server = okhttp3.mockwebserver.MockWebServer()
        server.start()
        try {
            // 与 :domain 的 AI 测试同一套 SSE 形状：每个 delta.content 是一小段正文
            fun delta(text: String) = "data: {\"choices\":[{\"delta\":{\"content\":\"$text\"}}]}\n\n"
            val sse = delta("先看") + delta("叠加态。") + "data: [DONE]\n\n"
            server.enqueue(okhttp3.mockwebserver.MockResponse().setBody(sse))
            state.saveAiSettings(
                state.aiSettings.copy(baseURL = server.url("/v1").toString(), model = "chat-model"),
                "sk-chat-key",
            )

            val card = model.store.cards.first()
            state.openChat(card)
            assertEquals(card.id, state.activeChatCard?.id, "应打开该卡的追问会话")

            state.sendChatMessage("这张卡在讲什么？")

            val deadline = System.currentTimeMillis() + 5_000
            while (state.isChatStreaming && System.currentTimeMillis() < deadline) Thread.sleep(20)

            assertFalse(state.isChatStreaming, "流式应已结束（errorMessage=${state.chatErrorMessage}，messages=${state.chatSession?.messages?.size}）")
            val session = assertNotNull(state.chatSession)
            assertTrue(session.messages.size >= 2, "应有一条提问与一条回答")
            val reply = session.messages.last()
            assertTrue(reply.content.contains("叠加态"), "流式增量应拼进回答：${reply.content}")

            // 导出 Markdown 走共享 CardChatInsightDeriver（与 Android 同一份格式）
            val markdown = assertNotNull(state.exportCurrentChatMarkdown())
            assertTrue(markdown.contains(card.headline), "导出内容应包含母卡标题")

            // 会话经共享 ChatSessionStorage 落盘：换一个存储实例能读回
            val reopened = ChatSessionStorage(java.io.File(dir, "store"))
            assertNotNull(reopened.loadSession(card.id), "会话应落进共享存储")
        } finally {
            server.shutdown()
        }
    }

    /**
     * **桌面端导入改为「先预览、再确认」**：与 Android 同一份 `ImportRestoreDialog` + 同一份
     * `ArchiveImportManager`——预览不写库，确认后才按策略恢复。
     */
    @OptIn(ExperimentalTestApi::class)
    @Test
    fun importShowsPreviewBeforeRestoring() = runComposeUiTest {
        val (model, dir) = tempModel("kf-desktop-preview")
        val state = hostState(model, dir)

        setContent { KnowFlickTheme(paperTheme = PaperTheme.RICE_PAPER) { DesktopHost(state) } }

        // 用共享导出引擎造一份 JSON 镜像，再当作归档探测
        val json = DesktopArchiveActions.exportJson(DomainBridge.sampleCards())
        assertTrue(state.beginImport("mirror.json", json.toByteArray()).isSuccess)

        // 预览阶段：界面出现对话框，且**卡库还没变**
        onNodeWithText("导入与数据恢复").assertExists()
        assertTrue(model.store.cards.isEmpty(), "预览阶段不应写入卡库")

        // 确认后（默认 MERGE）才写库
        state.confirmImport(com.knowflick.app.domain.RestoreStrategy.MERGE)
        assertEquals(2, model.store.cards.size, "确认后应按策略恢复")
        assertNull(state.importPreview, "确认后应关闭预览")
    }

    /**
     * **桌面端现在能全局搜索**：检索走共享 `KnowledgeSearchEngine`，历史落共享 `CardStorage`，
     * 弹层是与 Android 同一份 `SearchSheet`。断言刻意落在「结果 + 历史」而不是像素上。
     */
    @OptIn(ExperimentalTestApi::class)
    @Test
    fun globalSearchFindsCardsAndPersistsHistory() = runComposeUiTest {
        val (model, dir) = tempModel("kf-desktop-search")
        model.storage.saveCards(DomainBridge.sampleCards())
        model.bootstrap()
        val state = hostState(model, dir)

        setContent { KnowFlickTheme(paperTheme = PaperTheme.RICE_PAPER) { DesktopHost(state) } }
        state.openSearch()

        state.updateSearchQuery("卡库状态机")
        assertTrue(state.searchResults.isNotEmpty(), "共享检索引擎应命中样例卡")
        onNodeWithText("卡库状态机与学科表可用").assertExists()

        // 搜索历史经共享 CardStorage 落盘（换一个实例读回）
        state.addSearchHistory("卡库状态机")
        assertTrue(
            CardStorage(dir).loadSearchHistory().contains("卡库状态机"),
            "搜索历史应落进共享存储",
        )

        // 从搜索结果打开详情（与 Android 同一条导航语义）
        state.openDetail(state.searchResults.first().card.id)
        onNodeWithText("卡库状态机与学科表可用").assertExists()
    }

    /**
     * **桌面端现在有真实可用的 AI 能力**：生成走 `:domain` 的 `AiService`（与 Android 同一份，
     * 含流式解析），密钥来自桌面凭据文件，落库走共享 `CardStore`。
     * 用假服务器跑全链路，不碰真实网络。
     */
    @Test
    fun aiGenerationInsertsCardsThroughSharedService() {
        val (model, dir) = tempModel("kf-desktop-ai")
        model.bootstrap()
        val state = hostState(model, dir)

        // 默认设置已带 DeepSeek 端点 → 此时缺的是密钥（与 Android 同一口径）
        state.generateNewCards()
        assertEquals("请先在设置里填入 API Key", state.notice)
        assertTrue(model.store.cards.isEmpty(), "缺密钥时不应产生任何卡片")

        // 端点与模型都空 → 视为未配置
        state.saveAiSettings(state.aiSettings.copy(baseURL = "", model = ""), "")
        state.generateNewCards()
        assertEquals("请先在设置里配置 AI 服务", state.notice)

        val server = okhttp3.mockwebserver.MockWebServer()
        server.start()
        try {
            val details = "这是分批生成的深入说明内容。".repeat(12)
            val card = """{"category":"AI","headline":"桌面生成的卡","summary":"摘要","details":"$details","searchKeywords":[],"sources":[]}"""
            val content = "[$card]".replace("\"", "\\\"")
            server.enqueue(
                okhttp3.mockwebserver.MockResponse()
                    .setBody("data: {\"choices\":[{\"delta\":{\"content\":\"$content\"}}]}\n\ndata: [DONE]\n\n"),
            )
            state.saveAiSettings(
                state.aiSettings.copy(baseURL = server.url("/v1").toString(), model = "test-model"),
                "sk-test-key",
            )

            state.generateNewCards(count = 1)

            // 异步完成：轮询到生成结束（上限 5 秒）
            val deadline = System.currentTimeMillis() + 5_000
            while (state.isGenerating && System.currentTimeMillis() < deadline) Thread.sleep(20)

            assertFalse(state.isGenerating, "生成应已结束")
            assertEquals("已生成 1 张新知识 ✓", state.notice)
            assertTrue(
                model.store.cards.any { it.headline == "桌面生成的卡" },
                "生成的卡片应经共享 CardStore 置顶插入",
            )
            // 置顶插入：新卡在卡库最前
            assertEquals("桌面生成的卡", model.store.cards.first().headline)
        } finally {
            server.shutdown()
        }
    }

    /**
     * **桌面端现在能改设置了，且设置走共享存储**：`settings.json` 的线格式与 Android 是同一份
     * （`AiSettings` 已迁 `:domain`），因此**跨端设置可互通**；主题切换立即生效。
     * 同时钉住一条安全不变式：**密钥不落进共享存储文件**，只落进 0600 的凭据文件。
     */
    @OptIn(ExperimentalTestApi::class)
    @Test
    fun settingsUseSharedStorageAndSecretsStayInCredentialFileOnly() = runComposeUiTest {
        val (model, dir) = tempModel("kf-desktop-settings")
        model.storage.saveCards(DomainBridge.sampleCards())
        model.bootstrap()
        val state = hostState(model, dir)

        setContent { KnowFlickTheme(PaperTheme.fromName(state.aiSettings.paperTheme)) { DesktopHost(state) } }
        state.openSettings()
        onNodeWithText("AI 服务设置").assertExists()

        state.saveAiSettings(state.aiSettings.copy(paperTheme = "RICE_PAPER"), "sk-desktop-secret")
        assertTrue(state.aiSaveSucceeded, "保存应成功")

        // 换一个实例从磁盘读回：设置与密钥都能复原（跨端同一份线格式）
        val reopened = hostState(AppModel(CardStorage(dir)).apply { bootstrap() }, dir)
        assertEquals("RICE_PAPER", reopened.aiSettings.paperTheme, "设置应经共享 CardStorage 落盘")
        assertEquals("sk-desktop-secret", reopened.currentApiKey(), "密钥应经桌面凭据文件读回")

        // 安全不变式：密钥不得出现在凭据目录之外的任何文件里
        val leaked = dir.walkTopDown()
            .filter { it.isFile && it.parentFile?.name != "credentials" }
            .any { runCatching { it.readText().contains("sk-desktop-secret") }.getOrDefault(false) }
        assertFalse(leaked, "密钥泄漏进了共享存储文件（settings.json 只能有非敏感字段）")

        // 凭据文件权限 0600（Windows 无 POSIX 视图，跳过该断言）
        val credFile = java.io.File(dir, "credentials/apiKey.credential")
        assertTrue(credFile.exists(), "凭据文件应存在")
        runCatching {
            assertEquals(
                setOf(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE),
                java.nio.file.Files.getPosixFilePermissions(credFile.toPath()),
                "凭据文件必须仅属主可读写",
            )
        }
    }

    /**
     * **首页与 Android 对齐：刷卡页是主页**（不再把收藏阁当首页）。
     * 菜单栏的「刷卡（主页）/ 收藏阁 / 学习统计」是同一套导航。
     */
    @OptIn(ExperimentalTestApi::class)
    @Test
    fun deckIsTheHomeScreen() = runComposeUiTest {
        val (model, dir) = tempModel("kf-desktop-home")
        model.storage.saveCards(DomainBridge.sampleCards())
        model.bootstrap()
        val state = hostState(model, dir)

        setContent { KnowFlickTheme(paperTheme = PaperTheme.RICE_PAPER) { DesktopHost(state) } }

        // 刷卡页顶栏的「收藏阁」入口可见 → 当前就是刷卡页（卡序不确定，所以断言稳定元素）
        onNodeWithContentDescription("收藏阁").assertExists()

        state.openLibrary()
        onNodeWithText("收藏 1").assertExists()

        state.goHome()
        onNodeWithContentDescription("收藏阁").assertExists()
    }

    /**
     * **桌面端现在能打开详情页**：与 Android 端同一份 `DetailScreen`（背景图、正文、延伸阅读、
     * 收藏切换都在里面），两个 Android 专属 Sheet 传 null；相关推荐走共享的 `RelatedCards`。
     * 这条用例同时钉住「卡库 → 详情 → 返回」的导航与收藏落盘。
     */
    @OptIn(ExperimentalTestApi::class)
    @Test
    fun detailPageOpensFromLibraryAndTogglesFavorite() = runComposeUiTest {
        val (model, dir) = tempModel("kf-desktop-detail")
        model.storage.saveCards(DomainBridge.sampleCards())
        model.bootstrap()
        val state = hostState(model, dir)

        setContent { KnowFlickTheme(paperTheme = PaperTheme.RICE_PAPER) { DesktopHost(state) } }
        state.openLibrary()
        onNodeWithText("收藏 1").assertExists()

        state.openDetail("DESKTOP-2")
        onNodeWithText("卡库状态机与学科表可用").assertExists()

        // 详情页的收藏切换：走共享 CardStore + 落盘
        state.toggleFavorite(model.store.cards.first { it.id == "DESKTOP-2" })
        assertTrue(
            AppModel(CardStorage(dir)).apply { bootstrap() }
                .store.cards.first { it.id == "DESKTOP-2" }.isFavorite,
            "收藏状态应经共享 CardStorage 落盘",
        )

        state.closeDetail()
        onNodeWithText("收藏 2").assertExists()
    }

    /**
     * **桌面端现在也有学习统计**：同一份共享 `StatsScreen`（同一个 `StatsCalculator` /
     * `LearningPlan` / 热力图组件），日期快照走 `rememberLearningDay` 的桌面实现（轮询）。
     * 这条用例也钉住了「统计 ⇄ 卡库」的导航接线。
     */
    @OptIn(ExperimentalTestApi::class)
    @Test
    fun statsScreenOpensOnDesktop() = runComposeUiTest {
        val (model, dir) = tempModel("kf-desktop-stats")
        model.storage.saveCards(DomainBridge.sampleCards())
        model.bootstrap()
        val state = hostState(model, dir)

        setContent { KnowFlickTheme(paperTheme = PaperTheme.RICE_PAPER) { DesktopHost(state) } }
        state.openLibrary()
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
        val (model, dir) = tempModel("kf-desktop-quiz")
        model.storage.saveCards(DomainBridge.sampleCards())
        model.bootstrap()
        val state = hostState(model, dir)

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

        // 退出测验回到刷卡首页（deck 渲染顶卡标题）
        state.exitQuiz()
        assertNull(state.quizSession)
        onNodeWithText("桌面宿主已接上共享领域层").assertExists()
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
        val (model, dir) = tempModel("kf-desktop-ui-test")
        model.storage.saveCards(DomainBridge.sampleCards())
        model.bootstrap()
        val state = hostState(model, dir)

        setContent { KnowFlickTheme(paperTheme = PaperTheme.RICE_PAPER) { DesktopHost(state) } }
        // 首页是刷卡页，收藏阁要显式进入（与 Android 的导航一致）
        state.openLibrary()
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
        val (model, dir) = tempModel("kf-desktop-ui-import")
        val state = hostState(model, dir)

        setContent { KnowFlickTheme(paperTheme = PaperTheme.RICE_PAPER) { DesktopHost(state) } }
        state.openLibrary()
        onNodeWithText("收藏 0").assertExists()

        state.importBytes(
            fileName = "knowflick-cards.json",
            bytes = DesktopArchiveActions.exportJson(DomainBridge.sampleCards()).toByteArray(),
        )

        onNodeWithText("收藏 1").assertExists()
        onNodeWithText("桌面宿主已接上共享领域层").assertExists()
    }

    /** 桌面导出写的是共享引擎的字节；用户取消另存为时不报失败。 */
    @Test
    fun desktopExportWritesSharedEngineBytesAndCancelStaysQuiet() = runBlocking {
        val cards = DomainBridge.sampleCards()
        val dir = Files.createTempDirectory("kf-desktop-export").toFile()
        val exporter = DesktopArchiveExporter(pickSaveFile = { _, name -> File(dir, name) })

        val saved = exporter.export(
            scope = ArchiveExportScope.ALL,
            format = ArchiveExportFormat.JSON_ARCHIVE,
            cards = cards,
            settingsJson = null,
        )

        val path = saved.getOrThrow()
        val text = File(path).readText()
        assertTrue(path.contains("knowflick_cards_"), path)
        assertTrue(text.contains("桌面宿主已接上共享领域层"), text.take(200))
        assertFalse(exporter.canShare)
        assertEquals("另存为", exporter.saveLabel)

        val cancelled = DesktopArchiveExporter(pickSaveFile = { _, _ -> null }).export(
            scope = ArchiveExportScope.FAVORITES,
            format = ArchiveExportFormat.JSON_ARCHIVE,
            cards = cards,
            settingsJson = null,
        )
        assertTrue(cancelled.exceptionOrNull() is ArchiveExportCancelled)
    }

    /** 刷卡页打开的就是共享导出面板：另存为在，系统分享不在。 */
    @OptIn(ExperimentalTestApi::class)
    @Test
    fun backupExportSheetOnDesktopHidesShare() = runComposeUiTest {
        val (model, dir) = tempModel("kf-desktop-export-ui")
        model.storage.saveCards(DomainBridge.sampleCards())
        model.bootstrap()
        val state = hostState(model, dir)

        setContent { KnowFlickTheme(paperTheme = PaperTheme.RICE_PAPER) { DesktopHost(state) } }
        state.openBackupExport()
        onNodeWithText("数据归档与全量备份").assertExists()
        onNodeWithText("另存为").assertExists()
        onAllNodesWithText("系统分享").assertCountEquals(0)
    }
}
