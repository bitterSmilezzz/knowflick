package com.knowflick.app

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeRight
import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.knowflick.app.data.AppModel
import com.knowflick.app.domain.SwipeDirection
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
        rule.onNodeWithContentDescription("收藏阁").assertIsDisplayed()
        rule.onNodeWithContentDescription("学习统计").assertIsDisplayed()
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
        org.junit.Assert.assertNotEquals(before, after)
    }
}
