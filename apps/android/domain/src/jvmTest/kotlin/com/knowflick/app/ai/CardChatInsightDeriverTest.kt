package com.knowflick.app.ai

import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.ScienceLink
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CardChatInsightDeriverTest {

    private fun makeParentCard(): KnowledgeCard {
        return KnowledgeCard(
            id = "parent-1",
            category = "物理学",
            headline = "量子纠缠与信息守恒",
            summary = "量子隐形传态并不违反相对论光速上限",
            details = "长文详情...",
            links = listOf(ScienceLink(title = "量子纠缠", url = "https://zh.wikipedia.org/wiki/量子纠缠")),
            source = CardSource.AI,
            createdAt = System.currentTimeMillis(),
        )
    }

    @Test
    fun deriveCardExtractsFromMarkdownHeading() {
        val parent = makeParentCard()
        val assistantReply = """
            ## EPR 佯谬的世纪反转

            爱因斯坦曾质疑量子纠缠是「鬼魅般的超距作用」，认为量子力学是不完备的。

            贝尔不等式的提出与阿斯佩实验彻底证实了量子非定域性。现实中的量子通信正是基于这一原理保障绝对安全。
        """.trimIndent()

        val derived = CardChatInsightDeriver.deriveCard(assistantReply, parent)

        assertEquals("EPR 佯谬的世纪反转", derived.headline)
        assertEquals("物理学", derived.category)
        assertTrue(derived.summary.contains("爱因斯坦曾质疑量子纠缠"))
        assertEquals(assistantReply.trim(), derived.details)
        assertEquals(CardSource.AI, derived.source)
        assertFalse(derived.links.isEmpty())
    }

    @Test
    fun deriveCardExtractsFromFirstSentence() {
        val parent = makeParentCard()
        val reply = "量子隐形传态的本质是量子态传输。它并不传递经典物质，而是传递未知量子态的全部信息。"

        val derived = CardChatInsightDeriver.deriveCard(reply, parent)

        assertEquals("量子隐形传态的本质是量子态传输", derived.headline)
        assertEquals("物理学", derived.category)
    }

    @Test
    fun deriveCardFallbackToParentHeadline() {
        val parent = makeParentCard()
        val reply = "是。"

        val derived = CardChatInsightDeriver.deriveCard(reply, parent)

        assertTrue(derived.headline.contains("量子纠缠与信息守恒"))
    }

    @Test
    fun exportMarkdownFormatsSession() {
        val parent = makeParentCard()
        val userMsg = CardChatMessage(id = "msg-1", sender = MessageSender.USER, content = "什么是贝尔不等式？")
        val assistantMsg = CardChatMessage(id = "msg-2", sender = MessageSender.ASSISTANT, content = "贝尔不等式是由约翰·贝尔提出的数学定理...")
        val session = CardChatSession(
            cardId = parent.id,
            cardHeadline = parent.headline,
            messages = listOf(userMsg, assistantMsg),
        )

        val md = CardChatInsightDeriver.exportMarkdown(session, parent)

        assertTrue(md.contains("# 《量子纠缠与信息守恒》AI 伴学追问记录"))
        assertTrue(md.contains("- **所属分类**：物理学"))
        assertTrue(md.contains("### 🙋 你"))
        assertTrue(md.contains("什么是贝尔不等式？"))
        assertTrue(md.contains("### 🤖 KnowFlick 伴学导师"))
        assertTrue(md.contains("贝尔不等式是由约翰·贝尔提出的数学定理"))
    }

    @Test
    fun suggestFollowUpsContextual() {
        val parent = makeParentCard()

        val expReply = "1982 年阿兰·阿斯佩通过精确的光子偏振实验验证了贝尔不等式的破缺..."
        val expSuggestions = CardChatInsightDeriver.suggestFollowUps(expReply, parent)
        assertEquals(3, expSuggestions.size)
        assertTrue(expSuggestions.any { it.contains("实验") || it.contains("验证") })

        val mechReply = "量子态叠加与波函数坍缩的数学算法机制如下..."
        val mechSuggestions = CardChatInsightDeriver.suggestFollowUps(mechReply, parent)
        assertEquals(3, mechSuggestions.size)
        assertTrue(mechSuggestions.any { it.contains("机制") || it.contains("比喻") })
    }
}
