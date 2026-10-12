package com.knowflick.desktop

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.knowflick.app.ai.AiError
import com.knowflick.app.ai.AiService
import com.knowflick.app.ai.AiSettings
import com.knowflick.app.ai.CardChatMessage
import com.knowflick.app.ai.CardChatSession
import com.knowflick.app.data.AppModel
import com.knowflick.app.data.ChatSessionStorage
import com.knowflick.app.data.ChatStateHolder
import com.knowflick.app.domain.ArchivePreview
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.RestoreStrategy
import com.knowflick.app.domain.QuizCycle
import com.knowflick.app.domain.QuizRating
import com.knowflick.app.domain.QuizSession
import com.knowflick.app.domain.search.KnowledgeSearchEngine
import com.knowflick.app.domain.search.SearchResultItem
import com.knowflick.app.domain.StudyScope
import com.knowflick.app.domain.search.SearchSourceFilter
import com.knowflick.app.speech.SpeechSettings
import com.knowflick.app.ui.PaperTheme
import java.awt.Frame
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * 桌面宿主的状态容器 —— 对应 Android 端 `KnowFlickViewModel` 的角色：
 * 持有「卡库版本号」（卡库本身不是 Compose 状态，改动后靠它触发重组）与提示文案，
 * 并把平台动作收敛成可直接调用的方法。
 *
 * 这样拆的另一个好处是**可测**：导入/导出/测验不经过原生对话框时也能在无头环境里驱动
 * （对话框只负责取路径，见 [DesktopFileDialogs]）。
 */
class DesktopHostState(
    val model: AppModel,
    /** 凭据目录可注入：测试用临时目录，免得把开发机上的真实密钥写坏 */
    private val credentials: DesktopCredentialStore = DesktopCredentialStore(DesktopPaths.credentialsDir()),
    /**
     * 追问会话的存储：与卡库同目录（对应 Android 的 `filesDir/store/chat_sessions.json`）。
     * **可注入**——否则测试会把会话写进开发机真实数据目录（凭据那次已经踩过同一个坑）。
     */
    private val chatStorage: ChatSessionStorage = ChatSessionStorage(DesktopPaths.storeDir()),
    /** AI 生成是异步的；默认用 Default 调度器（Compose 快照状态本身线程安全） */
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) {

    /**
     * AI 服务：**与 Android 端同一份**实现（`:domain` 的 `ai/AiService`，OkHttp + 流式解析都在共享层）。
     * 桌面端因此具备真正可用的 AI 能力：生成新卡、连接测试。
     */
    private val aiService = AiService(versionName = "desktop-$PRODUCT_VERSION")

    /**
     * 卡片追问的会话状态：**与 Android 端同一份 `ChatStateHolder`**（`:shared-data`），
     * 连存储文件（`chat_sessions.json`）与流式编排都是同一份实现；桌面端只提供设置与密钥来源。
     */
    private val chat = ChatStateHolder(
        storage = chatStorage,
        aiService = aiService,
        scope = scope,
        settingsProvider = { aiSettings },
        apiKeyProvider = { currentApiKey() },
        // 桌面没有 Dispatchers.Main（那是 Android 的既有默认值）
        stateDispatcher = Dispatchers.Default,
    )

    val activeChatCard get() = chat.activeCard
    val chatSession: CardChatSession? get() = chat.currentSession
    val isChatStreaming get() = chat.isStreaming
    val chatErrorMessage get() = chat.errorMessage
    val savedChatMessageIds get() = chat.savedMessageIds

    fun openChat(card: KnowledgeCard) {
        chat.openChat(card)
        version++
    }

    fun closeChat() {
        chat.closeChat()
        version++
    }

    fun sendChatMessage(prompt: String) {
        chat.sendChatMessage(prompt)
        version++
    }

    fun cancelChatStreaming() {
        chat.cancelStreaming()
        version++
    }

    fun clearCurrentChatSession() {
        chat.clearCurrentSession()
        version++
    }

    fun markChatMessageSaved(messageId: String) {
        chat.markMessageSaved(messageId)
        version++
    }

    /** 追问记录导出为 Markdown（共享 `CardChatInsightDeriver`，与 Android 同一份格式与空会话口径） */
    fun exportCurrentChatMarkdown(): String? {
        val session = chat.currentSession ?: return null
        val card = chat.activeCard ?: return null
        if (session.messages.isEmpty()) return null
        return com.knowflick.app.ai.CardChatInsightDeriver.exportMarkdown(session, card)
    }

    /** 把一条 AI 回复沉淀为新卡片（共享 `CardChatInsightDeriver`，与 Android 同一条路径） */
    fun deriveCardFromChat(messageId: String, content: String, parentCard: KnowledgeCard): KnowledgeCard {
        val newCard = com.knowflick.app.ai.CardChatInsightDeriver.deriveCard(content, parentCard)
        chat.markMessageSaved(messageId)
        mutate { model.store.addCards(listOf(newCard), insertAtTop = true) }
        return newCard
    }

    /**
     * AI 设置（含**主题**与音效开关——它们是这份设置的一部分，与 Android 同一份 `AiSettings` 线格式）。
     * 桌面端不重复实现存储：`loadSettingsJson` / `saveSettingsJson` 都是 `:shared-data` 的同一份代码。
     */
    var aiSettings by mutableStateOf(
        // 构造期即从共享存储读回（调用方在此之前已完成 AppModel.bootstrap()）
        AiSettings.fromJson(model.storage.loadSettingsJson() ?: "")
            ?.withMissingPresetDefaults()
            ?: AiSettings(),
    )
        private set

    /** 语音设置：桌面暂无 TTS，但配置照样保存（跨端设置一致，不因某端缺能力就丢字段） */
    var speechSettings by mutableStateOf(
        SpeechSettings.fromJson(model.storage.loadSpeechJson() ?: "") ?: SpeechSettings(),
    )
        private set

    var aiSaveNotice by mutableStateOf("")
        private set
    var aiSaveSucceeded by mutableStateOf(true)
        private set
    var speechSaveNotice by mutableStateOf("")
        private set
    var speechSaveSucceeded by mutableStateOf(true)
        private set

    /**
     * 全局搜索：筛选与结果计算都在共享层（`:domain` 的 `KnowledgeSearchEngine`），
     * 历史落共享 `CardStorage`——桌面端只做状态与调用，不重写检索逻辑。
     */
    private val searchEngine = KnowledgeSearchEngine()

    var showingSearch by mutableStateOf(false)
        private set
    var searchQuery by mutableStateOf("")
        private set
    var searchCategory by mutableStateOf<String?>("全部")
        private set
    var searchSource by mutableStateOf(SearchSourceFilter.ALL)
        private set
    var searchHistory: List<String> by mutableStateOf(model.storage.loadSearchHistory())
        private set

    val searchResults: List<SearchResultItem>
        get() = searchEngine.search(
            query = searchQuery,
            category = searchCategory,
            source = searchSource,
            intent = null,
            cards = model.store.cards,
        )

    fun openSearch() {
        showingSearch = true
        version++
    }

    fun closeSearch() {
        showingSearch = false
        version++
    }

    fun updateSearchQuery(query: String) {
        searchQuery = query
        version++
    }

    fun updateSearchCategory(category: String?) {
        searchCategory = category
        version++
    }

    fun updateSearchSource(source: SearchSourceFilter) {
        searchSource = source
        version++
    }

    fun resetSearchFilters() {
        searchQuery = ""
        searchCategory = "全部"
        searchSource = SearchSourceFilter.ALL
        version++
    }

    fun addSearchHistory(query: String) {
        val trimmed = query.trim()
        if (trimmed.isEmpty()) return
        searchHistory = (listOf(trimmed) + searchHistory.filter { it != trimmed }).take(8)
        model.storage.saveSearchHistory(searchHistory)
        version++
    }

    fun removeSearchHistory(query: String) {
        searchHistory = searchHistory.filter { it != query }
        model.storage.saveSearchHistory(searchHistory)
        version++
    }

    fun clearSearchHistory() {
        searchHistory = emptyList()
        model.storage.saveSearchHistory(searchHistory)
        version++
    }

    /** 搜索结果置顶到卡堆（共享 CardStore 方法） */
    fun promoteToDeckTop(card: KnowledgeCard) = mutate { model.store.promoteToDeckTop(card) }

    /**
     * 学习地图：范围存在共享 `CardStore.studyScope`（与 Android 同一处状态），
     * 地图屏与 `StudyMap` 计算都在共享层——桌面端只负责导航与落盘。
     */
    var showingMap by mutableStateOf(false)
        private set

    val studyScope: StudyScope get() = model.store.studyScope

    fun openMap() {
        showingMap = true
        version++
    }

    fun closeMap() {
        showingMap = false
        version++
    }

    fun applyStudyScope(scope: StudyScope) = mutate { model.store.studyScope = scope }

    /** 正在查看设置页 */
    var showingSettings by mutableStateOf(false)
        private set

    fun openSettings() {
        showingSettings = true
        version++
    }

    /** 是否正在生成（DeckScreen 据此显示进度） */
    var isGenerating by mutableStateOf(false)
        private set

    /**
     * 用 AI 生成新卡并置顶插入卡库。
     * 校验与提示文案与 Android 端保持同一口径（未配置/未填 Key/网络错误各自可辨认）。
     */
    fun generateNewCards(count: Int = 3, topic: String? = null) {
        if (isGenerating) return
        val settings = aiSettings
        if (!settings.isConfigured) {
            notice = "请先在设置里配置 AI 服务"
            return
        }
        val apiKey = currentApiKey()
        if (apiKey.isBlank()) {
            notice = "请先在设置里填入 API Key"
            return
        }
        isGenerating = true
        notice = null
        scope.launch {
            try {
                val cards = aiService.generateCards(
                    settings = settings,
                    apiKey = apiKey,
                    count = count,
                    excludeHeadlines = model.store.cards.map { it.headline },
                    topic = topic,
                )
                mutate { model.store.addCards(cards, insertAtTop = true) }
                notice = "已生成 ${cards.size} 张新知识 ✓"
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: AiError) {
                notice = error.message
            } catch (error: Exception) {
                notice = "网络错误：${error.message}"
            } finally {
                isGenerating = false
            }
        }
    }

    /** 设置页的「测试连接」：直接调共享 AiService（与 Android 同一条路径） */
    suspend fun testAiConnection(settings: AiSettings, apiKey: String): String = try {
        aiService.ping(settings, apiKey)
        "连接成功 ✓"
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (error: AiError) {
        "失败：${error.message}"
    } catch (error: Exception) {
        "网络错误：${error.message}"
    }

    fun closeSettings() {
        showingSettings = false
        version++
    }

    fun clearAiSaveNotice() { aiSaveNotice = "" }

    fun clearSpeechSaveNotice() { speechSaveNotice = "" }

    /** 保存 AI 设置：设置走共享存储，密钥走桌面凭据文件（0600） */
    fun saveAiSettings(updated: AiSettings, apiKey: String) {
        val jsonSaved = model.storage.saveSettingsJson(updated.toJson())
        val trimmed = apiKey.trim()
        val credentialSaved = if (trimmed.isEmpty()) {
            credentials.delete(API_KEY_NAME)
        } else {
            credentials.save(API_KEY_NAME, trimmed)
        }
        aiSettings = updated
        aiSaveSucceeded = jsonSaved && credentialSaved
        aiSaveNotice = if (aiSaveSucceeded) "已保存 AI 设置" else "保存失败（设置或凭据未能写入）"
        version++
    }

    fun saveSpeechSettings(updated: SpeechSettings, apiKey: String) {
        val jsonSaved = model.storage.saveSpeechJson(updated.toJson())
        val trimmed = apiKey.trim()
        val credentialSaved = if (trimmed.isEmpty()) {
            credentials.delete(SPEECH_KEY_NAME)
        } else {
            credentials.save(SPEECH_KEY_NAME, trimmed)
        }
        speechSettings = updated
        speechSaveSucceeded = jsonSaved && credentialSaved
        speechSaveNotice = if (speechSaveSucceeded) "已保存语音设置" else "保存失败（设置或凭据未能写入）"
        version++
    }

    /** 切换纸质主题：立即生效（主题是设置的一部分，落到同一份 settings.json） */
    fun selectPaperTheme(theme: PaperTheme) = persistSettings(aiSettings.copy(paperTheme = theme.name))

    fun setSoundEffectsEnabled(enabled: Boolean) = persistSettings(aiSettings.copy(soundEffectsEnabled = enabled))

    /** 直接改设置（不涉及密钥）时的统一落盘入口 */
    private fun persistSettings(updated: AiSettings) {
        model.storage.saveSettingsJson(updated.toJson())
        aiSettings = updated
        version++
    }

    /** 读回已保存的密钥（设置页用它回填输入框） */
    fun currentApiKey(): String = credentials.load(API_KEY_NAME)

    fun currentSpeechApiKey(): String = credentials.load(SPEECH_KEY_NAME)

    /** 卡库版本：每次写入后 +1，界面据此重新读取 `model.store.cards` */
    var version by mutableIntStateOf(0)
        private set

    /** 一次性提示文案（导入/导出结果），显示在界面底部 */
    var notice by mutableStateOf<String?>(null)
        private set

    /**
     * 测验轮次编排：**与 Android 端共用同一份** `QuizCycle`（在 `:domain`），
     * 这里只负责把它同步成 Compose 状态、推进 version、以及落盘。
     */
    private val quizCycle = QuizCycle(model.store)

    /** 当前测验会话（null = 没在测验，显示卡库界面） */
    var quizSession by mutableStateOf<QuizSession?>(null)
        private set

    /** 是否正在看学习统计（与测验互斥的第二个共享整屏） */
    var showingStats by mutableStateOf(false)
        private set

    /** 正在看详情的卡片 id（null = 不在详情页）。存 id 而不是卡片对象：卡库变更后要重新取最新版 */
    var detailCardId by mutableStateOf<String?>(null)
        private set

    /** 详情页要展示的卡片（按 id 从卡库现取，保证收藏/复习状态是最新的） */
    val detailCard: KnowledgeCard?
        get() = detailCardId?.let { id -> model.store.cards.firstOrNull { it.id == id } }

    fun openDetail(cardId: String) {
        detailCardId = cardId
        version++
    }

    fun closeDetail() {
        detailCardId = null
        version++
    }

    /** 收藏/取消收藏（与 Android 端同一条 store 路径），并立即落盘 */
    fun toggleFavorite(card: KnowledgeCard) {
        model.store.toggleFavorite(card)
        version++
        model.persistNow()
    }

    /** 是否正在看收藏阁（第三个导航目的地；刷卡页是首页） */
    var showingLibrary by mutableStateOf(false)
        private set

    fun openStats() {
        showingStats = true
        version++
    }

    fun closeStats() {
        showingStats = false
        version++
    }

    fun openLibrary() {
        showingLibrary = true
        version++
    }

    /** 回到刷卡首页：关掉所有覆盖层并退出测验（对应 Android 的 Screen.DECK） */
    fun goHome() {
        showingStats = false
        showingLibrary = false
        detailCardId = null
        quizCycle.exit()
        syncQuizSession()
        version++
    }

    /**
     * 统一写入入口：执行动作 → 推进版本 → 落盘。
     * 与 Android `KnowFlickViewModel.mutate` 同一语义（刷卡等卡库变更都经这里）。
     */
    fun mutate(action: () -> Unit) {
        action()
        version++
        model.persistNow()
    }

    private fun syncQuizSession() {
        quizSession = quizCycle.session
    }

    /** 开始测验（到期优先 → 收藏 → 历史 → 其余，单轮 10 张） */
    fun startQuiz() {
        quizCycle.start()
        syncQuizSession()
        version++
    }

    /** 只测今天到期的卡 */
    fun startDueReview() {
        quizCycle.startDueReview()
        syncQuizSession()
        version++
    }

    /** 提交评分：驱动 SM-2 并落盘（编排在共享 QuizCycle） */
    fun rateQuiz(rating: QuizRating) {
        if (!quizCycle.rate(rating)) return
        syncQuizSession()
        version++
        model.persistNow()
    }

    /** 再测一组 */
    fun nextQuizRound() {
        quizCycle.nextRound()
        syncQuizSession()
        version++
    }

    /** 弱项重测：把上一轮没掌握的卡再过一遍 */
    fun retestWeak(ratings: Map<String, QuizRating>) {
        quizCycle.retestWeak(ratings)
        syncQuizSession()
        version++
    }

    fun exitQuiz() {
        quizCycle.exit()
        syncQuizSession()
        version++
    }

    /** 从统计页发起「只测今天到期」：退出统计并进入测验 */
    fun startDueReviewFromStats() {
        showingStats = false
        startDueReview()
    }

    /**
     * 待确认的导入预览（null = 没有正在预览的归档）。
     * 交互路径：选文件 → 探测 → **先给用户看预览与恢复策略** → 确认后才写库。
     * 这与 Android 端同一交互，因为背后是同一份 `ArchiveImportManager`。
     */
    var importPreview by mutableStateOf<ArchivePreview?>(null)
        private set

    /** 第一步（交互路径）：探测归档并弹出预览，不写库 */
    fun beginImport(fileName: String, bytes: ByteArray): Result<ArchivePreview> {
        val result = DesktopArchiveActions.inspectArchive(fileName, bytes)
        result.fold(
            onSuccess = { importPreview = it; version++ },
            onFailure = { error -> showNotice("导入失败：${error.message ?: "无法解析归档"}") },
        )
        return result
    }

    /** 第二步：按用户选定的策略恢复 */
    fun confirmImport(strategy: RestoreStrategy): String {
        val preview = importPreview ?: return ""
        val message = runCatching {
            DesktopArchiveActions.applyPreview(model, preview, strategy)
        }.fold(
            onSuccess = { result ->
                "已导入：新增 ${result.added} 张，恢复 ${result.restored} 张，忽略 ${result.ignored} 张"
            },
            onFailure = { error -> "导入失败：${error.message ?: "未知错误"}" },
        )
        importPreview = null
        notice = message
        version++
        return message
    }

    fun cancelImport() {
        importPreview = null
        version++
    }

    /** 导入归档字节：探测 → 合并 → 落盘 → 刷新界面（一步到位，用于无头路径与测试） */
    fun importBytes(fileName: String, bytes: ByteArray): String {
        val message = DesktopArchiveActions.importBytes(model, fileName, bytes).fold(
            onSuccess = { result ->
                "已导入：新增 ${result.added} 张，恢复 ${result.restored} 张，忽略 ${result.ignored} 张"
            },
            onFailure = { error -> "导入失败：${error.message ?: "未知错误"}" },
        )
        notice = message
        version++
        return message
    }

    /** 导出文本：走原生「另存为」；用户取消则不改提示 */
    fun saveText(owner: Frame?, title: String, defaultName: String, text: String): String? {
        val target = DesktopFileDialogs.saveFile(owner, title, defaultName) ?: return null
        val message = runCatching { target.writeText(text) }.fold(
            onSuccess = { "已导出：${target.name}" },
            onFailure = { error -> "导出失败：${error.message ?: "无法写入文件"}" },
        )
        notice = message
        return message
    }

    fun dismissNotice() {
        notice = null
    }

    private companion object {
        const val API_KEY_NAME = "apiKey"
        const val SPEECH_KEY_NAME = "speechApiKey"

        /** 打包版本（对应 build.gradle.kts 的 packageVersion），作为 AI 请求的 User-Agent 版本号 */
        const val PRODUCT_VERSION = "0.1.0"
    }

    /** 直接给用户一句提示（例如读取文件失败） */
    fun showNotice(message: String) {
        notice = message
    }
}
