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

            val valid = SyncClient.fetchRemoteInfo("127.0.0.1:$port#654321")
            assertTrue(valid.isSuccess)
        } finally {
            server.stop()
        }
    }
}
