package com.knowflick.app.sync

import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.CardStore
import com.knowflick.app.domain.KnowledgeCard
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncEngineTest {

    private fun createCard(id: String, headline: String) = KnowledgeCard(
        id = id,
        category = "测试",
        headline = headline,
        summary = "测试摘要",
        details = "测试详情",
        links = emptyList(),
        source = CardSource.SEED,
        createdAt = System.currentTimeMillis(),
    )

    @Test
    fun testLocalSyncServerAndClient() = runBlocking {
        val serverCards = mutableListOf(
            createCard("s1", "服务端卡片1"),
            createCard("s2", "服务端卡片2"),
        )

        val server = SyncServer(
            accessCode = "123456",
            getCards = { serverCards },
            onReceiveCards = { incoming ->
                serverCards.addAll(incoming)
                CardStore.ArchiveRestoreResult(added = incoming.size, restored = 0, ignored = 0)
            }
        )

        val startResult = server.start(preferredPort = 9188)
        assertTrue(startResult.isSuccess)
        val port = startResult.getOrThrow()
        assertTrue(server.isRunning)

        try {
            // 1. 测试探测信息
            val infoResult = SyncClient.fetchRemoteInfo("127.0.0.1:$port#123456")
            assertTrue("Fetch remote info should succeed", infoResult.isSuccess)
            val info = infoResult.getOrThrow()
            assertEquals(2, info.cardCount)

            // 2. 测试双向同步
            val clientCards = listOf(
                createCard("c1", "客户端卡片1")
            )
            val localApplied = mutableListOf<KnowledgeCard>()
            val syncResult = SyncClient.executeBidirectionalSync(
                target = "127.0.0.1:$port#123456",
                localCards = clientCards,
                onApplyRemoteCards = { remote ->
                    localApplied.addAll(remote)
                    CardStore.ArchiveRestoreResult(added = remote.size, restored = 0, ignored = 0)
                }
            )

            assertTrue("Bidirectional sync should succeed", syncResult.isSuccess)
            val result = syncResult.getOrThrow()
            assertEquals(1, result.pushedCount)
            assertEquals(2, result.pulledCount)
            assertEquals(2, localApplied.size)
            assertEquals(3, serverCards.size)
        } finally {
            server.stop()
        }
    }

    @Test
    fun testPairingCodeIsRequired() = runBlocking {
        val server = SyncServer(
            accessCode = "654321",
            getCards = { emptyList() },
            onReceiveCards = { CardStore.ArchiveRestoreResult(0, 0, 0) },
        )
        val port = server.start(preferredPort = 9193).getOrThrow()
        try {
            val missing = SyncClient.fetchRemoteInfo("127.0.0.1:$port")
            assertTrue(missing.isFailure)

            val wrong = SyncClient.fetchRemoteInfo("127.0.0.1:$port#111111")
            assertTrue(wrong.isFailure)
            assertTrue(wrong.exceptionOrNull()?.message?.contains("配对码错误") == true)

            val valid = SyncClient.fetchRemoteInfo("127.0.0.1:$port#654321")
            assertTrue(valid.isSuccess)
        } finally {
            server.stop()
        }
    }

    @Test
    fun testFieldLevelMergeCommutative() {
        val cardId = "test-card-1"
        val t1 = 1000L
        val t2 = 2000L
        val t3 = 3000L

        // 设备 A：在 t2 收藏了卡片，复习了 1 次（熟练度 1）
        val cardA = KnowledgeCard(
            id = cardId,
            category = "物理",
            headline = "量子纠缠",
            summary = "幽灵般的超距作用",
            details = "爱因斯坦称之为幽灵般的超距作用...",
            links = emptyList(),
            source = CardSource.SEED,
            createdAt = t1,
            seenAt = t2,
            swiped = com.knowflick.app.domain.SwipeDirection.RIGHT,
            isFavorite = true,
            favoritedAt = t2,
            reviewCount = 1,
            masteryLevel = 1,
            lastReviewedAt = t2,
            repetition = 1,
            intervalDays = 3,
            easeFactor = 2.5,
        )

        // 设备 B：未收藏，但在更晚的 t3 进行了第二次复习（熟练度 2，掌握）
        val cardB = KnowledgeCard(
            id = cardId,
            category = "物理",
            headline = "量子纠缠",
            summary = "幽灵般的超距作用",
            details = "爱因斯坦称之为幽灵般的超距作用...",
            links = emptyList(),
            source = CardSource.SEED,
            createdAt = t1,
            seenAt = t3,
            swiped = com.knowflick.app.domain.SwipeDirection.SKIP,
            isFavorite = false,
            favoritedAt = null,
            reviewCount = 2,
            masteryLevel = 2,
            lastReviewedAt = t3,
            repetition = 2,
            intervalDays = 7,
            easeFactor = 2.6,
        )

        val mergedAB = CardStore.mergeCard(cardA, cardB)
        val mergedBA = CardStore.mergeCard(cardB, cardA)

        // 验证对称性：merge(A, B) == merge(B, A)
        assertEquals(mergedAB, mergedBA)

        // 验证字段级智能合并结果：
        // 1. 收藏：A 端收藏了，保留收藏，favoritedAt 为 t2
        assertTrue(mergedAB.isFavorite)
        assertEquals(t2, mergedAB.favoritedAt)
        // 2. 浏览足迹：取最新的 t3
        assertEquals(t3, mergedAB.seenAt)
        // 3. 复习次数：取最大值 2
        assertEquals(2, mergedAB.reviewCount)
        // 4. 记忆模型与熟练度：B 端在 t3 复习更新，继承 B 端的熟练度 2 与排程参数
        assertEquals(2, mergedAB.masteryLevel)
        assertEquals(t3, mergedAB.lastReviewedAt)
        assertEquals(2, mergedAB.repetition)
        assertEquals(7, mergedAB.intervalDays)
        assertEquals(2.6, mergedAB.easeFactor, 0.001)
    }

    @Test
    fun testRestoreArchiveUpgradesExistingCards() {
        val store = CardStore()
        val cardId = "card-123"
        val t1 = 1000L
        val t2 = 2000L

        val localCard = KnowledgeCard(
            id = cardId,
            category = "计算机",
            headline = "图灵完备",
            summary = "计算模型理论",
            details = "图灵机是计算的抽象模型",
            links = emptyList(),
            source = CardSource.SEED,
            createdAt = t1,
            seenAt = t1,
            isFavorite = false,
            reviewCount = 0,
            masteryLevel = 0,
        )
        store.replaceAll(listOf(localCard))

        val remoteCard = KnowledgeCard(
            id = cardId,
            category = "计算机",
            headline = "图灵完备",
            summary = "计算模型理论",
            details = "图灵机是计算的抽象模型",
            links = emptyList(),
            source = CardSource.SEED,
            createdAt = t1,
            seenAt = t2,
            isFavorite = true,
            favoritedAt = t2,
            reviewCount = 1,
            masteryLevel = 2,
            lastReviewedAt = t2,
        )

        val newCard = KnowledgeCard(
            id = "card-456",
            category = "哲学",
            headline = "忒修斯之船",
            summary = "同一性悖论",
            details = "当所有木板都被替换...",
            links = emptyList(),
            source = CardSource.SEED,
            createdAt = t1,
        )

        val result = store.restoreArchive(listOf(remoteCard, newCard))

        assertEquals(1, result.added)
        assertEquals(1, result.restored)
        assertEquals(0, result.ignored)
        assertEquals(2, store.cards.size)

        val updatedLocal = store.cards.first { it.id == cardId }
        assertTrue(updatedLocal.isFavorite)
        assertEquals(2, updatedLocal.masteryLevel)
        assertEquals(1, updatedLocal.reviewCount)
    }
}
