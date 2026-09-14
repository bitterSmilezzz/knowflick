package com.knowflick.app

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.click
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performTouchInput
import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.knowflick.app.domain.SwipeDirection
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NavigationRegressionTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    private fun vm() = ViewModelProvider(rule.activity)[KnowFlickViewModel::class.java]
    private fun back() = rule.runOnIdle { rule.activity.onBackPressedDispatcher.onBackPressed() }

    @Test fun tapOnCardOpensDetails() {
        rule.onNodeWithTag("deck_top_card").performTouchInput { click() }
        rule.onNodeWithContentDescription("收藏或取消收藏").assertIsDisplayed()
    }

    @Test fun favoriteDetailReturnsToLibrary() {
        lateinit var headline: String
        rule.runOnIdle {
            val model = vm()
            val card = model.model.store.topCard!!
            headline = card.headline
            if (!card.isFavorite) model.mutate { model.model.store.toggleFavorite(card) }
        }
        rule.onNodeWithContentDescription("收藏阁").performClick()
        rule.onNodeWithText(headline).performTouchInput { click() }
        rule.onNodeWithContentDescription("收藏或取消收藏").assertIsDisplayed()
        back()
        rule.onNodeWithText("知识库").assertIsDisplayed()
    }

    @Test fun recreationKeepsCurrentDetail() {
        val headline = vm().model.store.topCard!!.headline
        rule.onNodeWithContentDescription("详情").performClick()
        rule.activityRule.scenario.recreate()
        rule.onNodeWithContentDescription("收藏或取消收藏").assertIsDisplayed()
        rule.onNodeWithText(headline).assertIsDisplayed()
    }

    @Test fun historyDetailReturnsToHistoryTab() {
        lateinit var headline: String
        var count = 0
        rule.runOnIdle {
            val model = vm()
            val card = model.model.store.topCard!!
            headline = card.headline
            model.mutate { model.model.store.swipe(card, SwipeDirection.SKIP) }
            count = model.model.store.history.size
        }
        rule.onNodeWithContentDescription("收藏阁").performClick()
        rule.onNodeWithText("历史足迹 $count").performClick()
        rule.onNodeWithText(headline).performTouchInput { click() }
        rule.onNodeWithContentDescription("收藏或取消收藏").assertIsDisplayed()
        back()
        rule.onNodeWithText("全部").assertIsDisplayed()
        rule.onNodeWithText(headline).assertIsDisplayed()
    }

    @Test fun recreationKeepsQuizCardFlipped() {
        rule.onNodeWithContentDescription("更多").performClick()
        rule.onNodeWithText("知识测验").performClick()
        rule.onNodeWithText("点击翻面查看解析 →").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("三档自评写回熟练度，到期队列随之刷新").assertIsDisplayed()

        rule.activityRule.scenario.recreate()

        rule.onNodeWithText("三档自评写回熟练度，到期队列随之刷新").assertIsDisplayed()
    }

    @Test fun recreationDoesNotLeaveConnectionTestStuck() {
        val server = MockWebServer().apply {
            enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
            start()
        }
        try {
            rule.onNodeWithContentDescription("更多").performClick()
            rule.onNodeWithText("AI 服务设置").performClick()
            val fields = rule.onAllNodes(hasSetTextAction())
            fields[0].performTextReplacement(server.url("/").toString())
            fields[1].performTextReplacement("test-model")
            rule.onNodeWithText("测试连通性").performScrollTo().performClick()
            rule.onNodeWithText("测试中…").fetchSemanticsNode()

            rule.activityRule.scenario.recreate()

            rule.onNodeWithText("测试连通性").fetchSemanticsNode()
            rule.onNodeWithText("测试连通性").assertIsEnabled()
        } finally {
            server.shutdown()
        }
    }

    @Test fun detailReferenceLinksAreActionable() {
        lateinit var linkTitle: String
        rule.runOnIdle {
            linkTitle = vm().model.store.topCard!!.links.first().title
        }

        rule.onNodeWithContentDescription("详情").performClick()

        rule.onNodeWithText("◦ $linkTitle").assertHasClickAction()
    }
}
