package com.knowflick.app

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.knowflick.app.ui.PaperTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NewExperienceNavigationTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    private fun vm() = ViewModelProvider(rule.activity)[KnowFlickViewModel::class.java]

    @Test fun graphIsReachableFromDeckMenu() {
        rule.onNodeWithContentDescription("更多").performClick()
        rule.onNodeWithText("知识全景星图").performClick()
        rule.onNodeWithText("知识全景星图").assertIsDisplayed()
        rule.onNodeWithContentDescription("知识星图画布", substring = true).assertIsDisplayed()
        rule.onNodeWithContentDescription("返回").performClick()
        rule.onNodeWithText("KnowFlick").assertIsDisplayed()
    }

    @Test fun syncSheetIsReachableAndClosable() {
        rule.onNodeWithContentDescription("更多").performClick()
        rule.onNodeWithText("局域网极速同步…").performClick()
        rule.onNodeWithText("局域网极速同步").assertIsDisplayed()
        rule.onNodeWithText("本机接收服务").assertIsDisplayed()
        rule.onNodeWithContentDescription("关闭").performClick()
        rule.onNodeWithText("KnowFlick").assertIsDisplayed()
    }

    @Test fun paperThemeSwitchPersistsImmediately() {
        rule.onNodeWithContentDescription("更多").performClick()
        rule.onNodeWithText("AI 服务设置").performClick()
        rule.onNodeWithText("羊皮纸").performScrollTo().performClick()
        rule.runOnIdle { assertEquals(PaperTheme.PARCHMENT, vm().currentPaperTheme) }

        rule.activityRule.scenario.recreate()

        rule.runOnIdle { assertEquals(PaperTheme.PARCHMENT, vm().currentPaperTheme) }
        rule.onNodeWithText("✓ 当前生效").performScrollTo().assertIsDisplayed()
    }
}
