package com.knowflick.app.domain.graph

import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
import kotlin.math.abs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
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

    // ---------------------------------------------------------------- 视口自适应
    //
    // 手机屏宽只有世界画布的约两成，不做 fit 就等于「进图只看到左上角一块」。

    @Test
    fun fitCentersBoundingBoxInViewPort() {
        val fit = KnowledgeGraphEngine.fitToViewport(
            minX = 0f, minY = 0f, maxX = 2000f, maxY = 2000f,
            viewWidth = 1000f, viewHeight = 1000f,
        )
        assertTrue("包围盒中心应落在视口中心", abs(1000f * fit.scale + fit.offsetX - 500f) < 0.01f)
        assertTrue(abs(1000f * fit.scale + fit.offsetY - 500f) < 0.01f)
        assertTrue("2000 世界单位塞进 1000 视口必然缩小", fit.scale < 0.5f)
    }

    @Test
    fun fitRespectsScaleLimitsAndDegenerateBounds() {
        val fit = KnowledgeGraphEngine.fitToViewport(
            minX = 700f, minY = 700f, maxX = 700f, maxY = 700f,
            viewWidth = 400f, viewHeight = 400f,
        )
        assertEquals(3.2f, fit.scale, 0.001f)   // 单点按上限放大，不除零
        assertTrue(abs(fit.offsetX + 700f * 3.2f - 200f) < 0.01f)

        val zero = KnowledgeGraphEngine.fitToViewport(
            minX = 0f, minY = 0f, maxX = 10f, maxY = 10f, viewWidth = 0f, viewHeight = 400f,
        )
        assertEquals(1f, zero.scale, 0.0001f)
    }

    @Test
    fun fewCategoryShardsStillFillTwoDimensions() {
        // 只有 2 个学科的片：旧布局会把节点压在一条直线上（视觉上「星图塌了」）
        val graph = KnowledgeGraphEngine.buildGraph(corpus(40), width = 1400f, height = 1400f)
        val bounds = KnowledgeGraphEngine.boundsOf(graph.nodes)!!
        val width = bounds.maxX - bounds.minX
        val height = bounds.maxY - bounds.minY
        assertTrue(
            "两学科分片应铺成面而不是线：宽 ${width} 高 ${height}",
            height > width * 0.25f,
        )
    }

    @Test
    fun boundsCoverEveryNodeAndEmptyGraphHasNone() {
        val graph = KnowledgeGraphEngine.buildGraph(corpus(16), width = 1400f, height = 1400f)
        val bounds = KnowledgeGraphEngine.boundsOf(graph.nodes)
        assertNotNull(bounds)
        bounds!!.let { b ->
            graph.nodes.forEach {
                assertTrue(it.x >= b.minX && it.x <= b.maxX)
                assertTrue(it.y >= b.minY && it.y <= b.maxY)
            }
        }
        assertNull(KnowledgeGraphEngine.boundsOf(emptyList()))
    }

    // ---------------------------------------------------------------- 构图缓存
    //
    // Android 端此前没有任何图级缓存：划一张卡、收藏一次都会触发全量 O(N²) 重建，
    // 手机上表现为「星图一动手就卡」。以下用例锚定「拓扑不变就不重算」这条契约。

    private fun corpus(size: Int, details: String = "引力与简并压力的平衡"): List<KnowledgeCard> =
        (0 until size).map { index ->
            createCard(
                id = "card-$index",
                category = if (index % 2 == 0) "物理" else "数学",
                headline = "中子星结构要点 $index",
                summary = "中子简并压力对抗引力坍缩 $index",
                details = "$details，第 $index 条补充说明星族分类与半径关系。",
            )
        }

    @Test
    fun testIdenticalTopologyReusesCachedGraph() {
        KnowledgeGraphEngine.invalidateGraphCache()
        val cards = corpus(24)

        val first = KnowledgeGraphEngine.buildGraph(cards)
        assertEquals(false, KnowledgeGraphEngine.lastBuildDiagnostics?.didHitCache)

        val second = KnowledgeGraphEngine.buildGraph(cards)
        assertEquals(true, KnowledgeGraphEngine.lastBuildDiagnostics?.didHitCache)
        assertSame(first, second)
        assertEquals(first.nodes.map { it.cardId }, second.nodes.map { it.cardId })
        assertEquals(first.edges.map { it.id }, second.edges.map { it.id })
    }

    @Test
    fun testSwipeAndFavoriteChangesDoNotChangeTopologySignature() {
        KnowledgeGraphEngine.invalidateGraphCache()
        val cards = corpus(12)
        KnowledgeGraphEngine.buildGraph(cards)

        // 划卡 / 收藏 / 浏览时间只改学习状态，不应换图
        val touched = cards.map { it.copy(seenAt = System.currentTimeMillis(), isFavorite = true, swiped = null) }
        assertEquals(
            KnowledgeGraphEngine.graphSignature(cards, 1400f, 1400f),
            KnowledgeGraphEngine.graphSignature(touched, 1400f, 1400f),
        )
        KnowledgeGraphEngine.buildGraph(touched)
        assertEquals(true, KnowledgeGraphEngine.lastBuildDiagnostics?.didHitCache)
    }

    @Test
    fun testContentEditInvalidatesCacheAndKeywords() {
        KnowledgeGraphEngine.invalidateGraphCache()
        val cards = corpus(12)
        KnowledgeGraphEngine.buildGraph(cards)

        val edited = cards.mapIndexed { index, card ->
            if (index == 0) card.copy(details = card.details + " 光栅引力透镜新术语") else card
        }
        KnowledgeGraphEngine.buildGraph(edited)
        assertEquals(false, KnowledgeGraphEngine.lastBuildDiagnostics?.didHitCache)

        // 关键词缓存的 key 必须覆盖正文：编辑后新词要能被抽出，否则星图引力线停在旧内容上
        val keywords = KnowledgeGraphEngine.extractKeywords(edited[0])
        assertTrue(
            "正文新增术语应进入关键词集",
            keywords.any { it.contains("透镜") },
        )
    }

    @Test
    fun testShardSwitchingStaysCached() {
        KnowledgeGraphEngine.invalidateGraphCache()
        val shards = ('a'..'f').map { letter -> corpus(6, details = "${letter}组内容") }
        shards.forEach { KnowledgeGraphEngine.buildGraph(it) }
        // 切回最早那片仍应命中：容量必须覆盖常见学科数，否则来回切换就是反复 O(n²) 重算
        KnowledgeGraphEngine.buildGraph(shards.first())
        assertEquals(true, KnowledgeGraphEngine.lastBuildDiagnostics?.didHitCache)
    }

    @Test
    fun testGraphCacheEvictsLeastRecentlyUsed() {
        KnowledgeGraphEngine.invalidateGraphCache()
        val a = corpus(8, details = "甲组内容")
        val b = corpus(8, details = "乙组内容")
        val c = corpus(8, details = "丙组内容")

        KnowledgeGraphEngine.buildGraph(a)
        KnowledgeGraphEngine.buildGraph(b)
        // 容量 2：访问 a 之前它已被 b、c 挤出
        KnowledgeGraphEngine.buildGraph(a)
        KnowledgeGraphEngine.buildGraph(c)
        assertEquals(false, KnowledgeGraphEngine.lastBuildDiagnostics?.didHitCache)
    }

    @Test
    fun testSameCategoryCandidatesStayDeterministic() {
        KnowledgeGraphEngine.invalidateGraphCache()
        val cards = corpus(40)
        val first = KnowledgeGraphEngine.buildGraph(cards)
        KnowledgeGraphEngine.invalidateGraphCache()
        val second = KnowledgeGraphEngine.buildGraph(cards)

        assertEquals(first.edges.map { it.id }, second.edges.map { it.id })
        assertTrue("同科聚合候选应产生同领域深化边", first.edges.any { it.kind == RelationKind.DISCIPLINE_DEEPEN })
    }
}
