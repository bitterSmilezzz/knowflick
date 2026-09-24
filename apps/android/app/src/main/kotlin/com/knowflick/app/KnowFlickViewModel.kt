package com.knowflick.app

import android.app.Application
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.knowflick.app.ai.AiError
import com.knowflick.app.ai.AiService
import com.knowflick.app.ai.AiSettings
import com.knowflick.app.data.AppModel
import com.knowflick.app.data.CardStorage
import com.knowflick.app.data.CardPersistenceQueue
import com.knowflick.app.data.CardSaveResult
import com.knowflick.app.ai.CardChatMessage
import com.knowflick.app.ai.CardChatSession
import com.knowflick.app.ai.MessageSender
import com.knowflick.app.data.ChatSessionStorage
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.data.CredentialStore
import com.knowflick.app.data.SeedLoader
import java.io.File
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.CancellationException
import com.knowflick.app.domain.search.KnowledgeSearchEngine
import com.knowflick.app.domain.search.SearchResultItem
import com.knowflick.app.domain.search.SearchSourceFilter
import com.knowflick.app.domain.SwipeDirection
import com.knowflick.app.sync.SyncClient
import com.knowflick.app.sync.SyncResult
import com.knowflick.app.sync.SyncServer
import java.security.SecureRandom

/**
 * 应用级状态持有者：卡库持久化 + 卡堆状态机 + AI 服务。
 * version 自增驱动 Compose 重组；落盘经串行 IO 队列 350ms 节流合并；onPause 非阻塞 flush。
 */
class KnowFlickViewModel(application: Application) : AndroidViewModel(application) {
    val model: AppModel = AppModel(
        storage = CardStorage(File(application.filesDir, "store")),
        seedCards = SeedLoader(application).load(),
    )

    private val credentials: CredentialStore = com.knowflick.app.data.SystemCredentialStore(application)

    /**
     * 凭据存储是否加密（Keystore 可用）。设置页据此显示降级提示条——
     * 降级为明文是安全姿态变化，不能静默发生。
     */
    val credentialsEncrypted: Boolean
        get() = (credentials as? com.knowflick.app.data.SystemCredentialStore)?.isEncrypted ?: true
    private val aiService = AiService(
        versionName = runCatching {
            application.packageManager.getPackageInfo(application.packageName, 0).versionName
        }.getOrNull() ?: "unknown",
    )

    /** 语音播放控制器（三通道 + 磨耳朵） */
    val speech = com.knowflick.app.speech.SpeechController(application)
    var speechSettings by mutableStateOf(com.knowflick.app.speech.SpeechSettings())
        private set

    /** 重组触发器 */
    var version by mutableIntStateOf(0)
        private set

    /** 生成状态 */
    var isGenerating by mutableStateOf(false)
        private set
    var generateNotice by mutableStateOf<String?>(null)
        private set
    var persistenceNotice by mutableStateOf<String?>(null)
        private set

    /** 已保存的设置与密钥 */
    var settings: AiSettings by mutableStateOf(AiSettings())
        private set

    /** 测验会话（null = 未在测验） */
    var quizSession: com.knowflick.app.domain.QuizSession? by mutableStateOf(null)
        private set
    private val quizCycleRatedIds = LinkedHashSet<String>()

    /** 卡片追问会话存储与状态（与 macOS ChatSessionStore 对齐） */
    val chatStorage: ChatSessionStorage = ChatSessionStorage(File(application.filesDir, "store"))
    var activeChatCard: KnowledgeCard? by mutableStateOf(null)
        private set
    var currentChatSession: CardChatSession? by mutableStateOf(null)
        internal set
    var isChatStreaming: Boolean by mutableStateOf(false)
        private set
    var chatErrorMessage: String? by mutableStateOf(null)
        private set
    var savedChatMessageIds: Set<String> by mutableStateOf(emptySet())
        private set

    private var chatStreamJob: Job? = null
    private var chatLoadGeneration = 0

    private var persistJob: Job? = null
    private val persistenceQueue = CardPersistenceQueue(model.storage, ::handlePersistenceResult)

    /** 局域网同步只在用户显式开启时监听；六位配对码防止同网段设备静默读取卡库。 */
    val syncAccessCode: String = (SecureRandom().nextInt(900_000) + 100_000).toString()
    var showSyncSheet by mutableStateOf(false)
        private set
    var isSyncServerRunning by mutableStateOf(false)
        private set
    var syncServerPort by mutableIntStateOf(8998)
        private set
    var syncLocalIp by mutableStateOf<String?>(null)
        private set
    private var syncServer: SyncServer? = null

    init {
        model.bootstrap()
        settings = loadSettings()
        com.knowflick.app.ui.common.AudioEffectHelper.isEnabled = settings.soundEffectsEnabled
        speechSettings = com.knowflick.app.speech.SpeechSettings.fromJson(model.storage.loadSpeechJson() ?: "")
            ?: com.knowflick.app.speech.SpeechSettings()
        applySpeechConfig()
        // 磨耳朵推进：系统跳过当前卡，返回下一张（与 macOS onAmbientAdvanceRequest 同语义）
        speech.onAdvanceRequest = {
            model.store.topCard?.let { current -> model.store.swipe(current, com.knowflick.app.domain.SwipeDirection.SKIP) }
            version++
            schedulePersist()
            model.store.topCard
        }
        speech.onAdvancePreviousRequest = {
            if (model.store.history.isNotEmpty()) {
                model.store.undoLastSwipe()
                version++
                schedulePersist()
                model.store.topCard
            } else {
                null
            }
        }
        speech.onSettingsChanged = { updated ->
            speechSettings = updated
            model.storage.saveSpeechJson(updated.toJson())
        }
    }

    /** 语音控制台沉浸面板显示状态 */
    var showAudioConsole by mutableStateOf(false)
        private set

    fun openAudioConsole() {
        showAudioConsole = true
    }

    fun closeAudioConsole() {
        showAudioConsole = false
    }

    private fun applySpeechConfig() {
        speech.settings = speechSettings
        speech.apiKey = credentials.read("tts.key").orEmpty()
    }

    fun saveSpeechSettings(updated: com.knowflick.app.speech.SpeechSettings, apiKey: String): Boolean {
        val settingsSaved = model.storage.saveSpeechJson(updated.toJson())
        val credentialSaved = if (updated.channelEnum == com.knowflick.app.speech.SpeechChannel.CLOUD && apiKey.isNotBlank()) {
            credentials.save(apiKey, "tts.key")
        } else {
            credentials.delete("tts.key")
        }
        speechSettings = updated
        applySpeechConfig()
        version++
        return settingsSaved && credentialSaved
    }

    fun currentSpeechApiKey(): String = credentials.read("tts.key").orEmpty()

    private fun loadSettings(): AiSettings {
        val loaded = (AiSettings.fromJson(model.storage.loadSettingsJson() ?: "") ?: AiSettings())
            .withMissingPresetDefaults()
        applySettings(loaded)
        return loaded
    }

    private fun applySettings(loaded: AiSettings) {
        // 卡堆口径：来源开关与偏好分类与设置联动
        model.store.enableSeed = loaded.enableSeed
        model.store.enableAI = loaded.enableAI
        model.store.preferredCategories = loaded.preferredCategories.toSet()
        model.store.recompute()
    }

    fun currentApiKey(): String = credentials.read("apiKey").orEmpty()

    fun saveSettings(updated: AiSettings, apiKey: String): Boolean {
        val settingsSaved = model.storage.saveSettingsJson(updated.toJson())
        val credentialSaved = if (AiService.requiresKey(updated.baseURL) && apiKey.isNotBlank()) {
            credentials.save(apiKey, "apiKey")
        } else {
            credentials.delete("apiKey")
        }
        settings = updated
        applySettings(updated)
        version++
        schedulePersist()
        return settingsSaved && credentialSaved
    }

    val currentPaperTheme: com.knowflick.app.ui.PaperTheme
        get() = com.knowflick.app.ui.PaperTheme.fromName(settings.paperTheme)

    fun setPaperTheme(theme: com.knowflick.app.ui.PaperTheme) {
        val updated = settings.copy(paperTheme = theme.name)
        model.storage.saveSettingsJson(updated.toJson())
        settings = updated
        version++
    }

    fun setSoundEffectsEnabled(enabled: Boolean) {
        val updated = settings.copy(soundEffectsEnabled = enabled)
        model.storage.saveSettingsJson(updated.toJson())
        settings = updated
        com.knowflick.app.ui.common.AudioEffectHelper.isEnabled = enabled
        version++
    }

    fun openSyncSheet() {
        syncLocalIp = SyncServer.getLocalIpAddress()
        showSyncSheet = true
    }

    fun closeSyncSheet() {
        showSyncSheet = false
    }

    fun setSyncServerEnabled(enabled: Boolean) {
        if (!enabled) {
            syncServer?.stop()
            syncServer = null
            isSyncServerRunning = false
            return
        }
        if (isSyncServerRunning) return

        val server = SyncServer(
            accessCode = syncAccessCode,
            getCards = {
                withContext(Dispatchers.Main.immediate) { model.store.cards.toList() }
            },
            onReceiveCards = { incoming ->
                withContext(Dispatchers.Main.immediate) {
                    val result = model.store.restoreArchive(incoming)
                    version++
                    schedulePersist()
                    result
                }
            },
        )
        server.start().fold(
            onSuccess = { port ->
                syncServer = server
                syncServerPort = port
                syncLocalIp = SyncServer.getLocalIpAddress()
                isSyncServerRunning = true
            },
            onFailure = { error ->
                server.stop()
                generateNotice = "同步服务启动失败：${error.message ?: "端口不可用"}"
                isSyncServerRunning = false
            },
        )
    }

    fun executeLanSync(target: String, onDone: (Result<SyncResult>) -> Unit) {
        viewModelScope.launch {
            val localSnapshot = model.store.cards.toList()
            val result = SyncClient.executeBidirectionalSync(
                target = target,
                localCards = localSnapshot,
                onApplyRemoteCards = { remote ->
                    val merged = model.store.restoreArchive(remote)
                    version++
                    schedulePersist()
                    merged
                },
            )
            onDone(result)
        }
    }

    /** 连通性测试：返回用户可读状态 */
    suspend fun testConnection(temp: AiSettings, apiKey: String): String {
        return try {
            aiService.ping(temp, apiKey)
            "连接成功，AI 服务可用"
        } catch (e: AiError) {
            e.message ?: "连接失败"
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            "网络错误：${e.message}"
        }
    }

    // ---------- 全局搜索与多维筛选 ----------

    private val searchEngine = KnowledgeSearchEngine()

    var showSearchSheet by mutableStateOf(false)
        private set

    var searchQuery by mutableStateOf("")
        private set

    var searchCategory by mutableStateOf<String?>("全部")
        private set

    var searchSource by mutableStateOf(SearchSourceFilter.ALL)
        private set

    var searchIntent by mutableStateOf<SwipeDirection?>(null)
        private set

    /** 最近搜索历史关键词列表（上限 8 条，LRU 顺序） */
    var searchHistory: List<String> by mutableStateOf(model.storage.loadSearchHistory())
        private set

    fun addSearchHistory(query: String) {
        val trimmed = query.trim()
        if (trimmed.isEmpty()) return
        val list = (listOf(trimmed) + searchHistory.filter { it != trimmed }).take(8)
        searchHistory = list
        viewModelScope.launch(Dispatchers.IO) {
            model.storage.saveSearchHistory(list)
        }
    }

    fun removeSearchHistory(query: String) {
        val list = searchHistory.filter { it != query }
        searchHistory = list
        viewModelScope.launch(Dispatchers.IO) {
            model.storage.saveSearchHistory(list)
        }
    }

    fun clearSearchHistory() {
        searchHistory = emptyList()
        viewModelScope.launch(Dispatchers.IO) {
            model.storage.saveSearchHistory(emptyList())
        }
    }

    fun openSearchSheet() {
        showSearchSheet = true
    }

    fun closeSearchSheet() {
        showSearchSheet = false
    }

    fun updateSearchQuery(query: String) {
        searchQuery = query
    }

    fun updateSearchCategory(category: String?) {
        searchCategory = category
    }

    fun updateSearchSource(source: SearchSourceFilter) {
        searchSource = source
    }

    fun updateSearchIntent(intent: SwipeDirection?) {
        searchIntent = intent
    }

    fun clearSearchFilters() {
        searchQuery = ""
        searchCategory = "全部"
        searchSource = SearchSourceFilter.ALL
        searchIntent = null
    }

    /** 响应式获取当前搜索结果列表 */
    fun getSearchResults(): List<SearchResultItem> {
        val q = searchQuery
        return searchEngine.search(
            query = q,
            category = searchCategory,
            source = searchSource,
            intent = searchIntent,
            cards = model.store.cards,
        )
    }

    /** 搜索结果置顶到卡堆顶并即时持久化 */
    fun promoteCardToDeck(card: KnowledgeCard) {
        model.store.promoteToDeckTop(card)
        version++
        schedulePersist()
    }

    /** 备份与导出 Sheet 开关 */
    var showBackupExportSheet by mutableStateOf(false)
        private set

    fun openBackupExport() {
        showBackupExportSheet = true
    }

    fun closeBackupExport() {
        showBackupExportSheet = false
    }

    /** 导入归档文件探测结果预览（null = 未在预览） */
    var importPreview by mutableStateOf<com.knowflick.app.data.ArchivePreview?>(null)
        private set

    var isInspectingArchive by mutableStateOf(false)
        private set

    /** 从 JSON 归档恢复卡片（逐卡挽救；保留收藏、历史、来源与复习进度） */
    fun importFromJson(text: String) {
        val imported = com.knowflick.app.data.CardFileIO.decodeListSalvaging(text)
        applyImportedCards(imported)
    }

    /** 文件读取和探测放到 IO 线程，智能识别 ZIP 备份包与 JSON 镜像并生成预览。 */
    fun importFromUri(uri: Uri) {
        viewModelScope.launch {
            isInspectingArchive = true
            generateNotice = "正在解析归档文件…"
            val result = withContext(Dispatchers.IO) {
                com.knowflick.app.data.ArchiveImportManager.inspectArchive(getApplication(), uri)
            }
            isInspectingArchive = false
            result.fold(
                onSuccess = { preview ->
                    generateNotice = null
                    importPreview = preview
                },
                onFailure = { err ->
                    generateNotice = "归档读取失败: ${err.message ?: "未知异常"}"
                },
            )
        }
    }

    /**
     * 应用恢复策略将归档载入卡库并持久化保存
     */
    fun applyArchiveRestore(
        preview: com.knowflick.app.data.ArchivePreview,
        strategy: com.knowflick.app.data.RestoreStrategy,
    ) {
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) {
                com.knowflick.app.data.ArchiveImportManager.applyRestore(model.store, preview, strategy)
            }
            if (strategy == com.knowflick.app.data.RestoreStrategy.OVERWRITE && preview.settingsJson != null) {
                val loadedSettings = AiSettings.fromJson(preview.settingsJson)
                if (loadedSettings != null) {
                    settings = loadedSettings
                    applySettings(loadedSettings)
                    model.storage.saveSettingsJson(loadedSettings.toJson())
                }
            }
            generateNotice = when (strategy) {
                com.knowflick.app.data.RestoreStrategy.MERGE -> {
                    "已增量恢复：${result.accepted} 张（新增 ${result.added}，更新 ${result.restored}）✓"
                }
                com.knowflick.app.data.RestoreStrategy.OVERWRITE -> {
                    "已全量覆盖恢复：${preview.totalCards} 张卡片 ✓"
                }
            }
            version++
            schedulePersist()
            importPreview = null
        }
    }

    fun dismissImportPreview() {
        importPreview = null
    }

    private fun applyImportedCards(imported: List<com.knowflick.app.domain.KnowledgeCard>) {
        if (imported.isEmpty()) {
            generateNotice = "无法解析该文件，格式与 KnowFlick 卡片结构不匹配"
            return
        }
        val result = model.store.restoreArchive(imported, insertNewAtTop = true)
        generateNotice = when {
            result.accepted == 0 -> "归档中没有可导入的卡片"
            result.restored > 0 && result.added > 0 -> "已恢复 ${result.restored} 张，新增 ${result.added} 张 ✓"
            result.restored > 0 -> "已恢复 ${result.restored} 张卡片及学习进度 ✓"
            else -> "已导入 ${result.added} 张卡片 ✓"
        }
        version++
        schedulePersist()
    }

    /** AI 生成 count 张新卡并置顶插入（AI 不可用/未配置时静默返回提示） */
    fun generateNewCards(count: Int = 3, topic: String? = null) {
        if (isGenerating) return
        val current = settings
        if (!current.isConfigured) {
            generateNotice = "请先在设置里配置 AI 服务"
            return
        }
        isGenerating = true
        generateNotice = null
        viewModelScope.launch {
            try {
                val cards = aiService.generateCards(
                    settings = current,
                    apiKey = currentApiKey(),
                    count = count,
                    excludeHeadlines = model.store.cards.map { it.headline },
                    topic = topic,
                )
                mutate { model.store.addCards(cards, insertAtTop = true) }
                generateNotice = "已生成 ${cards.size} 张新知识 ✓"
            } catch (e: CancellationException) {
                throw e
            } catch (e: AiError) {
                generateNotice = e.message
            } catch (e: Exception) {
                generateNotice = "网络错误：${e.message}"
            } finally {
                isGenerating = false
            }
        }
    }

    // ---------- 网页剪藏（浏览时随手把文章收进知识库） ----------

    /** 剪藏面板的四个阶段：面板上的按钮可用性与文案都由它驱动 */
    enum class ClipStage { INPUT, FETCHING, READY, EXTRACTING }

    var showClipSheet by mutableStateOf(false)
        private set

    /** 用户粘贴或从浏览器分享来的文本（可能是「正文 + 链接」混排） */
    var clipInput by mutableStateOf("")
        private set

    var clipStage by mutableStateOf(ClipStage.INPUT)
        private set

    var clipDigest by mutableStateOf<com.knowflick.app.domain.WebClipDigest?>(null)
        private set

    var clipNotice by mutableStateOf<String?>(null)
        private set

    /** 失败原因与提示分开：提示是信息（灰色），失败要显眼（橙色），混在一个字段里小屏上会被读成同一种东西 */
    var clipError by mutableStateOf<String?>(null)
        private set

    private var clipJob: kotlinx.coroutines.Job? = null

    /** 打开剪藏面板；带 `sharedText` 时直接开始抓取（分享入口的默认期望是「不用我再点一次」） */
    fun openClipSheet(sharedText: String? = null) {
        showClipSheet = true
        clipNotice = null
        clipError = null
        clipDigest = null
        clipStage = ClipStage.INPUT
        if (!sharedText.isNullOrBlank()) {
            clipInput = sharedText
            runClipFetch()
        }
    }

    fun closeClipSheet() {
        clipJob?.cancel()
        clipJob = null
        showClipSheet = false
        clipStage = ClipStage.INPUT
        clipDigest = null
        clipNotice = null
        clipError = null
    }

    fun updateClipInput(text: String) {
        clipInput = text
        if (clipStage == ClipStage.FETCHING || clipStage == ClipStage.EXTRACTING) return
        clipStage = ClipStage.INPUT
        clipDigest = null
        clipNotice = null
        clipError = null
    }

    /** 抓取并抽正文。网络与解析都在 IO 线程，面板不阻塞 */
    fun runClipFetch() {
        val text = clipInput.trim()
        if (text.isEmpty()) {
            clipError = "先粘贴或分享一个网页链接"
            return
        }
        clipJob?.cancel()
        clipStage = ClipStage.FETCHING
        clipDigest = null
        clipNotice = null
        clipError = null
        clipJob = viewModelScope.launch {
            try {
                val digest = com.knowflick.app.data.WebClipFetcher.clip(text)
                clipDigest = digest
                clipStage = ClipStage.READY
                clipNotice = if (digest.truncated) "正文较长，已按行截取前 ${digest.text.length} 字用于提炼" else null
            } catch (e: CancellationException) {
                throw e
            } catch (e: com.knowflick.app.domain.WebClipException) {
                clipStage = ClipStage.INPUT
                clipError = e.message
            } catch (e: Exception) {
                clipStage = ClipStage.INPUT
                clipError = "取不到这个页面：${e.message ?: "网络异常"}"
            }
        }
    }

    /** 用 AI 把剪藏正文提炼成卡片并置顶入堆（人工确认这一步之后才写库） */
    fun clipToCards() {
        val digest = clipDigest ?: return
        if (clipStage == ClipStage.EXTRACTING) return
        if (!settings.isConfigured) {
            clipError = "请先在设置里配置 AI 服务"
            return
        }
        clipJob?.cancel()
        clipStage = ClipStage.EXTRACTING
        clipNotice = null
        clipError = null
        clipJob = viewModelScope.launch {
            try {
                val transformedCards = aiService.transformNoteToCards(
                    settings = settings,
                    apiKey = currentApiKey(),
                    note = digest.aiNote,
                )
                val cards = digest.attributing(transformedCards)
                mutate { model.store.addCards(cards, insertAtTop = true) }
                generateNotice = "已剪藏《${digest.siteName}》并生成 ${cards.size} 张卡片 ✓"
                showClipSheet = false
                clipStage = ClipStage.INPUT
                clipDigest = null
            } catch (e: CancellationException) {
                throw e
            } catch (e: AiError) {
                clipStage = ClipStage.READY
                clipError = e.message
            } catch (e: Exception) {
                clipStage = ClipStage.READY
                clipError = "提炼失败：${e.message}"
            }
        }
    }

    // ---------- 卡片 AI 伴学与深度追问 ----------

    /** 打开某张卡片的追问面板（对齐 macOS openChat 契约） */
    fun openChat(card: KnowledgeCard) {
        cancelChatStreaming()
        activeChatCard = card
        chatErrorMessage = null
        chatLoadGeneration++
        val gen = chatLoadGeneration

        val cached = chatStorage.getCachedSession(card.id)
        if (cached != null) {
            currentChatSession = cached
            return
        }
        currentChatSession = CardChatSession(cardId = card.id, cardHeadline = card.headline)
        viewModelScope.launch(Dispatchers.IO) {
            val loaded = chatStorage.loadSession(card.id)
            withContext(Dispatchers.Main) {
                if (chatLoadGeneration == gen && activeChatCard?.id == card.id) {
                    if (currentChatSession?.messages.isNullOrEmpty() && loaded != null) {
                        currentChatSession = loaded
                    }
                }
            }
        }
    }

    /** 关闭追问面板 */
    fun closeChat() {
        cancelChatStreaming()
        activeChatCard = null
    }

    /** 发送追问消息并启动流式接收 */
    fun sendChatMessage(prompt: String) {
        val trimmed = prompt.trim()
        val card = activeChatCard ?: return
        if (isChatStreaming || trimmed.isEmpty()) return

        var session = currentChatSession ?: CardChatSession(cardId = card.id, cardHeadline = card.headline)
        val userMsg = CardChatMessage(sender = MessageSender.USER, content = trimmed)
        val assistantMsgId = java.util.UUID.randomUUID().toString()
        val assistantMsg = CardChatMessage(id = assistantMsgId, sender = MessageSender.ASSISTANT, content = "", isStreaming = true)

        val updatedMessages = session.messages + userMsg + assistantMsg
        session = session.copy(messages = updatedMessages, updatedAt = System.currentTimeMillis())
        currentChatSession = session

        isChatStreaming = true
        chatErrorMessage = null

        val historySnapshot = session.messages.dropLast(2)
        val key = currentApiKey()

        chatStreamJob?.cancel()
        chatStreamJob = viewModelScope.launch(Dispatchers.IO) {
            try {
                aiService.streamCardChat(
                    card = card,
                    history = historySnapshot,
                    userPrompt = trimmed,
                    settings = settings,
                    apiKey = key,
                    onDelta = { delta ->
                        viewModelScope.launch(Dispatchers.Main) {
                            val current = currentChatSession ?: return@launch
                            val index = current.messages.indexOfFirst { it.id == assistantMsgId }
                            if (index >= 0) {
                                val msg = current.messages[index]
                                val newMsg = msg.copy(content = msg.content + delta)
                                val list = current.messages.toMutableList()
                                list[index] = newMsg
                                currentChatSession = current.copy(messages = list)
                            }
                        }
                    },
                )
                withContext(Dispatchers.Main) {
                    val current = currentChatSession ?: return@withContext
                    val index = current.messages.indexOfFirst { it.id == assistantMsgId }
                    if (index >= 0) {
                        val msg = current.messages[index]
                        val list = current.messages.toMutableList()
                        list[index] = msg.copy(isStreaming = false)
                        val finalSession = current.copy(messages = list, updatedAt = System.currentTimeMillis())
                        currentChatSession = finalSession
                        viewModelScope.launch(Dispatchers.IO) {
                            chatStorage.saveSession(finalSession)
                        }
                    }
                    isChatStreaming = false
                }
            } catch (_: CancellationException) {
                // 协程取消正常终止，保留已产出片段
            } catch (e: Throwable) {
                withContext(Dispatchers.Main) {
                    isChatStreaming = false
                    chatErrorMessage = e.message ?: "AI 追问失败，请重试"
                    val current = currentChatSession ?: return@withContext
                    val index = current.messages.indexOfFirst { it.id == assistantMsgId }
                    if (index >= 0) {
                        val list = current.messages.toMutableList()
                        if (list[index].content.isEmpty()) {
                            list.removeAt(index)
                        } else {
                            list[index] = list[index].copy(isStreaming = false)
                        }
                        val finalSession = current.copy(messages = list, updatedAt = System.currentTimeMillis())
                        currentChatSession = finalSession
                        viewModelScope.launch(Dispatchers.IO) {
                            chatStorage.saveSession(finalSession)
                        }
                    }
                }
            }
        }
    }

    /** 终止当前流式生成（保留已生成的部分回复） */
    fun cancelChatStreaming() {
        chatStreamJob?.cancel()
        chatStreamJob = null
        isChatStreaming = false
        val current = currentChatSession ?: return
        val cleaned = current.messages
            .filterNot { it.isStreaming && it.content.isEmpty() }
            .map { it.copy(isStreaming = false) }
        val updated = current.copy(messages = cleaned, updatedAt = System.currentTimeMillis())
        currentChatSession = updated
        viewModelScope.launch(Dispatchers.IO) {
            chatStorage.saveSession(updated)
        }
    }

    /** 清空当前卡片的追问历史 */
    fun clearCurrentChatSession() {
        cancelChatStreaming()
        val card = activeChatCard ?: return
        currentChatSession = CardChatSession(cardId = card.id, cardHeadline = card.headline)
        viewModelScope.launch(Dispatchers.IO) {
            chatStorage.clearSession(card.id)
        }
    }

    /** 将助手追问回复提炼为新卡片并插入卡堆（置顶） */
    fun deriveAndSaveCardFromChat(messageId: String, content: String, parentCard: KnowledgeCard): KnowledgeCard {
        val newCard = com.knowflick.app.ai.CardChatInsightDeriver.deriveCard(content, parentCard)
        savedChatMessageIds = savedChatMessageIds + messageId
        mutate { model.store.addCards(listOf(newCard), insertAtTop = true) }
        return newCard
    }

    /** 导出当前卡片的追问对话为 Markdown */
    fun exportCurrentChatMarkdown(): String? {
        val session = currentChatSession ?: return null
        val card = activeChatCard ?: return null
        if (session.messages.isEmpty()) return null
        return com.knowflick.app.ai.CardChatInsightDeriver.exportMarkdown(session, card)
    }

    // ---------- 知识测验 ----------

    /** 开始/刷新测验：到期复习优先，其后收藏与历史，单轮 10 张 */
    fun startQuiz(category: String? = null) {
        quizCycleRatedIds.clear()
        quizSession = com.knowflick.app.domain.QuizSession.build(
            cards = model.store.cards,
            today = java.time.LocalDate.now(),
            limit = 10,
            category = category,
        )
        version++
    }

    /** 开始纯到期复习：以到期队列为准，最多 10 张 */
    fun startDueReview() {
        quizCycleRatedIds.clear()
        quizSession = com.knowflick.app.domain.QuizSession.buildDueReview(
            cards = model.store.cards,
            today = java.time.LocalDate.now(),
            limit = 10,
        )
        version++
    }

    /** 针对性弱项重测：提取上一轮中评分不为熟练掌握（FORGOT/HESITANT）的卡片进行即时巩固 */
    fun retestWeakCards(ratings: Map<String, com.knowflick.app.domain.QuizRating>) {
        quizCycleRatedIds.clear()
        quizSession = com.knowflick.app.domain.QuizSession.buildWeakCards(
            cards = model.store.cards,
            ratings = ratings,
        )
        version++
    }

    /** 再测一组：剔除本轮已评卡，剩余不足则回到全部（与 macOS 到期队列刷新同精神） */
    fun nextQuizRound() {
        var pool = model.store.cards.filter { it.id !in quizCycleRatedIds }
        if (pool.isEmpty()) {
            quizCycleRatedIds.clear()
            pool = model.store.cards
        }
        quizSession = com.knowflick.app.domain.QuizSession.build(
            cards = pool,
            today = java.time.LocalDate.now(),
            limit = 10,
        )
        version++
    }

    // ---------- 智能间隔复习与专属复习卡堆模式 ----------

    var isReviewDeckMode by mutableStateOf(false)
        private set

    var reviewQueue by mutableStateOf<List<KnowledgeCard>>(emptyList())
        private set

    var reviewSessionCount by mutableStateOf(0)
        private set

    var reviewInitialTotal by mutableStateOf(0)
        private set

    /** 今日待复习卡片总数（到期复习队列） */
    val dueCardsCount: Int
        get() = com.knowflick.app.domain.LearningPlan(model.store.cards, java.time.LocalDate.now()).due.size

    /** 开启专属复习卡堆模式 */
    fun enterReviewDeckMode() {
        val due = com.knowflick.app.domain.LearningPlan(model.store.cards, java.time.LocalDate.now()).due
        reviewQueue = due
        reviewInitialTotal = due.size
        reviewSessionCount = 0
        isReviewDeckMode = true
        version++
    }

    /** 退出专属复习卡堆模式 */
    fun exitReviewDeckMode() {
        isReviewDeckMode = false
        reviewQueue = emptyList()
        version++
    }

    /** 切换专属复习卡堆模式 */
    fun toggleReviewDeckMode() {
        if (isReviewDeckMode) {
            exitReviewDeckMode()
        } else {
            enterReviewDeckMode()
        }
    }

    /** 专属复习卡堆提交评分（驱动 SM-2 间隔演进、简易度更新与留存率计算） */
    fun submitReviewRating(card: KnowledgeCard, rating: com.knowflick.app.domain.spaced.SpacedRating) {
        val result = com.knowflick.app.domain.spaced.SpacedRepetitionEngine.calculate(card, rating)
        model.store.recordReviewResult(card.id, result)
        reviewQueue = reviewQueue.filter { it.id != card.id }
        reviewSessionCount++
        version++
        schedulePersist()
    }

    /** 提交测验评分：驱动 SM-2 间隔演进并记账，到期队列随之刷新 */
    fun rateQuiz(rating: com.knowflick.app.domain.QuizRating) {
        val session = quizSession ?: return
        val card = session.current ?: return
        if (!session.rate(rating)) return
        quizCycleRatedIds += card.id
        val spacedRating = com.knowflick.app.domain.spaced.SpacedRating.fromQuizRating(rating)
        val result = com.knowflick.app.domain.spaced.SpacedRepetitionEngine.calculate(card, spacedRating)
        model.store.recordReviewResult(card.id, result)
        version++
        schedulePersist()
    }

    fun exitQuiz() {
        quizSession = null
        quizCycleRatedIds.clear()
        version++
    }

    /** 意图操作统一入口：执行动作 + 重组 + 节流落盘 */
    fun mutate(action: () -> Unit) {
        action()
        version++
        schedulePersist()
    }

    /** 是否可撤销上一次刷卡（与 macOS ⌘Z 同一语义：只还原浏览意图，不动收藏） */
    val canUndoLastSwipe: Boolean get() = model.store.canUndoLastSwipe

    /** 撤销上一张：卡片回卡堆顶部，收藏状态原样保留 */
    fun undoLastSwipe() {
        if (!model.store.canUndoLastSwipe) return
        mutate { model.store.undoLastSwipe() }
    }

    // ---------- 学习范围（学习地图）----------

    /**
     * 当前学习范围。空范围 = 全景刷所有卡。
     * 刻意**不落盘**：重启后卡堆"莫名变窄"很难排查，范围只在本次会话内有效。
     */
    val studyScope: com.knowflick.app.domain.StudyScope get() = model.store.studyScope

    /** 该范围下还剩多少张没学（地图与顶栏徽标共用） */
    val studyRemaining: Int get() = com.knowflick.app.domain.StudyMap.remaining(model.store.cards, model.store.studyScope)

    fun applyStudyScope(scope: com.knowflick.app.domain.StudyScope) {
        mutate {
            model.store.studyScope = scope
            model.store.recompute()
        }
    }

    fun clearStudyScope() {
        if (!model.store.studyScope.isActive) return
        applyStudyScope(com.knowflick.app.domain.StudyScope.None)
    }

    /** 仅触发重组（用于播放状态等非持久化状态变化） */
    fun bump() {
        version++
    }

    fun showNotice(message: String) {
        generateNotice = message
    }

    override fun onCleared() {
        syncServer?.stop()
        syncServer = null
        persistJob?.cancel()
        persistJob = null
        persistenceQueue.closeAfter(model.store.cards)
        speech.release()
        super.onCleared()
    }

    private fun schedulePersist() {
        if (persistJob?.isActive == true) return
        persistJob = viewModelScope.launch {
            delay(350)
            // 在主线程取不可变快照，串行 IO 保证旧快照不会覆盖新操作。
            val snapshot = model.store.cards.toList()
            persistenceQueue.enqueue(snapshot)
            com.knowflick.app.widget.WidgetCardRepository.notifyWidgetUpdate(getApplication())
        }
    }

    /** 生命周期 flush：同步把最新快照写盘，避免退到后台后被系统回收丢失最后一批改动。 */
    fun flushPending() {
        persistJob?.cancel()
        persistJob = null
        val snapshot = model.store.cards.toList()
        // 走串行队列的同步提交：队列保证顺序，等待落盘完成再返回。
        val done = java.util.concurrent.CountDownLatch(1)
        val accepted = persistenceQueue.enqueueAndWait(snapshot) { done.countDown() }
        if (!accepted) {
            // 队列已关闭（ViewModel 已清理）时直接同步写一次，避免静默丢数据。
            handlePersistenceResult(model.storage.saveCards(snapshot))
            return
        }
        // onPause 允许极短等待；超时说明写入较慢，交给队列自然完成，不阻塞界面。
        done.await(400, java.util.concurrent.TimeUnit.MILLISECONDS)
    }

    private fun handlePersistenceResult(result: CardSaveResult) {
        viewModelScope.launch {
            persistenceNotice = when (result) {
                CardSaveResult.Saved -> null
                is CardSaveResult.SavedWithoutBackup -> "卡片已保存，但备份写入失败：${result.reason}"
                is CardSaveResult.Failed -> "卡片保存失败：${result.message}"
            }
        }
    }
}
