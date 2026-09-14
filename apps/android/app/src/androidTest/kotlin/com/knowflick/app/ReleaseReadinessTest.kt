package com.knowflick.app

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.knowflick.app.data.CardFileIO
import com.knowflick.app.data.CardExportEngine
import com.knowflick.app.data.CardStorage
import com.knowflick.app.data.SystemCredentialStore
import com.knowflick.app.data.ShareFileWriter
import com.knowflick.app.ai.AiSettings
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.SwipeDirection
import com.knowflick.app.speech.SpeechChannel
import com.knowflick.app.speech.SpeechSettings
import java.io.File
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ReleaseReadinessTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    private fun model() = ViewModelProvider(rule.activity)[KnowFlickViewModel::class.java]
    private fun diskCards() = CardStorage(File(rule.activity.filesDir, "store")).loadCards()

    @Test fun favoriteIsSavedWithoutLeavingActivity() {
        lateinit var id: String
        var expected = false
        rule.runOnIdle {
            val card = model().model.store.topCard!!
            id = card.id
            expected = !card.isFavorite
        }
        rule.onNodeWithContentDescription("收藏").performClick()
        rule.waitUntil(5_000) { diskCards().first { it.id == id }.isFavorite == expected }
    }

    @Test fun importedCardIsSavedWithoutLeavingActivity() {
        val title = "导入保存回归 ${java.util.UUID.randomUUID()}"
        val card = KnowledgeCard.create(category = "冷知识", headline = title, summary = "摘要", details = "测试内容", source = com.knowflick.app.domain.CardSource.IMPORTED)
        rule.runOnIdle { model().importFromJson(CardFileIO.encodeList(listOf(card))) }
        rule.waitUntil(5_000) { diskCards().any { it.headline == title } }
    }

    @Test fun jsonArchiveImportPreservesLearningProgressAndNewCardIdentity() {
        lateinit var existing: KnowledgeCard
        rule.runOnIdle { existing = model().model.store.cards.first() }
        val restoredExisting = existing.copy(
            seenAt = 1_700_000_000_000L,
            swiped = SwipeDirection.RIGHT,
            isFavorite = true,
            favoritedAt = 1_700_000_001_000L,
            reviewCount = 7,
            masteryLevel = 2,
            lastReviewedAt = 1_700_000_002_000L,
        )
        val newHeadline = "归档新增卡 ${java.util.UUID.randomUUID()}"
        val restoredNew = KnowledgeCard.create(
            category = "学习",
            headline = newHeadline,
            summary = "摘要",
            details = "正文",
            source = CardSource.AI,
            createdAt = 1_600_000_000_000L,
        ).copy(
            id = "ARCHIVE-${java.util.UUID.randomUUID()}",
            seenAt = 1_700_000_003_000L,
            swiped = SwipeDirection.LEFT,
            reviewCount = 3,
            masteryLevel = 1,
            lastReviewedAt = 1_700_000_004_000L,
        )

        rule.runOnIdle {
            model().importFromJson(CardExportEngine.exportJSONArchive(listOf(restoredExisting, restoredNew)))
        }

        rule.runOnIdle {
            val cards = model().model.store.cards
            val existingAfter = cards.first { it.headline == existing.headline }
            assertEquals(restoredExisting.seenAt, existingAfter.seenAt)
            assertEquals(restoredExisting.swiped, existingAfter.swiped)
            assertEquals(restoredExisting.reviewCount, existingAfter.reviewCount)
            assertEquals(restoredExisting.masteryLevel, existingAfter.masteryLevel)
            assertEquals(restoredExisting.lastReviewedAt, existingAfter.lastReviewedAt)

            val newAfter = cards.first { it.headline == newHeadline }
            assertEquals(restoredNew.id, newAfter.id)
            assertEquals(CardSource.AI, newAfter.source)
            assertEquals(restoredNew.seenAt, newAfter.seenAt)
            assertEquals(restoredNew.lastReviewedAt, newAfter.lastReviewedAt)
        }
    }

    @Test fun topBarClearsSystemStatusBar() {
        rule.onNodeWithContentDescription("换一批").assertIsDisplayed()
        val bounds = rule.onNodeWithContentDescription("更多").fetchSemanticsNode().boundsInWindow
        val statusBar = ViewCompat.getRootWindowInsets(rule.activity.window.decorView)!!
            .getInsets(WindowInsetsCompat.Type.statusBars()).top
        assertTrue("Top bar overlaps system status bar", bounds.top >= statusBar)
    }

    @Test fun switchingToLocalServicesDeletesStaleCloudCredentials() {
        val credentials = SystemCredentialStore(rule.activity)
        assertTrue(credentials.save("old-ai-cloud-key", "apiKey"))
        assertTrue(credentials.save("old-tts-cloud-key", "tts.key"))

        rule.runOnIdle {
            model().saveSettings(
                AiSettings(providerId = "ollama", baseURL = "http://127.0.0.1:11434/v1", model = "qwen2.5:7b"),
                apiKey = "old-ai-cloud-key",
            )
            model().saveSpeechSettings(
                SpeechSettings(channel = SpeechChannel.LOCAL.name, baseURL = "http://127.0.0.1:8880", model = "kokoro"),
                apiKey = "old-tts-cloud-key",
            )
        }

        assertNull(SystemCredentialStore(rule.activity).read("apiKey"))
        assertNull(SystemCredentialStore(rule.activity).read("tts.key"))
    }

    @Test fun exportedArchiveIsSharedAsReadableFile() {
        val payload = "[{\"headline\":\"导出文件回归\"}]"

        val shared = ShareFileWriter.create(rule.activity, payload, "knowflick_cards.json")

        assertEquals("application/json", shared.mimeType)
        assertEquals("content", shared.uri.scheme)
        val reopened = rule.activity.contentResolver.openInputStream(shared.uri)!!.use { it.readBytes().decodeToString() }
        assertEquals(payload, reopened)
    }

    @Test fun quizRoundsDoNotRepeatUntilTheCycleIsExhausted() {
        lateinit var original: List<KnowledgeCard>
        rule.runOnIdle { original = model().model.store.cards }
        val pool = (1..25).map { index ->
            KnowledgeCard.create("测试", "跨轮次去重 $index", "摘要", "正文", source = CardSource.IMPORTED)
        }
        try {
            rule.runOnIdle { model().model.store.replaceAll(pool) }
            val rated = LinkedHashSet<String>()
            repeat(2) {
                rule.runOnIdle {
                    if (model().quizSession == null) model().startQuiz()
                    while (model().quizSession?.current != null) {
                        val id = model().quizSession!!.current!!.id
                        assertTrue("卡片在卡池耗尽前不应跨轮重复", rated.add(id))
                        model().rateQuiz(com.knowflick.app.domain.QuizRating.MASTERED)
                    }
                    model().nextQuizRound()
                }
            }
            rule.runOnIdle {
                val thirdRound = model().quizSession!!.cards.map { it.id }
                assertTrue(thirdRound.isNotEmpty())
                assertTrue("第三轮应只包含前两轮未出现的 5 张卡", thirdRound.none { it in rated })
            }
        } finally {
            rule.runOnIdle {
                model().exitQuiz()
                model().model.store.replaceAll(original)
                model().flushPending()
            }
        }
    }

    @Test fun systemBackReturnsFromDetailToDeck() {
        rule.onNodeWithContentDescription("详情").performClick()
        rule.runOnIdle { rule.activity.onBackPressedDispatcher.onBackPressed() }
        rule.onNodeWithContentDescription("更多").assertIsDisplayed()
        assertFalse(rule.activity.isFinishing)
    }
}
