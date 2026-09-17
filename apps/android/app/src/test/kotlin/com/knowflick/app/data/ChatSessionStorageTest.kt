package com.knowflick.app.data

import com.knowflick.app.ai.CardChatMessage
import com.knowflick.app.ai.CardChatSession
import com.knowflick.app.ai.MessageSender
import java.io.File
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ChatSessionStorageTest {
    private val baseDir = File(System.getProperty("java.io.tmpdir"), "knowflick-chat-test-" + System.nanoTime())
    private val storage = ChatSessionStorage(baseDir)

    @AfterTest
    fun cleanup() {
        baseDir.deleteRecursively()
    }

    @Test
    fun emptySessionDoesNotPersist() {
        val emptySession = CardChatSession(cardId = "card-1", cardHeadline = "量子力学")
        val success = storage.saveSession(emptySession)
        assertTrue(success)

        val file = File(baseDir, "chat_sessions.json")
        assertTrue(!file.exists(), "空会话不应创建或落盘 chat_sessions.json")
    }

    @Test
    fun roundTripSaveAndLoad() {
        val messages = listOf(
            CardChatMessage(sender = MessageSender.USER, content = "什么是量子纠缠？"),
            CardChatMessage(sender = MessageSender.ASSISTANT, content = "量子纠缠是..."),
        )
        val session = CardChatSession(
            cardId = "card-1",
            cardHeadline = "量子纠缠",
            messages = messages,
        )
        assertTrue(storage.saveSession(session))

        // 验证冷启动读取（新建 storage 实例跳过内存缓存）
        val coldStorage = ChatSessionStorage(baseDir)
        val loaded = coldStorage.loadSession("card-1")
        assertNotNull(loaded)
        assertEquals("card-1", loaded.cardId)
        assertEquals("量子纠缠", loaded.cardHeadline)
        assertEquals(2, loaded.messages.size)
        assertEquals(MessageSender.USER, loaded.messages[0].sender)
        assertEquals("什么是量子纠缠？", loaded.messages[0].content)
        assertEquals(MessageSender.ASSISTANT, loaded.messages[1].sender)
        assertEquals("量子纠缠是...", loaded.messages[1].content)
    }

    @Test
    fun tombstonePreventsResurrection() {
        val session = CardChatSession(
            cardId = "card-1",
            cardHeadline = "黑洞",
            messages = listOf(CardChatMessage(sender = MessageSender.USER, content = "视界是什么？")),
        )
        storage.saveSession(session)
        assertNotNull(storage.loadSession("card-1"))

        storage.clearSession("card-1")
        assertNull(storage.loadSession("card-1"), "清除后内存墓碑应立即拦截，返回 null")

        // 磁盘上也应已被删除
        val coldStorage = ChatSessionStorage(baseDir)
        assertNull(coldStorage.loadSession("card-1"), "磁盘上该卡片记录已被清除")
    }

    @Test
    fun perCardIsolation() {
        val session1 = CardChatSession(
            cardId = "card-1",
            cardHeadline = "卡片1",
            messages = listOf(CardChatMessage(sender = MessageSender.USER, content = "问1")),
        )
        val session2 = CardChatSession(
            cardId = "card-2",
            cardHeadline = "卡片2",
            messages = listOf(CardChatMessage(sender = MessageSender.USER, content = "问2")),
        )
        storage.saveSession(session1)
        storage.saveSession(session2)

        storage.clearSession("card-1")
        assertNull(storage.loadSession("card-1"))

        val loaded2 = storage.loadSession("card-2")
        assertNotNull(loaded2)
        assertEquals("问2", loaded2.messages[0].content)
    }
}
