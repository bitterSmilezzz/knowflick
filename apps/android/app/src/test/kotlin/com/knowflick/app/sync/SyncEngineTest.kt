package com.knowflick.app.sync

import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.CardStore
import com.knowflick.app.domain.KnowledgeCard
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
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
            onReceiveCards = { incoming, _ ->
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
            // 协议 v2 握手（SYNC_PROTOCOL.md §2）：/api/info 必须带 protocolVersion
            assertEquals(2, info.protocolVersion)

            // 2. 测试双向同步
            val clientCards = listOf(
                createCard("c1", "客户端卡片1")
            )
            val localApplied = mutableListOf<KnowledgeCard>()
            val syncResult = SyncClient.executeBidirectionalSync(
                target = "127.0.0.1:$port#123456",
                localCards = clientCards,
                onApplyRemoteCards = { remote, _ ->
                    localApplied.addAll(remote)
                    CardStore.ArchiveRestoreResult(added = remote.size, restored = 0, ignored = 0)
                }
            )

            assertTrue("Bidirectional sync should succeed", syncResult.isSuccess)
            val result = syncResult.getOrThrow()
            assertEquals(1, result.pushedCount)
            assertEquals(2, result.pulledCount)
            // 协议版本随同步结果上浮（SYNC_PROTOCOL.md §2）
            assertEquals(2, result.peerProtocolVersion)
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
            onReceiveCards = { _, _ -> CardStore.ArchiveRestoreResult(0, 0, 0) },
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
    fun testCancelledSyncRethrowsInsteadOfFakeFailure() = runBlocking {
        val outcome = CompletableDeferred<String>()
        val job = launch(start = CoroutineStart.UNDISPATCHED) {
            try {
                val result = SyncClient.executeBidirectionalSync(
                    target = "127.0.0.1:1#123456",
                    localCards = emptyList(),
                    onApplyRemoteCards = { _, _ -> CardStore.ArchiveRestoreResult(0, 0, 0) },
                )
                outcome.complete("returned:$result")
            } catch (cancelled: CancellationException) {
                outcome.complete("rethrown")
            } catch (e: Exception) {
                outcome.complete("swallowed:$e")
            }
        }
        // UNDISPATCHED 已把协程推进到第一个挂起点（withContext(IO)）；此刻取消，
        // 取消必须以 CancellationException 原样上抛，而不是被包成 Result.failure 假错误
        job.cancel()
        assertEquals("rethrown", outcome.await())
    }

    @Test
    fun testAbnormalAcceptFailureSurfacesToCallback() = runBlocking {
        val reported = CompletableDeferred<Throwable>()
        val server = SyncServer(
            accessCode = "123456",
            getCards = { emptyList() },
            onReceiveCards = { _, _ -> CardStore.ArchiveRestoreResult(0, 0, 0) },
            onAbnormallyStopped = { reported.complete(it) },
        )
        server.start(preferredPort = 9195).getOrThrow()
        try {
            // 不经 stop() 直接关监听 socket：模拟 fd 耗尽等 accept 带病退出
            server.closeListenerForTest()
            val error = kotlinx.coroutines.withTimeoutOrNull(2_000) { reported.await() }
            assertNotNull("accept 带病退出必须上浮到 onAbnormallyStopped", error)
            assertTrue("带病退出后 isRunning 必须翻假，UI 不能继续显示已启动", !server.isRunning)
        } finally {
            server.stop()
        }
    }

    @Test
    fun testNormalStopDoesNotFireAbnormalCallback() = runBlocking {
        val reported = CompletableDeferred<Throwable>()
        val server = SyncServer(
            accessCode = "123456",
            getCards = { emptyList() },
            onReceiveCards = { _, _ -> CardStore.ArchiveRestoreResult(0, 0, 0) },
            onAbnormallyStopped = { reported.complete(it) },
        )
        server.start(preferredPort = 9196).getOrThrow()
        server.stop()
        assertTrue(!server.isRunning)
        val fired = kotlinx.coroutines.withTimeoutOrNull(300) { reported.await() }
        assertNull("正常 stop() 不得触发异常停止回调", fired)    }

    @Test
    fun testGarbageRequestDoesNotKillServer() = runBlocking {
        val server = SyncServer(
            accessCode = "123456",
            getCards = { listOf(createCard("s1", "服务端卡片")) },
            onReceiveCards = { _, _ -> CardStore.ArchiveRestoreResult(0, 0, 0) },
        )
        val port = server.start(preferredPort = 9197).getOrThrow()
        try {
            // ① 非 HTTP 垃圾字节：连接被关闭或收到 4xx，服务端必须存活
            val garbage = exchange(port, "门柱从王维处\r\n\r\n".toByteArray())
            assertTrue(
                "垃圾请求应被关闭或回 4xx，实际：$garbage",
                garbage == null || garbage.startsWith("HTTP/1.1 4"),
            )

            // ② 超长请求头（>8KB）：可归因于解析失败，应回 400
            val bigHeader = "GET /api/info HTTP/1.1\r\nX-Big: ${"a".repeat(9000)}\r\n\r\n"
            val oversized = exchange(port, bigHeader.toByteArray())
            assertTrue(
                "超长请求头应回 400，实际：${oversized?.lineSequence()?.first()}",
                oversized?.startsWith("HTTP/1.1 400") == true,
            )

            // ③ 声明 Content-Length 但正文截断（半关闭写端模拟对端中断）：
            // 服务端读到不完整正文应回 400，而不是挂着等满 500 字节
            val truncated = exchange(
                port,
                (
                    "POST /api/cards HTTP/1.1\r\n" +
                        "${SyncServer.AUTH_HEADER}: 123456\r\n" +
                        "Content-Length: 500\r\n\r\n" +
                        "{\"id\":"
                    ).toByteArray(),
                halfClose = true,
            )
            assertTrue(
                "截断正文应回 400，实际：${truncated?.lineSequence()?.first()}",
                truncated?.startsWith("HTTP/1.1 400") == true,
            )

            // ④ 非法 JSON 正文：可归因于请求解析，应回 400
            val badBody = "not-json"
            val badJson = exchange(
                port,
                (
                    "POST /api/cards HTTP/1.1\r\n" +
                        "${SyncServer.AUTH_HEADER}: 123456\r\n" +
                        "Content-Type: application/json\r\n" +
                        "Content-Length: ${badBody.length}\r\n\r\n" +
                        badBody
                    ).toByteArray(),
            )
            assertTrue(
                "非法 JSON 应回 400，实际：${badJson?.lineSequence()?.first()}",
                badJson?.startsWith("HTTP/1.1 400") == true,
            )

            // ⑤ 一连串畸形请求后，服务必须照常应答合法请求
            assertTrue("畸形请求不得让服务停摆", server.isRunning)
            val ok = SyncClient.fetchRemoteInfo("127.0.0.1:$port#123456")
            assertTrue("畸形请求之后合法请求必须照常工作：${ok.exceptionOrNull()}", ok.isSuccess)
        } finally {
            server.stop()
        }
    }

    /** 发送原始字节并读取到对端关闭；无响应（直接关闭）返回 null；halfClose 模拟对端发完即断 */
    private fun exchange(port: Int, request: ByteArray, halfClose: Boolean = false): String? {
        return java.net.Socket().use { socket ->
            socket.connect(java.net.InetSocketAddress("127.0.0.1", port), 3_000)
            socket.soTimeout = 3_000
            socket.getOutputStream().apply {
                write(request)
                flush()
            }
            if (halfClose) socket.shutdownOutput()
            val input = socket.getInputStream()
            val buffer = java.io.ByteArrayOutputStream()
            val chunk = ByteArray(4096)
            while (true) {
                val n = input.read(chunk)
                if (n < 0) break
                buffer.write(chunk, 0, n)
            }
            if (buffer.size() == 0) null else buffer.toString("UTF-8")
        }
    }

    @Test
    fun testCardsEndpointsUseV2Envelope() = runBlocking {
        val serverCards = mutableListOf(createCard("s1", "服务端卡片"))
        val receivedTombstones = mutableListOf<com.knowflick.app.domain.Tombstone>()
        val server = SyncServer(
            accessCode = "123456",
            getCards = { serverCards },
            onReceiveCards = { incoming, tombstones ->
                receivedTombstones.addAll(tombstones)
                serverCards.addAll(incoming)
                CardStore.ArchiveRestoreResult(added = incoming.size, restored = 0, ignored = 0)
            },
        )
        val port = server.start(preferredPort = 9199).getOrThrow()
        try {
            // ① GET 返回 v2 信封（§3）：cards 单卡编码与 v1 一致，墓碑表随信封上浮
            val getResp = exchange(port, rawRequest(port, "GET", "/api/cards"))!!
            assertTrue("实际：${getResp.lineSequence().first()}", getResp.startsWith("HTTP/1.1 200"))
            val getBody = getResp.substringAfter("\r\n\r\n")
            val envelope = com.knowflick.app.domain.CardJson.decodeEnvelope(getBody)
            assertEquals(2, envelope.protocolVersion)
            assertEquals(listOf("s1"), envelope.cards.map { it.id })
            assertEquals(0, envelope.tombstones.size)

            // ② POST v2 信封：墓碑交给合并方，响应带 deleted 计数
            val peerCard = createCard("c1", "客户端卡片")
            val envelopeBody = com.knowflick.app.domain.CardJson.encodeEnvelope(
                listOf(peerCard),
                listOf(com.knowflick.app.domain.Tombstone("dead-1", 1_727_900_001_000)),
            )
            val postResp = exchange(port, rawRequest(port, "POST", "/api/cards", envelopeBody))!!
            assertTrue("实际：${postResp.lineSequence().first()}", postResp.startsWith("HTTP/1.1 200"))
            assertEquals(listOf("dead-1"), receivedTombstones.map { it.id })
            assertTrue(
                "POST 响应应带 deleted 计数，实际：${postResp.substringAfter("\r\n\r\n")}",
                postResp.substringAfter("\r\n\r\n").contains("\"deleted\":0"),
            )
            assertEquals(listOf("s1", "c1"), serverCards.map { it.id })

            // ③ POST v1 裸数组仍被接受（兼容规则）
            val bareBody = com.knowflick.app.domain.CardJson.encodeList(listOf(createCard("c2", "旧端卡片")))
            val bareResp = exchange(port, rawRequest(port, "POST", "/api/cards", bareBody))!!
            assertTrue("v1 裸数组应被接受，实际：${bareResp.lineSequence().first()}", bareResp.startsWith("HTTP/1.1 200"))
            assertEquals(listOf("s1", "c1", "c2"), serverCards.map { it.id })

            // ④ 非法顶层载荷 → 400（解析类失败）
            val badResp = exchange(port, rawRequest(port, "POST", "/api/cards", """{"protocolVersion":2}"""))
            assertTrue("缺 cards 的对象应回 400", badResp?.startsWith("HTTP/1.1 400") == true)
        } finally {
            server.stop()
        }
    }

    private fun rawRequest(port: Int, method: String, path: String, body: String? = null): ByteArray {
        val payload = (body ?: "").toByteArray(Charsets.UTF_8)
        val headers = buildString {
            append("$method $path HTTP/1.1\r\n")
            append("${SyncServer.AUTH_HEADER}: 123456\r\n")
            if (body != null) append("Content-Type: application/json; charset=utf-8\r\n")
            append("Content-Length: ${payload.size}\r\n")
            append("Connection: close\r\n\r\n")
        }
        return headers.toByteArray(Charsets.UTF_8) + payload
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
