package com.knowflick.app.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 卡堆状态机：镜像 macOS AppStoreTests 的核心承诺 */
class CardStoreTest {
    private fun card(headline: String, category: String = "物理") =
        KnowledgeCard.create(category, headline, "摘要", "正文", source = CardSource.SEED)

    @Test
    fun sourceSwitchesRespectAllFourCombinations() {
        val store = CardStore(seedCards = emptyList())
        val seed = card("种子")
        val ai = KnowledgeCard.create("AI", "人工智能卡", "摘要", "正文", source = CardSource.AI)
        val imported = KnowledgeCard.create("学习方法", "导入卡", "摘要", "正文", source = CardSource.IMPORTED)
        store.replaceAll(listOf(seed, ai, imported))

        for (seedEnabled in listOf(true, false)) {
            for (aiEnabled in listOf(true, false)) {
                store.enableSeed = seedEnabled
                store.enableAI = aiEnabled
                store.recompute()
                val visible = store.deck.map { it.id }.toSet()
                assertEquals(seedEnabled, seed.id in visible, "seed=$seedEnabled ai=$aiEnabled")
                assertEquals(aiEnabled, ai.id in visible, "seed=$seedEnabled ai=$aiEnabled")
                // 口径与 macOS 一致：任一开关关闭时导入卡不出现（两者全开才可见）
                assertEquals(seedEnabled && aiEnabled, imported.id in visible, "imported seed=$seedEnabled ai=$aiEnabled")
            }
        }
    }

    @Test
    fun preferredCategoriesFallBackWhenExhausted() {
        val store = CardStore(seedCards = emptyList())
        val physics = card("物理卡", category = "物理")
        val chemistry = card("化学卡", category = "化学")
        store.replaceAll(listOf(physics, chemistry))

        store.preferredCategories = setOf("物理")
        store.recompute()
        assertEquals(listOf(physics.id), store.deck.map { it.id })

        // 偏好刷完（右划）→ 回退全部；撤销 → 卡片回队首
        store.swipe(physics, SwipeDirection.RIGHT)
        assertEquals(listOf(chemistry.id), store.deck.map { it.id })

        store.undoLastSwipe()
        assertEquals(listOf(physics.id), store.deck.map { it.id })
        assertNull(store.cards.first { it.id == physics.id }.seenAt)
    }

    @Test
    fun swipeRightDrivesFavoriteAndLeftRemovesIt() {
        val store = CardStore(seedCards = emptyList())
        val subject = card("收藏解耦")
        store.replaceAll(listOf(subject, card("其他")))

        store.swipe(subject, SwipeDirection.RIGHT)
        val liked = store.cards.first { it.id == subject.id }
        assertTrue(liked.isFavorite)
        assertEquals(SwipeDirection.RIGHT, liked.swiped)

        store.swipe(liked.copy(seenAt = liked.seenAt, swiped = SwipeDirection.RIGHT), SwipeDirection.LEFT)
        val disliked = store.cards.first { it.id == subject.id }
        assertFalse(disliked.isFavorite, "左划应移出收藏")
        assertEquals(SwipeDirection.LEFT, disliked.swiped)
        assertTrue(store.history.first().seenAt != null)
    }

    @Test
    fun toggleFavoriteDoesNotTouchSwipeOrSeenAt() {
        val store = CardStore(seedCards = emptyList())
        val unread = card("未读收藏")
        store.replaceAll(listOf(unread, card("其他")))

        store.toggleFavorite(unread)
        val favorited = store.cards.first { it.id == unread.id }
        assertTrue(favorited.isFavorite)
        assertNull(favorited.seenAt, "收藏未读卡不应计为已浏览")
        assertNull(favorited.swiped)
        assertFalse(store.deck.isEmpty(), "收藏未读卡仍在卡堆")

        store.toggleFavorite(favorited)
        val unfavorited = store.cards.first { it.id == unread.id }
        assertFalse(unfavorited.isFavorite)
    }

    @Test
    fun swipeOnSeenCardPreservesSeenAt() {
        val store = CardStore(seedCards = emptyList())
        val seen = card("已读卡").copy(seenAt = 1_000L, swiped = SwipeDirection.RIGHT)
        store.replaceAll(listOf(seen, card("其他")))

        // 历史页打标签：不应重写 seenAt、把卡片顶到时间线顶部
        store.swipe(seen, SwipeDirection.LEFT)
        val updated = store.cards.first { it.id == seen.id }
        assertEquals(1_000L, updated.seenAt)
        assertEquals(SwipeDirection.LEFT, updated.swiped)
    }

    @Test
    fun deckKeepsOrderButRefreshesCardValues() {
        val store = CardStore(seedCards = emptyList())
        val a = card("甲")
        val b = card("乙")
        store.replaceAll(listOf(a, b))
        val originalOrder = store.deck.map { it.id }

        // 外部改值（如测验评分）后，卡堆保序并取最新卡值
        store.recordQuizResult(a.id, masteryLevel = 2)
        assertEquals(originalOrder, store.deck.map { it.id })
        assertEquals(1, store.deck.first { it.id == a.id }.reviewCount)
    }

    @Test
    fun clearHistoryResetsProgressButKeepsFavorites() {
        val store = CardStore(seedCards = emptyList())
        val favorited = card("收藏保留").copy(seenAt = 1_000L, swiped = SwipeDirection.RIGHT, isFavorite = true, favoritedAt = 1_100L)
        store.replaceAll(listOf(favorited, card("未读")))

        store.clearHistory()
        val reset = store.cards.first { it.id == favorited.id }
        assertNull(reset.seenAt)
        // 口径与 macOS 一致：清空历史重置 seenAt，但保留 swiped（下次刷卡覆写）与收藏
        assertEquals(SwipeDirection.RIGHT, reset.swiped)
        assertTrue(reset.isFavorite, "收藏阁是显式沉淀内容，不因重置丢失")
    }

    @Test
    fun addCardsDeduplicatesByNormalizedHeadline() {
        val store = CardStore(seedCards = emptyList())
        store.replaceAll(listOf(card("沉没成本不是成本")))
        val added = store.addCards(
            listOf(
                card("沉没成本，不是成本！"),   // 归一化后相同 → 去重
                card("全新的知识"),
            ),
        )
        assertEquals(1, added)
        assertEquals(2, store.cards.size)
    }

    @Test
    fun recordQuizResultCountsEverySubmission() {
        val store = CardStore(seedCards = emptyList())
        val subject = card("复习卡")
        store.replaceAll(listOf(subject))

        store.recordQuizResult(subject.id, masteryLevel = 0)
        var updated = store.cards.first { it.id == subject.id }
        assertEquals(1, updated.reviewCount)
        assertEquals(0, updated.masteryLevel)

        store.recordQuizResult(subject.id, masteryLevel = 2)
        updated = store.cards.first { it.id == subject.id }
        assertEquals(2, updated.reviewCount)
        assertEquals(2, updated.masteryLevel)
    }

    @Test
    fun restoreArchiveMergesByHeadlineAndPreservesProgress() {
        val store = CardStore(seedCards = emptyList())
        val localSeed = card("跨设备恢复")
        store.replaceAll(listOf(localSeed))
        val archived = localSeed.copy(
            id = "OTHER-DEVICE-ID",
            source = CardSource.AI,
            seenAt = 1_700_000_000_000L,
            swiped = SwipeDirection.RIGHT,
            isFavorite = true,
            favoritedAt = 1_700_000_001_000L,
            reviewCount = 5,
            masteryLevel = 2,
            lastReviewedAt = 1_700_000_002_000L,
        )

        val result = store.restoreArchive(listOf(archived))

        assertEquals(0, result.added)
        assertEquals(1, result.restored)
        val restored = store.cards.single()
        assertEquals(localSeed.id, restored.id, "匹配本机卡时保留本机稳定 id")
        assertEquals(CardSource.AI, restored.source)
        assertEquals(archived.seenAt, restored.seenAt)
        assertEquals(archived.swiped, restored.swiped)
        assertTrue(restored.isFavorite)
        assertEquals(5, restored.reviewCount)
        assertEquals(2, restored.masteryLevel)
        assertEquals(archived.lastReviewedAt, restored.lastReviewedAt)
    }

    @Test
    fun restoreArchiveKeepsLocalStudyStateWhenArchiveOmitsIt() {
        val store = CardStore(seedCards = emptyList())
        val local = card("本机已收藏已浏览").copy(
            seenAt = 1_700_000_000_000L,
            swiped = SwipeDirection.RIGHT,
            isFavorite = true,
            favoritedAt = 1_700_000_001_000L,
            reviewCount = 3,
            masteryLevel = 2,
        )
        store.replaceAll(listOf(local))
        // 旧版导出的归档：同一张卡，但缺少收藏与学习状态字段
        val archived = local.copy(
            id = "OTHER-DEVICE-ID",
            seenAt = null,
            swiped = null,
            isFavorite = false,
            favoritedAt = null,
            reviewCount = 0,
            masteryLevel = 0,
            lastReviewedAt = null,
        )

        val result = store.restoreArchive(listOf(archived))

        assertEquals(1, result.restored)
        val merged = store.cards.single()
        assertTrue(merged.isFavorite, "归档缺 isFavorite 时不应清空本机收藏")
        assertEquals(1_700_000_000_000L, merged.seenAt, "归档缺 seenAt 时不应把已浏览卡放回卡堆")
        assertEquals(3, merged.reviewCount, "复习次数应保留较大值")
        assertEquals(2, merged.masteryLevel, "熟练度应保留较大值")
        assertEquals(0, store.deck.size, "已浏览卡不应因导入而回到卡堆")
        assertEquals(1, store.favorites.size, "收藏应继续留在收藏阁")
    }

    @Test
    fun restoreArchiveKeepsNewCardIdentityAndRejectsBlankHeadline() {
        val store = CardStore(seedCards = emptyList())
        store.replaceAll(listOf(card("已有卡")))
        val archived = KnowledgeCard.create("AI", "归档新卡", "摘要", "正文", source = CardSource.AI)
            .copy(id = "ARCHIVE-STABLE-ID")
        val blank = archived.copy(id = "BLANK-ID", headline = "  ")

        val result = store.restoreArchive(listOf(archived, blank))

        assertEquals(1, result.added)
        assertEquals(0, result.restored)
        assertEquals(1, result.ignored)
        assertEquals("ARCHIVE-STABLE-ID", store.cards.first().id)
    }
}
