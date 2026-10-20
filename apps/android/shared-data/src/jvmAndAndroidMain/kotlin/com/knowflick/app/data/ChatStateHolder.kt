package com.knowflick.app.data

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.knowflick.app.ai.AiService
import com.knowflick.app.ai.AiSettings
import com.knowflick.app.ai.CardChatMessage
import com.knowflick.app.ai.CardChatSession
import com.knowflick.app.ai.MessageSender
import com.knowflick.app.domain.KnowledgeCard
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * 卡片 AI 伴学与深度追问的状态持有者（自 KnowFlickViewModel 拆出，与 macOS ChatSessionStore 同构）。
 *
 * 职责边界：会话状态（激活卡 / 当前会话 / 流式标志 / 错误 / 已沉淀消息 id）、
 * 流式任务生命周期、会话持久化时序。卡片入库（追问提炼出新卡）仍由 ViewModel 编排——
 * 那要联动卡堆版本号与落盘调度。
 *
 * KnowFlickViewModel 保留同名转发属性与方法，UI 与测试零改动；
 * **聊天域的新增逻辑应落在这里，不再增长 ViewModel 本体。**
 */
class ChatStateHolder(
    /** 会话 JSON 存取（chat_sessions.json） */
    val storage: ChatSessionStorage,
    private val aiService: AiService,
    private val scope: CoroutineScope,
    private val settingsProvider: () -> AiSettings,
    private val apiKeyProvider: () -> String,
    /**
     * 状态更新用的调度器。**默认 `Dispatchers.Main`（Android 宿主的既有行为）**，
     * 但它必须是可注入的：桌面/纯 JVM 环境（含单测）里根本没有 Main 调度器，
     * 硬编码会让流式回调直接抛 "Module with the Main dispatcher had failed to initialize"，
     * 表现为「回答已经流出来了、isStreaming 却永远不结束」。Compose 快照状态本身线程安全，
     * 桌面传自己的调度器即可。
     */
    private val stateDispatcher: CoroutineContext = Dispatchers.Main,
) {
    var activeCard: KnowledgeCard? by mutableStateOf(null)
        internal set
    var currentSession: CardChatSession? by mutableStateOf(null)
        internal set
    /**
     * 会话消息的读-改-写互斥锁。
     *
     * **为什么需要**：流式增量原先用 `scope.launch(stateDispatcher)` 逐条起协程，
     * 在多线程调度器（桌面端注入 `Dispatchers.Default`）上彼此并行、
     * 与「流结束」块之间也没有先后保证——「完成」可能插在两条增量中间跑，
     * 先把 `isStreaming` 置 false，最后一条增量随后才拼上，表现为「答案被截断」，
     * 且是否触发完全取决于线程调度，是典型的 flaky。
     *
     * 修法：所有消息突变都在这把锁里做；增量在回调里**就地**落锁执行，
     * 保证 `streamCardChat` 返回时全部增量已经拼完，「完成」块天然排在最后。
     */
    private val sessionMutex = Mutex()

    var isStreaming: Boolean by mutableStateOf(false)
        internal set
    var errorMessage: String? by mutableStateOf(null)
        internal set
    var savedMessageIds: Set<String> by mutableStateOf(emptySet())
        internal set

    private var streamJob: Job? = null
    private var loadGeneration = 0

    /** 打开某张卡片的追问面板（对齐 macOS openChat 契约） */
    fun openChat(card: KnowledgeCard) {
        cancelStreaming()
        activeCard = card
        errorMessage = null
        loadGeneration++
        val gen = loadGeneration

        val cached = storage.getCachedSession(card.id)
        if (cached != null) {
            currentSession = cached
            return
        }
        currentSession = CardChatSession(cardId = card.id, cardHeadline = card.headline)
        scope.launch(Dispatchers.IO) {
            val loaded = storage.loadSession(card.id)
            withContext(stateDispatcher) {
                if (loadGeneration == gen && activeCard?.id == card.id) {
                    if (currentSession?.messages.isNullOrEmpty() && loaded != null) {
                        currentSession = loaded
                    }
                }
            }
        }
    }

    /** 关闭追问面板 */
    /**
     * 用给定会话替换当前会话（null = 无会话）。日常流转请走 [openChat] / [sendChatMessage]。
     * 存在的理由：会话恢复（宿主从存储或另一端拿到会话时）与测试构造状态——
     * 刻意**不**把 `currentSession` 的 setter 开放给宿主，否则「谁能改会话状态」这条边界就没了。
     */
    fun restoreSession(session: CardChatSession?) {
        currentSession = session
    }

    fun closeChat() {
        cancelStreaming()
        activeCard = null
    }

    /** 发送追问消息并启动流式接收 */
    fun sendChatMessage(prompt: String) {
        val trimmed = prompt.trim()
        val card = activeCard ?: return
        if (isStreaming || trimmed.isEmpty()) return

        var session = currentSession ?: CardChatSession(cardId = card.id, cardHeadline = card.headline)
        val userMsg = CardChatMessage(sender = MessageSender.USER, content = trimmed)
        val assistantMsgId = java.util.UUID.randomUUID().toString()
        val assistantMsg = CardChatMessage(id = assistantMsgId, sender = MessageSender.ASSISTANT, content = "", isStreaming = true)

        val updatedMessages = session.messages + userMsg + assistantMsg
        session = session.copy(messages = updatedMessages, updatedAt = System.currentTimeMillis())
        currentSession = session

        isStreaming = true
        errorMessage = null

        val historySnapshot = session.messages.dropLast(2)
        val key = apiKeyProvider()

        streamJob?.cancel()
        streamJob = scope.launch(Dispatchers.IO) {
            try {
                aiService.streamCardChat(
                    card = card,
                    history = historySnapshot,
                    userPrompt = trimmed,
                    settings = settingsProvider(),
                    apiKey = key,
                    onDelta = { delta ->
                        // 就地落锁：streamCardChat 的回调是顺序调用的，
                        // 在回调里同步完成突变，返回时增量必然全部就位。
                        runBlocking {
                            sessionMutex.withLock {
                                appendDelta(assistantMsgId, delta)
                            }
                        }
                    },
                )
                sessionMutex.withLock {
                    val current = currentSession
                    val index = current?.messages?.indexOfFirst { it.id == assistantMsgId } ?: -1
                    if (current != null && index >= 0) {
                        val msg = current.messages[index]
                        val list = current.messages.toMutableList()
                        list[index] = msg.copy(isStreaming = false)
                        val finalSession = current.copy(messages = list, updatedAt = System.currentTimeMillis())
                        currentSession = finalSession
                        scope.launch(Dispatchers.IO) {
                            storage.saveSession(finalSession)
                        }
                    }
                    isStreaming = false
                }
            } catch (_: CancellationException) {
                // 协程取消正常终止，保留已产出片段
            } catch (e: Throwable) {
                sessionMutex.withLock {
                    isStreaming = false
                    errorMessage = e.message ?: "AI 追问失败，请重试"
                    val current = currentSession
                    val index = current?.messages?.indexOfFirst { it.id == assistantMsgId } ?: -1
                    if (current != null && index >= 0) {
                        val list = current.messages.toMutableList()
                        if (list[index].content.isEmpty()) {
                            list.removeAt(index)
                        } else {
                            list[index] = list[index].copy(isStreaming = false)
                        }
                        val finalSession = current.copy(messages = list, updatedAt = System.currentTimeMillis())
                        currentSession = finalSession
                        scope.launch(Dispatchers.IO) {
                            storage.saveSession(finalSession)
                        }
                    }
                }
            }
        }
    }

    /** 在锁内把一条增量拼到指定助手消息上（仅 sessionMutex 持有者可调用）。 */
    private fun appendDelta(assistantMsgId: String, delta: String) {
        val current = currentSession ?: return
        val index = current.messages.indexOfFirst { it.id == assistantMsgId }
        if (index < 0) return
        val msg = current.messages[index]
        val list = current.messages.toMutableList()
        list[index] = msg.copy(content = msg.content + delta)
        currentSession = current.copy(messages = list)
    }

    /** 终止当前流式生成（保留已生成的部分回复） */
    fun cancelStreaming() {
        streamJob?.cancel()
        streamJob = null
        isStreaming = false
        val current = currentSession ?: return
        val cleaned = current.messages
            .filterNot { it.isStreaming && it.content.isEmpty() }
            .map { it.copy(isStreaming = false) }
        val updated = current.copy(messages = cleaned, updatedAt = System.currentTimeMillis())
        currentSession = updated
        scope.launch(Dispatchers.IO) {
            storage.saveSession(updated)
        }
    }

    /** 清空当前卡片的追问历史 */
    fun clearCurrentSession() {
        cancelStreaming()
        val card = activeCard ?: return
        currentSession = CardChatSession(cardId = card.id, cardHeadline = card.headline)
        scope.launch(Dispatchers.IO) {
            storage.clearSession(card.id)
        }
    }

    /** 标记某条追问回复已沉淀为新卡（写入由 ViewModel 编排，状态归这里） */
    fun markMessageSaved(messageId: String) {
        savedMessageIds = savedMessageIds + messageId
    }
}
