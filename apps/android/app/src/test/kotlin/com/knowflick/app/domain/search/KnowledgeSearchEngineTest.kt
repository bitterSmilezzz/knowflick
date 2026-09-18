package com.knowflick.app.domain.search

import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.ScienceLink
import com.knowflick.app.domain.SwipeDirection
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class KnowledgeSearchEngineTest {

    private val testCards = listOf(
        KnowledgeCard(
            id = "CARD-1",
            category = "会计",
            headline = "新租赁准则下承租人不再区分经营融资租赁",
            summary = "表外租机队终于上了资产负债表，一律确认使用权资产和租赁负债。",
            details = "依据CAS 21准则要求承租人采用单一模型，除短期和低价值资产外，全部进入资产负债表核算。",
            links = listOf(ScienceLink(title = "财政部会计司规范", url = "https://kjs.mof.gov.cn")),
            source = CardSource.SEED,
            createdAt = 1000L,
            seenAt = 1500L,
            swiped = SwipeDirection.RIGHT,
            isFavorite = false,
        ),
        KnowledgeCard(
            id = "CARD-2",
            category = "物理",
            headline = "量子纠缠的非定域性挑战爱因斯坦定域实在论",
            summary = "幽灵般的超距作用在贝尔不等式实验检验中被反复确证。",
            details = "爱因斯坦波多尔斯基罗森佯谬（EPR悖论）试图论证量子力学不完备，但后来的Aspect实验否定了隐变量假设。",
            links = listOf(ScienceLink(title = "物理学年鉴文献", url = "https://phys.org")),
            source = CardSource.AI,
            createdAt = 2000L,
            seenAt = null,
            swiped = null,
            isFavorite = false,
        ),
        KnowledgeCard(
            id = "CARD-3",
            category = "计算机",
            headline = "时间复杂度O(1)的LRU缓存基于双向链表与哈希表",
            summary = "最近最少使用淘汰策略在操作系统页表和Redis中极其普遍。",
            details = "哈希表定位节点耗时O(1)，双向链表调整头尾指针耗时O(1)，两相配合实现极速存取与驱逐。",
            links = emptyList(),
            source = CardSource.SEED,
            createdAt = 3000L,
            seenAt = 3500L,
            swiped = SwipeDirection.RIGHT,
            isFavorite = true,
            favoritedAt = 3500L,
        )
    )

    private val engine = KnowledgeSearchEngine()

    @Test
    fun testEmptyQueryReturnsNothingSoGuideIsReachable() {
        val results = engine.search(query = "", cards = testCards)
        assertTrue(results.isEmpty())

        val blankResults = engine.search(query = "   \n ", cards = testCards)
        assertTrue(blankResults.isEmpty())
    }

    @Test
    fun testCategoryAndSourceFilters() {
        val categoryResults = engine.search(query = "O", category = "计算机", cards = testCards)
        assertTrue(categoryResults.isNotEmpty())
        assertTrue(categoryResults.all { it.card.category == "计算机" })

        val seedResults = engine.search(query = "O", source = SearchSourceFilter.SEED, cards = testCards)
        assertTrue(seedResults.all { it.card.source == CardSource.SEED })

        val aiResults = engine.search(query = "量子", source = SearchSourceFilter.AI, cards = testCards)
        assertEquals(1, aiResults.size)
        assertEquals("物理", aiResults.first().card.category)

        val favResults = engine.search(query = "LRU", source = SearchSourceFilter.FAVORITES, cards = testCards)
        assertEquals(1, favResults.size)
        assertEquals("计算机", favResults.first().card.category)

        val unseenResults = engine.search(query = "量子", source = SearchSourceFilter.UNSEEN, cards = testCards)
        assertEquals(1, unseenResults.size)
        assertEquals("CARD-2", unseenResults.first().card.id)

        val seenResults = engine.search(query = "租赁", source = SearchSourceFilter.SEEN, cards = testCards)
        assertEquals(1, seenResults.size)
        assertEquals("CARD-1", seenResults.first().card.id)
    }

    @Test
    fun testHeadlineDirectMatch() {
        val results = engine.search(query = "量子纠缠", cards = testCards)
        assertFalse(results.isEmpty())
        assertEquals("物理", results.first().card.category)
        assertEquals(SearchMatchedField.HEADLINE, results.first().matchedField)
        assertTrue(results.first().score >= 80)
    }

    @Test
    fun testPinyinHeadlineMatch() {
        // "xzl" matches "新租赁"
        val results = engine.search(query = "xzl", cards = testCards)
        assertFalse(results.isEmpty())
        assertEquals("会计", results.first().card.category)
        assertEquals(SearchMatchedField.HEADLINE, results.first().matchedField)
    }

    @Test
    fun testPinyinFullWordMatch() {
        // "zulin" matches "租赁"
        val results = engine.search(query = "zulin", cards = testCards)
        assertFalse(results.isEmpty())
        assertEquals("会计", results.first().card.category)
    }

    @Test
    fun testCategoryMatch() {
        val results = engine.search(query = "会计", cards = testCards)
        assertFalse(results.isEmpty())
        assertEquals("会计", results.first().card.category)
    }

    @Test
    fun testDetailsSnippetExtraction() {
        // "EPR" only exists in details of card 2
        val results = engine.search(query = "EPR", cards = testCards)
        assertFalse(results.isEmpty())
        assertEquals("物理", results.first().card.category)
        assertEquals(SearchMatchedField.DETAILS, results.first().matchedField)
        assertTrue(results.first().matchedExcerpt.contains("EPR"))
    }

    @Test
    fun testRankHeadlineHigherThanDetails() {
        val cardWithWordInDetails = KnowledgeCard(
            id = "CARD-4",
            category = "历史",
            headline = "古代罗马军团体制与后勤革新",
            summary = "道路网建设为军团迅速调动提供支撑。",
            details = "军团采用LRU方式管理仓库给养补给，优先消耗陈粮。",
            links = emptyList(),
            source = CardSource.SEED,
            createdAt = 4000L,
        )
        val combined = testCards + cardWithWordInDetails
        val results = engine.search(query = "LRU", cards = combined)
        assertEquals(2, results.size)
        assertEquals("计算机", results[0].card.category) // headline contains LRU
        assertEquals("历史", results[1].card.category)   // details contains LRU
        assertTrue(results[0].score > results[1].score)
    }
}
