package com.knowflick.app.ui.shared

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.runComposeUiTest
import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.ui.EditorialColor
import com.knowflick.app.ui.KnowFlickTheme
import com.knowflick.app.ui.PaperTheme
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SharedUiSmokeTest {

    private fun card(headline: String = "跨端共享的第一块界面") = KnowledgeCard(
        id = "SHARED-UI-1",
        category = "计算机与 AI",
        headline = headline,
        summary = "同一份 Compose 代码在 Android 与桌面三端渲染",
        details = "",
        links = emptyList(),
        source = CardSource.AI,
        createdAt = 1_700_000_000_000L,
    )

    /** 主题令牌（原 app 模块的 Theme.kt）现在住在共享模块里，且在非 Android 平台可解析。 */
    @Test
    fun themeTokensResolveOffAndroid() {
        assertEquals(Color(0xFF388E69), EditorialColor.likeGreen)
        assertTrue(PaperTheme.fromName("warm_obsidian") == PaperTheme.WARM_OBSIDIAN)
        assertTrue(PaperTheme.fromName("不存在") == PaperTheme.SYSTEM)
    }

    /** 端到端：共享主题 + 共享组件 + 领域数据，离屏组合出真实 UI（不开窗）。 */
    @OptIn(ExperimentalTestApi::class)
    @Test
    fun teaserRendersHeadlessOnDesktopJvm() = runComposeUiTest {
        setContent {
            KnowFlickTheme(paperTheme = PaperTheme.RICE_PAPER) {
                KnowledgeCardTeaser(card())
            }
        }
        onNodeWithText("跨端共享的第一块界面").assertExists()
        onNodeWithText("计算机与 AI").assertExists()
    }
}
