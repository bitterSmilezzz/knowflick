package com.knowflick.app.domain.graph

import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class KnowledgeGraphEngineTest {

    private fun createCard(
        id: String,
        category: String,
        headline: String,
        summary: String,
        details: String,
        masteryLevel: Int = 0,
    ) = KnowledgeCard(
        id = id,
        category = category,
        headline = headline,
        summary = summary,
        details = details,
        links = emptyList(),
        source = CardSource.SEED,
        createdAt = System.currentTimeMillis(),
        masteryLevel = masteryLevel,
    )

    @Test
    fun testExtractKeywords() {
        val card = createCard(
            id = "c1",
            category = "物理",
            headline = "中子星致密物质",
            summary = "中子星上一茶匙物质重达数亿吨，引力极强",
            details = "中子简并压力支撑着中子星对抗引力坍缩",
        )
        val kw = KnowledgeGraphEngine.extractKeywords(card)
        assertTrue("Keywords should contain 中子", kw.contains("中子"))
        assertTrue("Keywords should contain 子星", kw.contains("子星"))
        assertTrue("Keywords should contain 引力", kw.contains("引力"))
    }

    @Test
    fun testEvaluateSameCategoryRelation() {
        val card1 = createCard("c1", "物理", "中子星引力", "中子星表面引力巨大", "详情")
        val card2 = createCard("c2", "物理", "黑洞视界", "黑洞引力同样无法逃脱", "详情")

        val kw1 = KnowledgeGraphEngine.extractKeywords(card1)
        val kw2 = KnowledgeGraphEngine.extractKeywords(card2)

        val relation = KnowledgeGraphEngine.evaluateRelation(card1, card2, kw1, kw2)
        assertNotNull(relation)
        assertEquals(RelationKind.DISCIPLINE_DEEPEN, relation!!.first)
        assertTrue(relation.second > 0.35f)
    }

    @Test
    fun testBuildGraphTopology() {
        val cards = listOf(
            createCard("c1", "物理", "中子星引力", "中子星引力极大", "引力坍缩", masteryLevel = 2),
            createCard("c2", "物理", "黑洞奇点", "黑洞具有极大引力", "时空扭曲", masteryLevel = 1),
            createCard("c3", "天文", "脉冲星观测", "脉冲星是旋转的中子星", "射电天文"),
            createCard("c4", "AI", "深度学习神经网络", "反向传播与梯度下降", "神经网络优化"),
        )

        val graph = KnowledgeGraphEngine.buildGraph(cards, 1000f, 1000f)
        assertEquals(4, graph.nodes.size)
        assertTrue("Should produce graph edges between related cards", graph.edges.isNotEmpty())

        val node1 = graph.nodes.first { it.cardId == "c1" }
        assertEquals(16f, node1.radius) // masteryLevel == 2 gives 16f
        assertTrue(node1.x > 0f && node1.y > 0f)
    }
}
