package com.knowflick.desktop

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.runComposeUiTest
import com.knowflick.app.ui.KnowFlickTheme
import com.knowflick.app.ui.PaperTheme
import kotlin.test.Test
import kotlin.test.assertTrue

class DesktopSkeletonTest {

    /** 领域层复用：卡库状态机 / JSON 往返 / 学科聚合在桌面 JVM 上跑通。 */
    @Test
    fun sharedDomainRunsOnDesktopJvm() {
        val line = DomainBridge.smokeLine()
        assertTrue(line.contains("卡库 2 张"), line)
        assertTrue(line.contains("JSON 往返 OK"), line)
    }

    /**
     * 离屏组合：证明 Compose Multiplatform 运行时在本构建里**真的能渲染**，
     * 而不只是「编译得过」。headless 由 build.gradle.kts 的测试系统属性保证。
     * 这里连**共享界面层**一起验：主题与卡片组件都来自 :shared-ui。
     */
    @OptIn(ExperimentalTestApi::class)
    @Test
    fun rendersSharedUiHeadlessWithoutWindow() = runComposeUiTest {
        setContent { KnowFlickTheme(paperTheme = PaperTheme.RICE_PAPER) { SkeletonScreen() } }
        onNodeWithText("KnowFlick 桌面（骨架）").assertExists()
        // 共享组件渲染出的领域内容（卡片标题来自 :domain 的示例卡）
        onNodeWithText("桌面宿主已接上共享领域层").assertExists()
    }
}
