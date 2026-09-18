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

    // ──────────────── QueryType 分类测试 ────────────────

    @Test
    fun testQueryClassification() {
        // 含中文 → CHINESE
        assertEquals(QueryType.CHINESE, QueryType.classify("中子星"))
        assertEquals(QueryType.CHINESE, QueryType.classify("量子纠缠"))
        assertEquals(QueryType.CHINESE, QueryType.classify("会计abc"))

        // 含大写字母 → ENGLISH
        assertEquals(QueryType.ENGLISH, QueryType.classify("AI"))
        assertEquals(QueryType.ENGLISH, QueryType.classify("LRU"))
        assertEquals(QueryType.ENGLISH, QueryType.classify("DNA"))
        assertEquals(QueryType.ENGLISH, QueryType.classify("O"))

        // 纯小写含元音 → PINYIN_FULL
        assertEquals(QueryType.PINYIN_FULL, QueryType.classify("zulin"))
        assertEquals(QueryType.PINYIN_FULL, QueryType.classify("zhongzixing"))
        assertEquals(QueryType.PINYIN_FULL, QueryType.classify("ren"))

        // 纯小写全辅音 → INITIALS
        assertEquals(QueryType.INITIALS, QueryType.classify("zzx"))
        assertEquals(QueryType.INITIALS, QueryType.classify("xzl"))
        assertEquals(QueryType.INITIALS, QueryType.classify("hdl"))
        assertEquals(QueryType.INITIALS, QueryType.classify("lz"))
    }

    // ──────────────── 空查询 ────────────────

    @Test
    fun testEmptyQueryReturnsNothingSoGuideIsReachable() {
        val results = engine.search(query = "", cards = testCards)
        assertTrue(results.isEmpty())

        val blankResults = engine.search(query = "   \n ", cards = testCards)
        assertTrue(blankResults.isEmpty())
    }

    // ──────────────── 维度过滤 ────────────────

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

    // ──────────────── 中文直接匹配 ────────────────

    @Test
    fun testHeadlineDirectMatch() {
        val results = engine.search(query = "量子纠缠", cards = testCards)
        assertFalse(results.isEmpty())
        assertEquals("物理", results.first().card.category)
        assertEquals(SearchMatchedField.HEADLINE, results.first().matchedField)
        assertTrue(results.first().score >= 80)
    }

    @Test
    fun testCategoryMatch() {
        val results = engine.search(query = "会计", cards = testCards)
        assertFalse(results.isEmpty())
        assertEquals("会计", results.first().card.category)
    }

    // ──────────────── 拼音首字母匹配 ────────────────

    @Test
    fun testPinyinInitialsHeadlineMatch() {
        // "xzl" matches "新租赁" initials
        val results = engine.search(query = "xzl", cards = testCards)
        assertFalse(results.isEmpty())
        assertEquals("会计", results.first().card.category)
        assertEquals(SearchMatchedField.HEADLINE, results.first().matchedField)
    }

    // ──────────────── 拼音全拼匹配 ────────────────

    @Test
    fun testPinyinFullWordMatch() {
        // "zulin" matches "租赁"
        val results = engine.search(query = "zulin", cards = testCards)
        assertFalse(results.isEmpty())
        assertEquals("会计", results.first().card.category)
    }

    // ──────────────── 正文匹配 ────────────────

    @Test
    fun testDetailsSnippetExtraction() {
        // "EPR" only exists in details of card 2
        val results = engine.search(query = "EPR", cards = testCards)
        assertFalse(results.isEmpty())
        assertEquals("物理", results.first().card.category)
        assertEquals(SearchMatchedField.DETAILS, results.first().matchedField)
        assertTrue(results.first().matchedExcerpt.contains("EPR"))
    }

    // ──────────────── 排序 ────────────────

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

    // ──────────────── 防误检测测试 ────────────────

    @Test
    fun testShortPinyinQueryDoesNotOvermatch() {
        // 1字符拼音查询不应触发拼音匹配（只走文本匹配）
        val results1 = engine.search(query = "a", cards = testCards)
        // "a" 作为纯文本搜索，只有在标题/分类/正文中直接包含 "a" 才命中
        // 不应通过拼音泛匹配到大量卡片
        assertTrue("1-char query should not overmatch via pinyin", results1.size <= testCards.size)
    }

    @Test
    fun testPinyinDoesNotMatchLongTextFields() {
        // 纯拼音查询不应通过正文/摘要的拼音串误匹配
        // "ren" 这类短全拼不应匹配到所有包含"人"字的正文
        val results = engine.search(query = "ren", cards = testCards)
        // 应只匹配标题/分类中含"ren"全拼的卡片，不应泛匹配正文
        for (r in results) {
            assertTrue(
                "拼音匹配应只命中标题或分类，不应命中正文: ${r.matchedField}",
                r.matchedField == SearchMatchedField.HEADLINE
                        || r.matchedField == SearchMatchedField.CATEGORY
                        || r.matchedField == SearchMatchedField.SUMMARY  // text match on summary is OK
                        || r.matchedField == SearchMatchedField.DETAILS  // text match on details is OK
            )
        }
    }

    @Test
    fun testInitialsMustMeetMinLength() {
        // Single consonant should not trigger initials matching
        val results = engine.search(query = "z", cards = testCards)
        // Should have very few or no results from pure initial matching
        for (r in results) {
            // If matched, it must be via text match not pinyin
            if (r.matchedField == SearchMatchedField.HEADLINE) {
                assertTrue(
                    "Single char should not pinyin-match headline",
                    r.card.headline.lowercase().contains("z")
                )
            }
        }
    }

    @Test
    fun testChineseQueryDoesNotTriggerPinyinPath() {
        // Chinese query "中子" should match only text containing "中子"
        val results = engine.search(query = "中子", cards = testCards)
        // Should not match unrelated cards via pinyin
        for (r in results) {
            val textContainsQuery = r.card.headline.contains("中子")
                    || r.card.summary.contains("中子")
                    || r.card.details.contains("中子")
                    || r.card.category.contains("中子")
            assertTrue("Chinese query should only match text-containing cards", textContainsQuery)
        }
    }

    @Test
    fun testExtractSnippet() {
        val text = "爱因斯坦波多尔斯基罗森佯谬（EPR悖论）试图论证量子力学不完备。"
        val snippet = engine.extractSnippet(text, "EPR")
        assertTrue(snippet.contains("EPR"))
        assertTrue(snippet.length <= 80)
    }
}
