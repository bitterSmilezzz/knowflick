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

    /** 领域层复用：卡库状态机 / JSON 往返 / 学科聚合在桌面 JVM 上跑通。 */
    @Test
    fun sharedDomainRunsOnDesktopJvm() {
        val line = DomainBridge.smokeLine()
        assertTrue(line.contains("卡库 2 张"), line)
        assertTrue(line.contains("JSON 往返 OK"), line)
    }

    /**
     * 持久化层复用：把卡写进临时目录 → 用**共享的** `CardStorage` 读回来 → 经 `AppModel`
     * 灌进卡库状态机。这条路径在 Android 端跑的是同一份代码（`:shared-data`）。
     */
    @Test
    fun cardsRoundTripThroughSharedStorage() {
        val dir = Files.createTempDirectory("kf-desktop-test").toFile()
        CardStorage(dir).saveCards(DomainBridge.sampleCards())

        val model = AppModel(CardStorage(dir)).apply { bootstrap() }
        assertEquals(2, model.store.cards.size)
        // 落盘再读回后，浏览状态（收藏/历史）也要跟着回来——这正是界面依赖的字段
        assertEquals(1, model.store.cards.count { it.isFavorite })
        assertEquals(1, model.store.cards.count { it.seenAt != null })
    }

    /**
     * 端到端：共享存储 → 共享状态机 → **共享整屏**，全部在桌面 JVM 上离屏渲染。
     * 断言用的「收藏 N / 历史 N」标签由共享的 `LibraryScreen` 渲染，数据来自真实落盘内容。
     */
    @OptIn(ExperimentalTestApi::class)
    @Test
    fun rendersLibraryLoadedFromSharedStorage() = runComposeUiTest {
        val dir = Files.createTempDirectory("kf-desktop-ui-test").toFile()
        CardStorage(dir).saveCards(DomainBridge.sampleCards())
        val model = AppModel(CardStorage(dir)).apply { bootstrap() }

        setContent { KnowFlickTheme(paperTheme = PaperTheme.RICE_PAPER) { DesktopHost(model) } }
        onNodeWithText("收藏 1").assertExists()
        onNodeWithText("历史 1").assertExists()
    }
}
