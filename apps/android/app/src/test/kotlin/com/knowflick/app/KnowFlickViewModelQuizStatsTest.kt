package com.knowflick.app

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.QuizRating
import com.knowflick.app.domain.QuizType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@Config(sdk = [35])
@RunWith(RobolectricTestRunner::class)
class KnowFlickViewModelQuizStatsTest {

    private val application: Application = ApplicationProvider.getApplicationContext()

    private fun sampleCard(id: String, headline: String, seenDaysAgo: Long? = null) = KnowledgeCard(
        id = id,
        category = "认知科学",
        headline = headline,
        summary = "主动回忆与间隔重复",
        details = "经过间隔提取的记忆痕迹更加牢固。",
        links = emptyList(),
        source = CardSource.SEED,
        createdAt = System.currentTimeMillis(),
        seenAt = seenDaysAgo?.let { System.currentTimeMillis() - it * 86400000L },
    )

    @Test
    fun startDueReviewBuildsDueSession() {
        val vm = KnowFlickViewModel(application)
        val card = sampleCard("c1", "两日前阅读卡", seenDaysAgo = 2)
        vm.mutate { vm.model.store.addCards(listOf(card), insertAtTop = true) }

        vm.startDueReview()

        val session = vm.quizSession
        assertNotNull(session)
        assertEquals(QuizType.DUE_REVIEW, session.type)
        assertEquals(1, session.total)
        assertEquals(card.id, session.current?.id)

        vm.exitQuiz()
        assertNull(vm.quizSession)
    }

    @Test
    fun retestWeakCardsBuildsWeakRetestSession() {
        val vm = KnowFlickViewModel(application)
        val c1 = sampleCard("c1", "熟练卡")
        val c2 = sampleCard("c2", "犹豫卡")
        val c3 = sampleCard("c3", "遗忘卡")
        vm.mutate { vm.model.store.addCards(listOf(c1, c2, c3), insertAtTop = true) }

        val ratings = mapOf(
            c1.id to QuizRating.MASTERED,
            c2.id to QuizRating.HESITANT,
            c3.id to QuizRating.FORGOT,
        )

        vm.retestWeakCards(ratings)

        val session = vm.quizSession
        assertNotNull(session)
        assertEquals(QuizType.WEAK_RETEST, session.type)
        assertEquals(2, session.total)
        assertEquals(setOf(c2.id, c3.id), session.cards.map { it.id }.toSet())
    }
}
