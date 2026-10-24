package com.knowflick.app.ui

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.runComposeUiTest
import com.knowflick.app.domain.WebClipDigest
import com.knowflick.app.data.CategoryStampColor
import com.knowflick.app.domain.ArchiveExportFormat
import com.knowflick.app.domain.ArchiveExportScope
import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.ui.common.ArchiveExporter
import com.knowflick.app.ui.common.LocalArchiveExporter
import com.knowflick.app.ui.common.MarkdownText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/**
 * 迁移进共享模块的真实界面，在**非 Android 的 JVM 宿主**上离屏渲染。
 *
 * 这些用例的价值不在断言本身，而在于：它们能在没有 Android 运行时的机器上跑绿——
 * 这正是「一份界面代码跑四端」的可验证形式。加新界面进 :shared-ui 时，
 * 都在这里补一条渲染用例。
 */
class MigratedScreensTest {

    private fun favoriteCard(headline: String) = KnowledgeCard(
        id = "SHARED-$headline",
        category = "计算机与 AI",
        headline = headline,
        summary = "共享界面在桌面 JVM 上渲染",
        details = "正文",
        links = emptyList(),
        source = CardSource.AI,
        createdAt = 1_700_000_000_000L,
        isFavorite = true,
        favoritedAt = 1_700_000_500_000L,
    )

    /** 分类印章色是随界面一起迁进来的（原来在 app 的 data 包），四领域色温仍要对得上。 */
    @Test
    fun categoryStampColorStillCoversFourDomains() {
        val cs = CategoryStampColor.forCategory("计算机与 AI")
        val biz = CategoryStampColor.forCategory("中级会计")
        val sci = CategoryStampColor.forCategory("天体物理")
        val other = CategoryStampColor.forCategory("未分类的内容")
        assertNotEquals(cs, biz)
        assertNotEquals(cs, sci)
        assertNotEquals(sci, other)
    }

    /** LibraryScreen（323 行，原 app 模块）在桌面渲染：标签计数与卡片标题都来自真实数据。 */
    @OptIn(ExperimentalTestApi::class)
    @Test
    fun libraryScreenRendersOnDesktop() = runComposeUiTest {
        setContent {
            KnowFlickTheme(paperTheme = PaperTheme.RICE_PAPER) {
                LibraryScreen(
                    cards = listOf(favoriteCard("跨端共享的收藏卡")),
                    version = 7,
                    onOpenDetail = {},
                    onBack = {},
                    onShareFavorites = {},
                    onShareArchive = {},
                    onPickImportFile = {},
                )
            }
        }
        onNodeWithText("收藏 1").assertExists()
        onNodeWithText("历史 0").assertExists()
    }

    /** MarkdownTextRenderer（298 行）在桌面渲染出行内样式文本。 */
    @OptIn(ExperimentalTestApi::class)
    @Test
    fun markdownRendererRendersOnDesktop() = runComposeUiTest {
        setContent {
            KnowFlickTheme(paperTheme = PaperTheme.RICE_PAPER) {
                MarkdownText(markdown = "**加粗**与正文")
            }
        }
        // 渲染成文本节点即可——重点是这条路径在桌面 JVM 上不炸
        onNodeWithText("加粗", substring = true).assertExists()
    }

    /** 桌面没有系统分享：保存按钮用宿主文案，分享入口不出现。 */
    @OptIn(ExperimentalTestApi::class)
    @Test
    fun backupExportSheetHidesShareWhenHostCannotShare() = runComposeUiTest {
        val exporter = object : ArchiveExporter {
            override val canShare: Boolean = false
            override val saveLabel: String = "另存为"
            override suspend fun export(
                scope: ArchiveExportScope,
                format: ArchiveExportFormat,
                cards: List<KnowledgeCard>,
                settingsJson: String?,
            ): Result<String> = Result.success("unused")
        }
        setContent {
            KnowFlickTheme(paperTheme = PaperTheme.RICE_PAPER) {
                CompositionLocalProvider(LocalArchiveExporter provides exporter) {
                    BackupExportSheet(
                        allCards = listOf(favoriteCard("导出用卡")),
                        favoriteCards = emptyList(),
                        historyCards = emptyList(),
                        onClose = {},
                    )
                }
            }
        }
        onNodeWithText("另存为").assertExists()
        onAllNodesWithText("系统分享").assertCountEquals(0)
        onNodeWithText("数据归档与全量备份").assertExists()
    }

    /** Android 有系统分享：两个动作都在。 */
    @OptIn(ExperimentalTestApi::class)
    @Test
    fun backupExportSheetShowsShareWhenHostCanShare() = runComposeUiTest {
        val exporter = object : ArchiveExporter {
            override val canShare: Boolean = true
            override val saveLabel: String = "保存至下载目录"
            override suspend fun export(
                scope: ArchiveExportScope,
                format: ArchiveExportFormat,
                cards: List<KnowledgeCard>,
                settingsJson: String?,
            ): Result<String> = Result.success("unused")
        }
        setContent {
            KnowFlickTheme(paperTheme = PaperTheme.RICE_PAPER) {
                CompositionLocalProvider(LocalArchiveExporter provides exporter) {
                    BackupExportSheet(
                        allCards = listOf(favoriteCard("导出用卡")),
                        favoriteCards = emptyList(),
                        historyCards = emptyList(),
                        onClose = {},
                    )
                }
            }
        }
        onNodeWithText("保存至下载目录").assertExists()
        onNodeWithText("系统分享").assertExists()
    }

    /**
     * 剪藏按 mac 三步走：预览正文之后还要挑卡片、再确认，才写库。
     * 抓取和提炼都是假的，用来钉住「提炼」本身不会入库。
     */
    @OptIn(ExperimentalTestApi::class)
    @Test
    fun clipSheetImportsOnlyAfterCardSelection() = runComposeUiTest {
        val card = favoriteCard("从网页提炼的卡")
        var imported: List<KnowledgeCard>? = null
        var pinned: Boolean? = null
        setContent {
            KnowFlickTheme(paperTheme = PaperTheme.RICE_PAPER) {
                ClipSheet(
                    aiConfigured = true,
                    onFetch = {
                        WebClipDigest(
                            sourceURL = "https://example.com/post",
                            pageURL = "https://example.com/post",
                            title = "示例页",
                            siteName = "Example",
                            description = "",
                            text = "示例正文",
                            truncated = false,
                        )
                    },
                    onTransform = { listOf(card) },
                    onImport = { cards, insertAtTop ->
                        imported = cards
                        pinned = insertAtTop
                        "导入完成：新增 ${cards.size} 张，跳过重复卡 0 张。"
                    },
                    onClose = {},
                )
            }
        }
        onNodeWithText("网页链接").performTextInput("https://example.com/post")
        onNodeWithText("抓取并预览正文").performClick()
        onNodeWithText("示例正文").assertExists()
        onAllNodesWithText("确认导入（1 张）").assertCountEquals(0)
        onNodeWithText("AI 提炼成卡片").performClick()
        onNodeWithText("从网页提炼的卡").assertExists()
        onNodeWithText("确认导入（1 张）").performClick()
        onNodeWithText("导入完成：新增 1 张，跳过重复卡 0 张。").assertExists()
        assertEquals(listOf(card.id), imported?.map { it.id })
        assertEquals(true, pinned)
    }

    @OptIn(ExperimentalTestApi::class)
    @Test
    fun notesImportAndHelpSheetsRender() = runComposeUiTest {
        setContent {
            KnowFlickTheme(paperTheme = PaperTheme.RICE_PAPER) {
                NotesImportSheet(
                    aiConfigured = false,
                    existingCards = emptyList(),
                    onParseRules = { _, _ -> emptyList() },
                    onTransform = { emptyList() },
                    onImport = { _, _ -> "ok" },
                    onPickFile = {},
                    onClose = {},
                )
            }
        }
        onNodeWithText("导入笔记").assertExists()
        onNodeWithText("解析笔记").assertExists()
        setContent {
            KnowFlickTheme(paperTheme = PaperTheme.RICE_PAPER) {
                HelpSheet(onClose = {})
            }
        }
        onNodeWithText("快捷键").assertExists()
        onNodeWithText("导入笔记为卡片…").assertExists()
    }

    /** AppIcons（669 行手写矢量图标）在桌面可解析为 ImageVector。 */
    @Test
    fun appIconsResolveOffAndroid() {
        assertTrue(AppIcons.Bookmarks.defaultWidth.value > 0f)
        assertTrue(AppIcons.AiChip.defaultHeight.value > 0f)
    }
}
