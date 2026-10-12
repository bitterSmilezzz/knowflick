package com.knowflick.app.data

import com.knowflick.app.ai.CardChatSession
import java.io.File
import java.io.FileOutputStream
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/**
 * 知识卡片追问会话本地存储与进程内缓存（对齐 macOS ChatSessionStore + Storage 契约）：
 * 1. 本地文件：`chat_sessions.json`，原子写与安全读取；
 * 2. 进程内缓存：命中即直接返回，避免主线程反复读盘；
 * 3. 墓碑机制（clearedCardIds）：清除会话立即置位，防止异步迟到的读盘复活已清除的历史；
 * 4. 空会话防膨胀（P3-2）：空消息会话坚决不落盘，防止随着卡片点击量无谓放大 JSON。
 */
class ChatSessionStorage(private val baseDir: File) {

    init {
        baseDir.mkdirs()
    }

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    private val sessionsFile: File get() = File(baseDir, "chat_sessions.json")

    /** 刚被清除的会话卡 ID 墓碑：读盘时以此为准，防止旧会话复活 */
    private val clearedCardIds: MutableSet<String> = Collections.synchronizedSet(HashSet())

    /** 进程内会话缓存 */
    private val sessionCache = ConcurrentHashMap<String, CardChatSession>()

    /**
     * 加载指定卡片的追问会话。
     * 若命中内存墓碑返回 null；若命中内存缓存直接返回；未命中则从磁盘读取。
     */
    @Synchronized
    fun loadSession(cardId: String): CardChatSession? {
        if (clearedCardIds.contains(cardId)) {
            return null
        }
        sessionCache[cardId]?.let { return it }

        val diskSessions = loadDiskSessions()
        val session = diskSessions[cardId]
        if (session != null && !clearedCardIds.contains(cardId)) {
            sessionCache[cardId] = session
            return session
        }
        return null
    }

    /**
     * 保存追问会话。
     * 空会话（无任何消息）不落盘，避免文件无节制膨胀与覆盖真实磁盘数据。
     */
    @Synchronized
    fun saveSession(session: CardChatSession): Boolean {
        if (session.messages.isEmpty()) {
            return true
        }
        clearedCardIds.remove(session.cardId)
        sessionCache[session.cardId] = session

        val diskSessions = loadDiskSessions().toMutableMap()
        diskSessions[session.cardId] = session

        return persistDiskSessions(diskSessions.values.toList())
    }

    /**
     * 清空指定卡片的追问历史。
     * 立即记录内存墓碑、清除缓存，并从磁盘删除。
     */
    @Synchronized
    fun clearSession(cardId: String): Boolean {
        clearedCardIds.add(cardId)
        sessionCache.remove(cardId)

        val diskSessions = loadDiskSessions().toMutableMap()
        if (diskSessions.remove(cardId) != null) {
            return persistDiskSessions(diskSessions.values.toList())
        }
        return true
    }

    /** 供测试断言当前缓存情况 */
    fun getCachedSession(cardId: String): CardChatSession? = sessionCache[cardId]

    private fun loadDiskSessions(): Map<String, CardChatSession> {
        val bytes = readFileSafe(sessionsFile) ?: return emptyMap()
        return runCatching {
            val list = json.decodeFromString(ListSerializer(CardChatSession.serializer()), bytes.decodeToString())
            list.associateBy { it.cardId }
        }.getOrDefault(emptyMap())
    }

    private fun persistDiskSessions(sessions: List<CardChatSession>): Boolean {
        val data = try {
            json.encodeToString(ListSerializer(CardChatSession.serializer()), sessions).toByteArray(Charsets.UTF_8)
        } catch (_: Exception) {
            return false
        }
        return atomicWrite(sessionsFile, data) == null
    }

    private fun atomicWrite(target: File, data: ByteArray): String? {
        if (!baseDir.exists() && !baseDir.mkdirs()) return "无法创建存储目录"
        val temp = File(baseDir, ".${target.name}.${java.util.UUID.randomUUID()}.tmp")
        return try {
            FileOutputStream(temp).use { stream ->
                stream.write(data)
                stream.flush()
                stream.fd.sync()
            }
            try {
                Files.move(
                    temp.toPath(),
                    target.toPath(),
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING,
                )
            } catch (_: AtomicMoveNotSupportedException) {
                Files.move(temp.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING)
            }
            null
        } catch (e: Exception) {
            e.message ?: "未知写入失败"
        } finally {
            if (temp.exists()) temp.delete()
        }
    }

    private fun readFileSafe(file: File): ByteArray? = try {
        if (file.exists() && file.isFile) file.readBytes() else null
    } catch (_: Exception) {
        null
    }
}
