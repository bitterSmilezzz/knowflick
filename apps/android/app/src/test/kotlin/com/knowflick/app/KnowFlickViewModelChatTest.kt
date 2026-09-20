package com.knowflick.app

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@Config(sdk = [35])
@RunWith(RobolectricTestRunner::class)
class KnowFlickViewModelChatTest {

    private val application: Application = ApplicationProvider.getApplicationContext()

    private fun sampleCard() = KnowledgeCard(
        id = "card-vm-1",
        category = "天体物理",
        headline = "引力波",
        summary = "时空曲率中的涟漪",
        details = "爱因斯坦广义相对论预言了引力波的存在。",
        links = emptyList(),
        source = CardSource.SEED,
        createdAt = System.currentTimeMillis(),
    )

    @Test
    fun openChatInitializesSessionAndActiveCard() {
        val vm = KnowFlickViewModel(application)
        val card = sampleCard()

        vm.openChat(card)
        assertEquals(card.id, vm.activeChatCard?.id)
        assertNotNull(vm.currentChatSession)
        assertEquals(card.id, vm.currentChatSession?.cardId)
        assertEquals(0, vm.currentChatSession?.messages?.size)

        vm.closeChat()
        assertNull(vm.activeChatCard)
    }

    @Test
    fun cancelChatStreamingResetsStreamingFlag() {
        val vm = KnowFlickViewModel(application)
        val card = sampleCard()
        vm.openChat(card)

        vm.cancelChatStreaming()
        assertEquals(false, vm.isChatStreaming)
    }

    @Test
    fun clearCurrentChatSessionClearsMemoryAndStorage() {
        val vm = KnowFlickViewModel(application)
        val card = sampleCard()
        vm.openChat(card)

        vm.clearCurrentChatSession()
        assertEquals(0, vm.currentChatSession?.messages?.size)
        assertNull(vm.chatStorage.loadSession(card.id))
    }

    @Test
    fun deriveAndSaveCardFromChatInsertsCardAtTopAndRecordsMessageId() {
        val vm = KnowFlickViewModel(application)
        val card = sampleCard()
        val content = "## 广义相对论预言\n引力波是由加速运动的有质量物体扰动时空而产生的微弱涟漪。"

        val derived = vm.deriveAndSaveCardFromChat("msg-123", content, card)

        assertEquals("广义相对论预言", derived.headline)
        assertEquals(card.category, derived.category)
        assertTrue(vm.savedChatMessageIds.contains("msg-123"))
        assertEquals(derived.id, vm.model.store.cards.first().id)
    }

    @Test
    fun exportCurrentChatMarkdownReturnsFormattedString() {
        val vm = KnowFlickViewModel(application)
        val card = sampleCard()
        vm.openChat(card)

        // 空对话返回 null
        assertNull(vm.exportCurrentChatMarkdown())

        // 模拟一条对话
        vm.currentChatSession = vm.currentChatSession?.copy(
            messages = listOf(
                com.knowflick.app.ai.CardChatMessage(
                    id = "msg-1",
                    sender = com.knowflick.app.ai.MessageSender.USER,
                    content = "引力波是如何被探测到的？",
                ),
            ),
        )

        val md = vm.exportCurrentChatMarkdown()
        assertNotNull(md)
        assertTrue(md.contains("《引力波》AI 伴学追问记录"))
        assertTrue(md.contains("引力波是如何被探测到的？"))
    }
}

