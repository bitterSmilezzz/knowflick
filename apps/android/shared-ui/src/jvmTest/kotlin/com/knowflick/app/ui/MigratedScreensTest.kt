package com.knowflick.app.ui

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.runComposeUiTest
import com.knowflick.app.data.CategoryStampColor
import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.ui.common.MarkdownText
import kotlin.test.Test
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

    /** AppIcons（669 行手写矢量图标）在桌面可解析为 ImageVector。 */
    @Test
    fun appIconsResolveOffAndroid() {
        assertTrue(AppIcons.Bookmarks.defaultWidth.value > 0f)
        assertTrue(AppIcons.AiChip.defaultHeight.value > 0f)
    }
}
