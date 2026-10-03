package com.knowflick.app.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
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

    // ---------- 撤销上一张（P1-1） ----------

    @Test
    fun undoAvailabilityTracksSwipeAndReset() {
        val store = CardStore(seedCards = emptyList())
        store.replaceAll(listOf(card("甲"), card("乙")))
        assertFalse(store.canUndoLastSwipe, "未刷卡时不可撤销")

        // 划走真实的顶卡（store 内的副本）
        val top = store.deck.first()
        store.swipe(top, SwipeDirection.SKIP)
        assertTrue(store.canUndoLastSwipe, "刷卡后可撤销")

        store.undoLastSwipe()
        assertFalse(store.canUndoLastSwipe, "撤销只能做一次")
        store.undoLastSwipe()   // 二次撤销必须是安全的 no-op
        assertFalse(store.canUndoLastSwipe)
    }

    @Test
    fun undoReturnsCardToDeckTopAndRemovesItFromHistory() {
        val store = CardStore(seedCards = emptyList())
        val subject = card("撤销回顶")
        store.replaceAll(listOf(subject, card("其他")))
        val topId = store.topCard!!.id
        val top = store.cards.first { it.id == topId }

        store.swipe(top, SwipeDirection.LEFT)
        assertNull(store.deck.firstOrNull { it.id == topId }, "划走后不再在卡堆")
        assertEquals(1, store.history.size, "划走后进入历史")

        store.undoLastSwipe()

        assertEquals(topId, store.topCard?.id, "撤销后卡片回到卡堆顶部")
        assertEquals(0, store.history.size, "撤销后卡片离开历史（历史 -1）")
        val restored = store.cards.first { it.id == topId }
        assertNull(restored.seenAt, "seenAt 还原为刷卡前（未读）")
        assertNull(restored.swiped, "swiped 还原为刷卡前（未表达喜好）")
    }

    @Test
    fun undoKeepsFavoriteBecauseFavoriteIsDecoupledFromPreference() {
        val store = CardStore(seedCards = emptyList())
        val subject = card("撤销不清收藏")
        store.replaceAll(listOf(subject, card("其他")))
        val topId = store.topCard!!.id

        // ① 先用 ♥ 显式收藏（不写 seenAt）
        val beforeFavorite = store.cards.first { it.id == topId }
        store.toggleFavorite(beforeFavorite)
        assertTrue(store.cards.first { it.id == topId }.isFavorite)

        // ② 右划（收藏态不变且写入喜好）
        store.swipe(store.cards.first { it.id == topId }, SwipeDirection.RIGHT)
        assertEquals(SwipeDirection.RIGHT, store.cards.first { it.id == topId }.swiped)

        // ③ 撤销：浏览意图被还原，但显式收藏绝不能被顺手取消
        store.undoLastSwipe()
        val restored = store.cards.first { it.id == topId }
        assertTrue(restored.isFavorite, "撤销不得取消用户的显式收藏（收藏与喜好解耦）")
        assertTrue(restored.favoritedAt != null, "favoritedAt 应随收藏一并保留")
        assertNull(restored.swiped)
        assertEquals(1, store.favorites.size, "收藏阁内容不因撤销而丢失")
    }

    @Test
    fun undoAfterLeftSwipeKeepsFavoriteAddedByEarlierRightSwipe() {
        val store = CardStore(seedCards = emptyList())
        store.replaceAll(listOf(card("甲"), card("乙")))
        val topId = store.topCard!!.id

        // 右划加入收藏；再左划（收藏被移除）；撤销左划 → 收藏保持「左划后」的状态
        store.swipe(store.cards.first { it.id == topId }, SwipeDirection.RIGHT)
        assertTrue(store.cards.first { it.id == topId }.isFavorite)
        store.swipe(store.cards.first { it.id == topId }, SwipeDirection.LEFT)
        assertFalse(store.cards.first { it.id == topId }.isFavorite)

        store.undoLastSwipe()
        val restored = store.cards.first { it.id == topId }
        assertFalse(restored.isFavorite, "撤销只还原浏览意图，不还原收藏状态（与 macOS 口径一致）")
        assertEquals(SwipeDirection.RIGHT, restored.swiped, "swiped 还原为上一次刷卡（RIGHT）")
        // 该卡此前已有 seenAt（右划时写入），快照还原后仍是「已读」，不应回到卡堆
        assertNotNull(restored.seenAt, "已读卡的 seenAt 由快照还原，不被硬编码 null 抹掉")
    }

    @Test
    fun undoRestoresPreviousSeenAtForCardTaggedFromHistory() {
        val store = CardStore(seedCards = emptyList())
        val seen = card("历史页打标签").copy(seenAt = 1_000L, swiped = SwipeDirection.RIGHT)
        store.replaceAll(listOf(seen, card("其他")))

        store.swipe(seen, SwipeDirection.LEFT)
        store.undoLastSwipe()

        val restored = store.cards.first { it.id == seen.id }
        assertEquals(1_000L, restored.seenAt, "已读卡再划后撤销，必须还原原 seenAt 而非置 null")
        assertEquals(SwipeDirection.RIGHT, restored.swiped, "swiped 还原为刷卡前的值")
    }


    // ---------- 墓碑合并语义（SYNC_PROTOCOL.md §4，两端同源逐条对齐） ----------

    private fun cardWithId(id: String, headline: String, createdAt: Long, editedAt: Long? = null) =
        KnowledgeCard.create("物理", headline, "摘要", "正文", source = CardSource.SEED, createdAt = createdAt)
            .copy(id = id, editedAt = editedAt)

    @Test
    fun restoreSyncPayloadDeletesLocalCardOlderThanTombstone() {
        // 规则 1：卡片时间戳 ≤ deletedAt → 删除 + 记墓碑（deletedAt 取较大者）
        val store = CardStore(seedCards = emptyList())
        val old = cardWithId("x-1", "旧卡", createdAt = 1_000L)
        store.replaceAll(listOf(old))

        val result = store.restoreSyncPayload(emptyList(), listOf(Tombstone("x-1", 2_000L)))

        assertTrue(store.cards.none { it.id == "x-1" }, "时间戳早于墓碑的本地卡必须被删除")
        assertEquals(1, result.deleted)
        assertEquals(listOf(Tombstone("x-1", 2_000L)), store.tombstones)
    }

    @Test
    fun restoreSyncPayloadDeletesByEditedAtWhenPresent() {
        // §4.3：卡片时间戳取 editedAt 优先，否则 createdAt
        val store = CardStore(seedCards = emptyList())
        val edited = cardWithId("x-2", "编辑过", createdAt = 1_000L, editedAt = 3_000L)
        store.replaceAll(listOf(edited))

        // deletedAt=2000 早于 editedAt=3000 → 保留
        val keep = store.restoreSyncPayload(emptyList(), listOf(Tombstone("x-2", 2_000L)))
        assertEquals(0, keep.deleted)
        assertEquals(1, store.cards.size)

        // deletedAt=4000 晚于 editedAt=3000 → 删除
        store.restoreSyncPayload(emptyList(), listOf(Tombstone("x-2", 4_000L)))
        assertTrue(store.cards.isEmpty())
        assertEquals(4_000L, store.tombstones.single { it.id == "x-2" }.deletedAt, "记墓碑时 deletedAt 取较大者")
    }

    @Test
    fun restoreSyncPayloadKeepsCardNewerThanTombstone() {
        // 规则 1 反向：对端删除后本端又有新编辑/重建 → 保留卡片、忽略墓碑、不记表
        val store = CardStore(seedCards = emptyList())
        val rebuilt = cardWithId("x-3", "重建卡", createdAt = 5_000L)
        store.replaceAll(listOf(rebuilt))

        val result = store.restoreSyncPayload(emptyList(), listOf(Tombstone("x-3", 2_000L)))

        assertEquals(1, store.cards.size, "比墓碑更新的卡片必须保留")
        assertEquals(0, result.deleted)
        assertEquals(emptyList<Tombstone>(), store.tombstones, "未触发删除不得记墓碑")
    }

    @Test
    fun restoreSyncPayloadRejectsCardResistedByLocalTombstone() {
        // 规则 2：本地墓碑 deletedAt ≥ 卡片时间戳 → 拒收（不复活）
        val store = CardStore(seedCards = emptyList())
        store.loadTombstones(listOf(Tombstone("x-4", 2_000L)))

        val result = store.restoreSyncPayload(listOf(cardWithId("x-4", "对端旧卡", createdAt = 1_000L)), emptyList())

        assertTrue(store.cards.isEmpty(), "被墓碑抵抗的卡片不得复活")
        assertEquals(0, result.added)
        assertEquals(1, result.ignored, "拒收卡计入 ignored")
        assertEquals(listOf(Tombstone("x-4", 2_000L)), store.tombstones, "抵抗后墓碑保留")
    }

    @Test
    fun restoreSyncPayloadRevivesCardNewerThanLocalTombstone() {
        // 规则 2 复活分支：deletedAt < 卡片时间戳 → 正常合并并清除本地墓碑
        val store = CardStore(seedCards = emptyList())
        store.loadTombstones(listOf(Tombstone("x-5", 2_000L)))

        val revived = cardWithId("x-5", "复活卡", createdAt = 3_000L)
        val result = store.restoreSyncPayload(listOf(revived), emptyList())

        assertEquals(listOf("x-5"), store.cards.map { it.id })
        assertEquals(1, result.added)
        assertEquals(emptyList<Tombstone>(), store.tombstones, "复活后本地墓碑必须清除")
    }

    @Test
    fun restoreSyncPayloadTombstoneThenNewerCardInSamePayloadConverges() {
        // 同一载荷既带墓碑又带同 id 更新卡：先按规则 1 删旧卡，再按规则 2 以新卡复活
        val store = CardStore(seedCards = emptyList())
        store.replaceAll(listOf(cardWithId("x-6", "旧版本", createdAt = 1_000L)))

        val result = store.restoreSyncPayload(
            listOf(cardWithId("x-6", "新版本", createdAt = 1_000L, editedAt = 5_000L)),
            listOf(Tombstone("x-6", 2_000L)),
        )

        assertEquals(listOf("x-6"), store.cards.map { it.id })
        assertEquals(emptyList<Tombstone>(), store.tombstones, "复活清除墓碑")
        // 规则 1 实际删过本地旧版 → deleted=1；新卡随后按 added 合并（id 复用）
        assertEquals(1, result.deleted, "deleted 仅统计规则 1 实际触发的删除")
        assertEquals(1, result.added)
        assertEquals(0, result.restored)
    }


    // ---------- details 合并冲突（SYNC_PROTOCOL.md §5：修「用户缩短被旧长文覆盖」） ----------

    private fun detailsCard(details: String, editedAt: Long? = null) =
        KnowledgeCard.create("物理", "同一张卡", "摘要", details, source = CardSource.SEED, createdAt = 1_000L)
            .copy(id = "same-id", editedAt = editedAt)

    @Test
    fun detailsConflictNewerEditedAtWinsEvenIfShorter() {
        val a = detailsCard("短", editedAt = 2_000L)
        val b = detailsCard("更长的正文内容", editedAt = 1_000L)

        val merged = CardStore.mergeCard(a, b)

        assertEquals("短", merged.details, "双方均有 editedAt → 新者赢（即使更短）")
        assertEquals(merged, CardStore.mergeCard(b, a), "合并必须对称")
    }

    @Test
    fun detailsConflictFallsBackToLongerWhenEitherEditedAtMissing() {
        val noStamp = detailsCard("短")
        val stampedLong = detailsCard("更长的正文内容", editedAt = 1_000L)

        assertEquals("更长的正文内容", CardStore.mergeCard(noStamp, stampedLong).details, "任一方缺失 editedAt → 沿用 v1 较长者规则")

        val stampedShort = detailsCard("短", editedAt = 2_000L)
        val noStampLong = detailsCard("更长的正文内容")
        assertEquals("更长的正文内容", CardStore.mergeCard(stampedShort, noStampLong).details, "任一方缺失 editedAt → 沿用 v1 较长者规则")
    }

    @Test
    fun detailsConflictEqualEditedAtFallsBackToLonger() {
        val a = detailsCard("短", editedAt = 2_000L)
        val b = detailsCard("更长的正文内容", editedAt = 2_000L)

        assertEquals("更长的正文内容", CardStore.mergeCard(a, b).details, "editedAt 持平退回较长者，保证对称确定")
    }

    @Test
    fun mergedCardCarriesNewestEditedAt() {
        val a = detailsCard("正文", editedAt = 2_000L)
        val b = detailsCard("正文", editedAt = 1_000L)
        assertEquals(2_000L, CardStore.mergeCard(a, b).editedAt)

        val noStamp = detailsCard("正文")
        assertEquals(2_000L, CardStore.mergeCard(a, noStamp).editedAt, "单方有 editedAt 时保留")
        assertNull(CardStore.mergeCard(noStamp, detailsCard("正文")).editedAt, "双方缺失时保持 null")
    }
}
