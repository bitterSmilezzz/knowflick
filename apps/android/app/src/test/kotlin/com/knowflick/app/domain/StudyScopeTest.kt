package com.knowflick.app.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 学习范围与学习地图的纯逻辑测试。
 *
 * 关键契约有两条：范围生效时**接管分类维度**（不再受 preferredCategories 影响），
 * 以及「专学」必须保持导入顺序（不能被背景图防重打散，否则一点点看就断了）。
 */
class StudyScopeTest {

    private fun card(
        id: String,
        category: String,
        headline: String = "标题$id",
        subject: String? = null,
        branch: String? = null,
        level: Int? = null,
        orderKey: String? = null,
        seen: Boolean = false,
        mastery: Int = 0,
    ) = KnowledgeCard(
        id = id,
        category = category,
        headline = headline,
        summary = "摘要",
        details = "正文内容",
        links = emptyList(),
        source = CardSource.SEED,
        createdAt = 1_800_000_000_000L,
        seenAt = if (seen) 1_800_000_900_000L else null,
        masteryLevel = mastery,
        subject = subject,
        branch = branch,
        level = level,
        orderKey = orderKey,
    )

    private fun pool(): List<KnowledgeCard> = listOf(
        card("E1", "英语", subject = "english", branch = "grammar", level = 1, orderKey = "english/grammar/0001"),
        card("E2", "英语", subject = "english", branch = "grammar", level = 2, orderKey = "english/grammar/0002", seen = true),
        card("E3", "英语", subject = "english", branch = "vocabulary", level = 2, orderKey = "english/vocabulary/0001", mastery = 2),
        card("A1", "中级会计", subject = "accounting", branch = "assets", level = 1, orderKey = "accounting/assets/0001"),
        // 同名分支 slug 出现在另一个学科下：复合键必须把它们分开
        card("X1", "冷知识", subject = "trivia", branch = "assets", level = 3, orderKey = "trivia/assets/0001"),
        card("P1", "物理"),   // 未分级
    )

    @Test
    fun subjectScopeIgnoresLegacyCategoryAndKeepsUngradedOut() {
        val scope = StudyScope(subjects = setOf("english"))
        assertEquals(listOf("E1", "E2", "E3"), scope.filter(pool()).map { it.id })
    }

    @Test
    fun branchKeysAreScopedPerSubject() {
        val englishAssets = StudyScope(branches = setOf(StudyScope.branchKey("accounting", "assets")))
        assertEquals(listOf("A1"), englishAssets.filter(pool()).map { it.id })

        val triviaAssets = StudyScope(branches = setOf(StudyScope.branchKey("trivia", "assets")))
        assertEquals(listOf("X1"), triviaAssets.filter(pool()).map { it.id })
    }

    @Test
    fun levelFilterAndMixedSelection() {
        assertEquals(
            listOf("E2", "E3"),
            StudyScope(levels = setOf(2)).filter(pool()).map { it.id },
        )
        val mixed = StudyScope(
            branches = setOf(StudyScope.branchKey("english", "grammar"), StudyScope.branchKey("accounting", "assets")),
        )
        assertEquals(listOf("E1", "E2", "A1"), mixed.filter(pool()).map { it.id })
    }

    @Test
    fun ungradedCardsFormTheirOwnShard() {
        val ungraded = StudyScope(subjects = setOf<String>().let { emptySet() }, branches = setOf(StudyScope.branchKey(null, null)))
        assertEquals(listOf("P1"), ungraded.filter(pool()).map { it.id })
    }

    @Test
    fun sequentialOrderingKeepsImportOrderAndPushesUnorderedToTheEnd() {
        val unordered = card("Z9", "英语", subject = "english", branch = "grammar", level = 1)
        val cards = listOf(unordered, pool()[2], pool()[0], pool()[1])
        val scope = StudyScope(subjects = setOf("english"), branches = setOf(StudyScope.branchKey("english", "grammar")), sequential = true)
        // orderForDeck 只排序不过滤：输入里的 E3（vocabulary/0001）也参与排序
        assertEquals(listOf("E1", "E2", "E3", "Z9"), scope.orderForDeck(cards).map { it.id })
        // 非顺序模式保持原样（由卡堆的防重排布负责打散）
        assertEquals(cards.map { it.id }, scope.copy(sequential = false).orderForDeck(cards).map { it.id })
    }

    @Test
    fun describeReadsLikeAHumanLabel() {
        assertEquals("", StudyScope.None.describe())
        val scope = StudyScope(
            subjects = setOf("english"),
            branches = setOf(StudyScope.branchKey("english", "grammar")),
            levels = setOf(2),
        )
        val text = scope.describe()
        assertEquals("分支标签已含学科前缀，不应再重复学科名", "英语 · 语法、L2 基础", text)
        assertEquals(
            "未分分支的支线圈只显示学科名",
            "会计",
            StudyScope(subjects = setOf("accounting"), branches = setOf(StudyScope.branchKey("accounting", null))).describe(),
        )
        assertEquals("英语", StudyScope(subjects = setOf("english")).describe())
    }

    @Test
    fun subjectProgressOrdersUngradedLastAndCountsProgress() {
        val rows = StudyMap.subjectProgress(pool())
        assertEquals("未分级必须排最后", "未分级", rows.last().name)
        val english = rows.first { it.slug == "english" }
        assertEquals(3, english.total)
        assertEquals(1, english.seen)
        assertEquals(1, english.mastered)
        assertEquals(2, english.branchCount)
    }

    @Test
    fun branchProgressExposesLevelLadderAndNextLevel() {
        val branches = StudyMap.branchProgress(pool(), "english")
        val grammar = branches.first { it.slug == "grammar" }
        assertEquals(2, grammar.total)
        assertEquals(1, grammar.seen)
        assertEquals(listOf(1, 2), grammar.levels.map { it.level })
        // L1 还没学过 → 下一步就是 L1
        assertEquals(1, grammar.nextLevel)

        val vocabulary = branches.first { it.slug == "vocabulary" }
        assertEquals("掌握≠看过：E3 没有 seenAt，下一步仍是它所在难度", 2, vocabulary.nextLevel)

        val finished = StudyMap.branchProgress(
            listOf(card("D1", "英语", subject = "english", branch = "grammar", level = 1, seen = true)),
            "english",
        ).first()
        assertEquals("全部看过的分支不再给下一步", null, finished.nextLevel)
    }

    @Test
    fun remainingCountsOnlyUnseenCards() {
        val scope = StudyScope(subjects = setOf("english"))
        assertEquals(2, StudyMap.remaining(pool(), scope))
    }

    @Test
    fun storeDeckNarrowsToScopeAndTakesOverCategoryPreference() {
        val store = CardStore()
        store.replaceAll(pool())
        store.preferredCategories = setOf("中级会计")
        store.recompute()
        val withPreference = store.deck.map { it.id }
        assertEquals(listOf("A1"), withPreference)

        // 范围生效时接管分类维度：偏好「中级会计」不再起作用
        store.studyScope = StudyScope(subjects = setOf("english"), sequential = true)
        store.recompute()
        assertEquals("卡堆只收未学过的，且严格按导入顺序", listOf("E1", "E3"), store.deck.map { it.id })

        store.studyScope = StudyScope.None
        store.recompute()
        assertEquals(withPreference, store.deck.map { it.id })
    }

    @Test
    fun sequentialScopeSkipsBackgroundAntiCollisionShuffle() {
        val many = (1..14).map { index ->
            card("S$index", "冷知识", subject = "trivia", branch = "assets", orderKey = "trivia/assets/%04d".format(index))
        }
        val store = CardStore()
        store.replaceAll(many)
        store.studyScope = StudyScope(subjects = setOf("trivia"), sequential = true)
        store.recompute()
        assertEquals("顺序模式下必须按导入顺序推进", many.map { it.id }, store.deck.map { it.id })
    }
}
