package com.knowflick.app

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeRight
import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.knowflick.app.data.AppModel
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented 测试：在模拟器上验证真实 Compose UI 的卡堆交互链路。
 * 运行：./gradlew :app:connectedDebugAndroidTest
 */
@RunWith(AndroidJUnit4::class)
class DeckScreenTest {

    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    private fun viewModel(): KnowFlickViewModel =
        ViewModelProvider(rule.activity)[KnowFlickViewModel::class.java]

    @Test
    fun titleIsDisplayed() {
        // 顶栏主入口：收藏阁 / 更多（统计与设置收纳其中）/ 磨耳朵
        rule.onNodeWithContentDescription("收藏阁").assertIsDisplayed()
        rule.onNodeWithContentDescription("更多").assertIsDisplayed()
        rule.onNodeWithContentDescription("磨耳朵连续朗读").assertIsDisplayed()
    }

    @Test
    fun moreMenuExposesStatsAndSettings() {
        rule.onNodeWithContentDescription("更多").performClick()
        rule.onNodeWithText("学习统计").assertIsDisplayed()
        rule.onNodeWithText("AI 服务设置").assertIsDisplayed()
        rule.onNodeWithText("撤销上一张").assertIsDisplayed()
    }

    /** 撤销入口的完整 UI 链路：划走 → 菜单可撤销 → 卡片回顶且收藏保留。 */
    @Test
    fun undoFromMoreMenuReturnsCardToDeckTop() {
        val model: AppModel = viewModel().model
        val beforeId = model.store.topCard!!.id

        rule.onNodeWithTag("deck_top_card").performTouchInput { swipeRight() }
        rule.waitUntil(timeoutMillis = 5_000) { model.store.topCard?.id != beforeId }

        rule.onNodeWithContentDescription("更多").performClick()
        rule.onNodeWithText("撤销上一张").performClick()

        rule.waitUntil(timeoutMillis = 5_000) { model.store.topCard?.id == beforeId }
        val restored = model.store.cards.first { it.id == beforeId }
        assertNull("撤销后卡片应为未读", restored.seenAt)
        assertTrue("撤销只还原浏览意图，不还原收藏", restored.isFavorite)
        assertTrue("撤销栈已消费，不能重复撤销", !model.store.canUndoLastSwipe)
    }

    @Test
    fun topCardIsRendered() {
        rule.onNodeWithTag("deck_top_card").assertIsDisplayed()
    }

    @Test
    fun swipeRightAdvancesToNextCard() {
        val model: AppModel = viewModel().model
        val beforeId = model.store.topCard?.id
        rule.onNodeWithTag("deck_top_card").performTouchInput { swipeRight() }
        rule.waitUntil(timeoutMillis = 5_000) { model.store.topCard?.id != beforeId }
    }

    @Test
    fun draggedCardTracksTheFingerOnTheNextFrame() {
        rule.mainClock.autoAdvance = false
        val card = rule.onNodeWithTag("deck_top_card")
        val startCenterX = card.fetchSemanticsNode().boundsInRoot.center.x

        card.performTouchInput {
            down(center)
            moveBy(Offset(140f, 0f))
            advanceEventTime(16)
        }
        rule.mainClock.advanceTimeByFrame()

        val movedCenterX = card.fetchSemanticsNode().boundsInRoot.center.x
        card.performTouchInput { up() }
        rule.mainClock.autoAdvance = true
        assertTrue(
            "卡片下一帧应跟随手指，实际只移动 ${movedCenterX - startCenterX}px",
            // Android 的触摸 slop 会消费约 20px；剩余位移必须在下一帧完整呈现。
            movedCenterX - startCenterX >= 110f,
        )
    }

    @Test
    fun nextCardIsVisibleWhilePreviousCardLeaves() {
        val model: AppModel = viewModel().model
        val beforeId = model.store.topCard!!.id
        val beforeHeadline = model.store.topCard!!.headline
        rule.mainClock.autoAdvance = false

        rule.onNodeWithTag("deck_top_card").performTouchInput { swipeRight(durationMillis = 200) }
        rule.mainClock.advanceTimeByFrame()

        assertNotEquals(beforeId, model.store.topCard?.id)
        rule.onNodeWithTag("deck_top_card").assertIsDisplayed()
        rule.mainClock.advanceTimeBy(300)
        assertTrue(rule.onAllNodesWithText(beforeHeadline).fetchSemanticsNodes().isEmpty())
        rule.mainClock.autoAdvance = true
    }

    @Test
    fun detailButtonOpensDetailScreen() {
        rule.onNodeWithContentDescription("详情").performClick()
        rule.onNodeWithContentDescription("返回").assertIsDisplayed()
        rule.onNodeWithContentDescription("收藏或取消收藏").assertIsDisplayed()
    }

    @Test
    fun favoriteButtonTogglesFavoriteState() {
        val model: AppModel = viewModel().model
        val cardId = model.store.topCard!!.id
        val before = model.store.cards.first { it.id == cardId }.isFavorite
        rule.onNodeWithContentDescription("收藏").performClick()
        val after = model.store.cards.first { it.id == cardId }.isFavorite
        assertNotEquals(before, after)
    }
}
