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
     * 离屏组合：证明桌面宿主**真的能渲染共享界面**，而不只是「编译得过」。
     * 这里渲染的是 :shared-ui 里的 LibraryScreen——与 Android 端同一份 Compose 代码；
     * 断言用的「收藏 N / 历史 N」标签与卡片数据都来自真实组件与领域模型。
     * headless 由 build.gradle.kts 的测试系统属性保证。
     */
    @OptIn(ExperimentalTestApi::class)
    @Test
    fun rendersSharedLibraryScreenHeadless() = runComposeUiTest {
        setContent { KnowFlickTheme(paperTheme = PaperTheme.RICE_PAPER) { DesktopHost() } }
        onNodeWithText("收藏 1").assertExists()
        onNodeWithText("历史 1").assertExists()
    }
}
