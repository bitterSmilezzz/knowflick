import Foundation
import Observation
import os

/// 全局状态：卡片池、历史记录、设置、AI 生成
@MainActor
@Observable
public final class AppStore {
    // MARK: - 卡片库转发（状态所有权在 `CardLibraryStore`，拆分方案 B Step 5）

    /// 转发属性同样能被观察（`@Observable` 的读取会穿透到子系统），视图零改动。
    public var cards: [KnowledgeCard] {
        get { library.cards }
        set { library.cards = newValue }
    }
    public var settings: AISettings = .default {
        didSet {
            library.settingsDidChange(settings)
            syncSpeechService()
        }
    }
    /// 学习范围（学习地图下发）：生效时接管卡堆的分类维度。
    /// **只在本次会话内生效，不落盘**——重启回到全景，与 Android 侧同一产品口径。
    public var studyScope: StudyScope {
        get { library.studyScope }
        set { library.studyScope = newValue }
    }
    /// 生成域状态（并发守卫 / 开始时间 / 最近失败）的所有权在 `GenerationCoordinator`（Wave C2），
    /// 这里只做转发：`@Observable` 的读取会穿透到子系统，视图与测试零改动。
    public var isGenerating: Bool {
        get { generation.isGenerating }
        set { generation.isGenerating = newValue }
    }
    /// 本轮生成开始的时间（isGenerating 置 false 时清空）：等待反馈要显示「已等多久」
    ///（ui-research 共识 9：≥2s 的等待需要可见进度），视图据此计算流逝秒数。
    public var generationStartedAt: Date? { generation.generationStartedAt }
    public var lastError: String? {
        get { generation.lastError }
        set { generation.lastError = newValue }
    }
    /// 落盘告警（顶栏横幅）：由 `PersistenceCoordinator` 持有，这里转发。
    /// 转发属性同样能被观察（`@Observable` 的读取会穿透到协调器），视图零改动。
    public var persistenceWarning: String? { persistence.persistenceWarning }

    // MARK: - 运行期状态

    /// 首启是否还在加载预置库。所有权在卡片库（守卫判据须与 `cards.isEmpty` 动态结合），这里转发。
    public var isLoadingSeed: Bool {
        get { library.isLoadingSeed }
        set { library.isLoadingSeed = newValue }
    }

    public var deck: [KnowledgeCard] { library.deck }
    public var history: [KnowledgeCard] { library.history }

    /// 全库重排轨迹（测试护栏，见 `CardLibraryStore.recomputeTrace`）
    var deckRecomputeTrace: [Int] { library.recomputeTrace }

    /// 语音朗读与磨耳朵服务
    public let speechService: SpeechSynthesizerService

    /// 全文检索与智能搜索引擎
    public let searchEngine = KnowledgeSearchEngine()

    /// 搜索历史关键词（上限 8 条，LRU 顺序）
    public private(set) var searchHistory: [String] = []

    /// 收藏阁：显式收藏的卡片列表（按收藏时间倒序，与喜好意图解耦）——派生快照由 `CardLibraryStore` 持有。
    public var favorites: [KnowledgeCard] { library.favorites }

    public var topCard: KnowledgeCard? { library.topCard }

    /// 智能追问当前激活卡片与会话：状态由 `ChatSessionStore` 持有，这里转发（视图与测试零改动）
    public var activeChatCard: KnowledgeCard? {
        get { chat.activeChatCard }
        set { chat.activeChatCard = newValue }
    }
    public var currentChatSession: CardChatSession? {
        get { chat.currentChatSession }
        set { chat.currentChatSession = newValue }
    }
    public var isChatStreaming: Bool {
        get { chat.isChatStreaming }
        set { chat.isChatStreaming = newValue }
    }
    public var chatErrorMessage: String? {
        get { chat.chatErrorMessage }
        set { chat.chatErrorMessage = newValue }
    }
    /// 已沉淀为新卡的追问消息 id：视图只需要读，写由 `deriveAndSaveCardFromChat` 内部完成，
    /// 所以这里只开只读转发，不把整个 `ChatSessionStore` 暴露出去。
    public var savedChatCardMessageIds: Set<UUID> { chat.savedCardMessageIds }

    private let aiService: AIService
    private let storage: Storage
    private let credentials: any CredentialStore
    /// 串行持久化队列：卡片、设置、聊天会话共用同一条，保证「先后顺序」在跨文件写之间也成立
    private let persistenceQueue: DispatchQueue
    private let persistence: PersistenceCoordinator
    private let chat: ChatSessionStore
    private let settingsStore: SettingsStore
    /// 卡片库子系统（拆分方案 B Step 5）：卡片池 / 卡堆 / 历史 / 收藏的状态所有权与卡片域动作
    private let library: CardLibraryStore
    /// AI 生成编排子系统（Wave C2）：守卫 / 计时 / exclude 装配 / 自动补卡触发
    private let generation: GenerationCoordinator
    /// 本地同步墓碑表（协议 v2 §4）：内存快照由 facade 持有，落盘走持久化队列。
    /// 本轮无删除 UI，本地永不主动产生墓碑——表内容只来自对端同步（含规则 1 触发的删除记录）。
    private var tombstones: [SyncTombstone]

    public init(
        storage: Storage = Storage(),
        credentials: (any CredentialStore)? = nil,
        speechService: SpeechSynthesizerService? = nil,
        aiService: AIService? = nil
    ) {
        let queue = DispatchQueue(label: "com.knowflick.persistence", qos: .utility)
        let resolvedAIService = aiService ?? AIService()
        let resolvedCredentials = credentials ?? SystemCredentialStore()
        self.storage = storage
        self.persistenceQueue = queue
        self.persistence = PersistenceCoordinator(storage: storage, queue: queue)
        self.credentials = resolvedCredentials
        self.speechService = speechService ?? SpeechSynthesizerService()
        self.aiService = resolvedAIService
        // 追问会话与卡片写入共用同一条串行队列：清除/保存/读盘的先后顺序因此天然成立
        self.chat = ChatSessionStore(storage: storage, aiService: resolvedAIService, persistenceQueue: queue)
        self.settingsStore = SettingsStore(storage: storage, credentials: resolvedCredentials, aiService: resolvedAIService)
        // 初始设置此刻必为 .default（init 内没有任何 settings 赋值）；此后 settings.didSet
        // 单漏斗把每次变更同步进子系统
        self.library = CardLibraryStore(persistence: persistence)
        // AI 生成编排（Wave C2）：先把壳存进属性，再 attach 读写回调——回调要读 facade 的
        // cards / settings，而捕获 self 必须等全部存储属性就位（两步都只在 init 内发生一次）。
        let generation = GenerationCoordinator(aiService: resolvedAIService)
        self.generation = generation
        self.tombstones = storage.loadTombstones()
        self.searchHistory = storage.loadSearchHistory()
        generation.attach(GenerationCoordinator.Dependencies(
            existingHeadlines: { [weak self] in self?.cards.map(\.headline) ?? [] },
            appendGeneratedCards: { [weak self] newCards in self?.appendGeneratedCards(newCards) },
            currentSettings: { [weak self] in self?.settings ?? .default },
            skipTopCard: { [weak self] in self?.skipTopCardForRefresh() },
            deckCount: { [weak self] in self?.deck.count ?? 0 },
            recordAutoTopUp: { [weak self] date in
                self?.applySettingsChange { $0.lastAutoTopUpAt = date }
            }
        ))

        syncSpeechService()

        self.speechService.onAmbientAdvanceRequest = { [weak self] in
            guard let self = self else { return nil }
            if let current = self.topCard {
                self.swipe(current, direction: .skip)
            }
            return self.topCard
        }

        // 媒体键 / 触控栏的「下一张、上一张」与控制台按钮同一套语义：
        // 切卡必须写划卡记录，否则控制中心跳过一张后卡堆还对不上
        self.speechService.onTransportNext = { [weak self] in
            guard let self = self else { return }
            if let current = self.topCard { self.swipe(current, direction: .skip) }
            if let next = self.topCard { self.speechService.speak(card: next, part: .full) }
        }
        self.speechService.onTransportPrevious = { [weak self] in
            guard let self = self else { return }
            self.undoLastSwipe()
            if let top = self.topCard { self.speechService.speak(card: top, part: .full) }
        }
    }

    /// 设置里的朗读参数灌进语音服务：init 与 `settings.didSet` 共用，避免两处各自维护漏掉新字段。
    private func syncSpeechService() {
        speechService.configuration = settings.speech
        speechService.speedMultiplier = settings.speechRate
        speechService.pitchMultiplier = settings.speechPitch
        speechService.preferredVoiceIdentifier = settings.speechVoiceIdentifier
        speechService.ambientGapSeconds = settings.ambientGapSeconds
    }

    /// 当前听书档位：由「语速 + 音调 + 切卡停顿」三个数值反推。
    /// **档位不落盘**——手调过任一滑块就返回 nil，UI 显示「自定义」，不会出现
    /// 「顶着睡前档的名字、数值却是手调的」这种撒谎状态。
    public var activeSpeechPreset: SpeechPreset? {
        SpeechPreset.match(
            speed: Double(settings.speechRate),
            pitch: settings.speechPitch,
            gapSeconds: settings.ambientGapSeconds
        )
    }

    /// 应用一档：只改可听参数（经 `settings.didSet` 单点同步到语音服务），
    /// 带定时的档位（睡前轻缓）顺手挂上睡眠定时与淡出窗口。
    public func applySpeechPreset(_ preset: SpeechPreset) {
        applySettingsChange {
            $0.speechRate = Float(preset.speed)
            $0.speechPitch = preset.pitch
            $0.ambientGapSeconds = preset.gapSeconds
        }
        if preset.sleepMinutes > 0 {
            speechService.setSleepTimer(
                minutes: preset.sleepMinutes,
                fadeSeconds: preset.fadesOut ? SleepFade.defaultWindowSeconds : 0
            )
        }
    }

    /// 卡片池 → 卡堆/历史/收藏 的派生已随状态所有权移入 `CardLibraryStore`（纯函数在 `DeckDeriver`）。
    /// 这里只保留持久化相关的转发。

    // MARK: - 生命周期

    /// 自动补卡节流判定（Wave A 语义）：距上次自动补卡不足 `interval` 则跳过（nil = 从未补过，放行）。
    /// 补卡是顺手行为，不应成为每次启动的固定开销。判定本体在 `GenerationCoordinator`，
    /// 这里保留同名入口供既有测试与调用方使用。
    static func autoTopUpAllowed(lastAutoTopUpAt: Date?, now: Date, interval: TimeInterval = 24 * 60 * 60) -> Bool {
        GenerationCoordinator.autoTopUpAllowed(lastAutoTopUpAt: lastAutoTopUpAt, now: now, interval: interval)
    }

    public func bootstrap() async {
        guard isLoadingSeed else { return }
        // 启动耗时打点：分阶段 signpost（Instruments 的 os_signpost 轨道可直接看）+ 结束时
        // 一条汇总日志。这是启动速度的测量基线——没有它，任何「启动更快」的改动都无法证实。
        let signposter = OSSignposter(subsystem: "com.knowflick.app", category: "bootstrap")
        let bootStart = ContinuousClock.now
        defer {
            let elapsed = ContinuousClock.now - bootStart
            Logger(subsystem: "com.knowflick.app", category: "bootstrap")
                .info("bootstrap 完成：\(elapsed.description, privacy: .public)")
        }
        // 文件 IO 与种子解码（338KB JSON）放后台线程，钥匙串读取保持主线程（协议隔离）；
        // 卡片与设置均一次性赋值，避免逐字段变更触发 didSet → recompute 风暴
        let storage = self.storage
        let loadState = signposter.beginInterval("loadLibrary")
        let io = Task.detached(priority: .userInitiated) { () -> (loaded: [KnowledgeCard], seeds: [KnowledgeCard], settings: AISettings) in
            (storage.loadCards(), Self.loadSeedCards(), storage.loadSettings())
        }
        let loaded = await io.value
        signposter.endInterval("loadLibrary", loadState)

        // 设置先于卡片就位：卡堆派生（来源开关 / 偏好分类）依赖设置。若把设置赋值留在
        // 钥匙串迁移之后（旧实现），cards 赋值会先按 .default 全库派生一遍、结尾再按真实
        // 设置重排一遍——启动白排两遍。此刻卡池还是空的，这次派生是 O(1)。
        settings = loaded.settings

        // 卡片库状态已经确定（无论空与否），从这里开始落盘就是安全的：先解除守卫再写盘。
        // 反过来（先写盘再解除）会让 bootstrap 期间的落盘被守卫吞掉，种子增量合并就永远存不下来。
        isLoadingSeed = false
        if !loaded.loaded.isEmpty {
            var merged = loaded.loaded
            // 自动同步增量种子卡：若内置 seed 库有新扩充卡片，增量合并到用户卡库。
            // 口径与导入去重一致：归一化 headline 比较，用户改过标点/大小写的种子卡不重复灌入
            let existingHeadlines = Set(merged.map { CardImportEngine.normalizeHeadline($0.headline) })
            let newSeeds = loaded.seeds.filter { !existingHeadlines.contains(CardImportEngine.normalizeHeadline($0.headline)) }
            merged.append(contentsOf: newSeeds)
            cards = merged
            if !newSeeds.isEmpty { persist() }
        } else if storage.libraryWasUsable {
            // 卡片文件解出来就是**合法的空数组**（用户清空过卡片库）：如实保持空库。
            // 旧实现会把它判成损坏并在这里灌入预置库——用户看到「自己的卡片没了，还多出一堆预置卡」。
            cards = []
        } else {
            // 首次启动，或主文件与备份都不可恢复：这才允许用预置库重新播种
            cards = loaded.seeds
            persist()
        }
        // 首次渲染窗口：上面的卡片赋值此刻还只是「脏状态」——bootstrap 从赋值到返回
        // 之间若没有任何挂起点，SwiftUI 没机会画一帧。而下面的钥匙串读取会弹安全授权
        // 对话框并阻塞主线程直到用户响应（CI 每次构建签名不同，用户装新版必弹）。
        // 不先渲染，弹窗期间用户看到的就是空库（实测「0 张未读卡片」）。
        // 挂起一小段时间让卡片库先上屏，再进入钥匙串读取。
        try? await Task.sleep(for: .milliseconds(120))

        let keychainState = signposter.beginInterval("keychainMigration")
        var migratedSettings = loaded.settings
        // 迁移旧版本可能写入 JSON 的密钥；成功进入 Keychain 后再清除明文。
        let legacyKey = migratedSettings.apiKey
        func persistMigratedSettings(_ settings: AISettings) {
            do {
                try storage.saveSettingsThrowing(settings)
            } catch {
                // 写失败不中断 bootstrap（迁移本身幂等，下次启动会重试），
                // 但必须可见——否则「settings.json 里明文密钥迟迟清不掉」无从排查
                Logger(subsystem: "com.knowflick.app", category: "bootstrap")
                    .error("密钥迁移后写设置失败，明文将保留至下次启动重试：\(error.localizedDescription, privacy: .public)")
            }
        }
        if let key = credentials.read(account: "apiKey") {
            migratedSettings.apiKey = key
            if !legacyKey.isEmpty { persistMigratedSettings(migratedSettings) }
        } else if !legacyKey.isEmpty {
            do {
                try credentials.save(legacyKey, account: "apiKey")
                persistMigratedSettings(migratedSettings)
            } catch {
                lastError = error.localizedDescription
            }
        }
        for i in migratedSettings.speech.profiles.indices {
            migratedSettings.speech.profiles[i].apiKey = credentials.read(account: "tts." + migratedSettings.speech.profiles[i].id) ?? ""
        }
        signposter.endInterval("keychainMigration", keychainState)
        // 迁移只补密钥字段（apiKey / TTS key），不触碰卡堆派生输入：settingsDidChange 的
        // 派生输入守卫保证这次赋值不再触发一次全库重排。
        settings = migratedSettings
        // 卡片不足时尝试自动生成（来源含 AI 且已配置才触发）。补卡是顺手行为而非每次启动
        // 的固定开销：24h 内已自动补过卡则跳过，避免每次启动都消耗用户 API 额度。
        // 失败同样记入节流窗口——失败的请求也可能已产生费用，且网络异常时不应每次启动都空打。
        // 自动补卡（卡片不足 + 来源含 AI 且已配置 + 24h 节流）：判定与触发都在
        // `GenerationCoordinator` 内（Wave C2），这里只调用；失败同样记入节流窗口。
        await generation.autoTopUpIfNeeded()
    }

    /// 生成成功后的写入回调（`GenerationCoordinator` 注入）：追加卡片池并落盘。
    /// 追加经 `cards` 触发卡堆派生分支 3——新卡按 minDistance 排在队尾，前部正在浏览的卡堆不动。
    private func appendGeneratedCards(_ newCards: [KnowledgeCard]) {
        cards.append(contentsOf: newCards)
        persist()
    }

    /// 「换一批」的跳顶卡回调（语义见 `GenerationCoordinator.refreshDeck`）
    private func skipTopCardForRefresh() {
        if let top = deck.first { swipe(top, direction: .skip) }
    }

    // MARK: - 持久化

    /// 落盘编排（节流 / revision 门 / 告警文案）已抽到 `PersistenceCoordinator`；
    /// AppStore 保留同名 API 作为对外转发，视图与测试零改动。
    /// 卡片快照此刻是否可信：判据（加载中且空库）由 `CardLibraryStore` 结合自己的 `cards` 动态计算，这里转发。
    private var cardSnapshotIsUntrusted: Bool { library.cardSnapshotIsUntrusted }

    /// 非密钥类设置的轻量变更（外观循环、磨耳朵语速等高频开关）：
    /// 内存即时生效，JSON 落盘经后台节流队列异步执行，不触碰钥匙串。
    /// 密钥类变更请走 `saveSettings`（同步抛错 + 钥匙串回滚语义）。
    public func applySettingsChange(_ mutate: (inout AISettings) -> Void) {
        var updated = settings
        mutate(&updated)
        settings = updated
        persistence.scheduleSettingsPersist(settings)
    }

    private func persist() {
        persistence.persist(cards: cards, skipCards: cardSnapshotIsUntrusted)
    }

    /// 切后台等场景的即时保存：取消节流并立即在后台队列落盘，不阻塞主线程。
    /// 真正退出（willTerminate）请用 `shutdown()`，其同步等待写入完成。
    public func persistImmediately() {
        persistence.persistImmediately(cards: cards, settings: settings, skipCards: cardSnapshotIsUntrusted)
    }

    /// 应用退出前同步保存最后状态，并等待已提交的写入完成。
    public func flushPersistence() {
        persistence.flushPersistence(cards: cards, settings: settings, skipCards: cardSnapshotIsUntrusted)
    }

    public func retryPersistence() { persist() }

    /// 进入后台或应用退出前释放异步任务和音频资源，避免窗口关闭后仍继续播报或持有状态。
    public func shutdown() {
        closeChat()
        speechService.setSleepTimer(minutes: 0)
        speechService.stopAmbientMode()
        speechService.onAmbientAdvanceRequest = nil
        speechService.onTransportNext = nil
        speechService.onTransportPrevious = nil
        // 摘掉媒体键并清空控制中心，否则退出过程中系统还会把按键打到已释放的播放器
        speechService.teardownNowPlaying()
        persistence.cancelPendingThrottles()
        flushPersistence()
    }

    // MARK: - 刷卡动作

    // 以下卡片域动作的状态与实现已随拆分方案 B Step 5 移入 `CardLibraryStore`：
    // 语义契约（skip 不表达喜好、收藏解耦、导入防重插回等）的完整注释在子系统内，
    // 这里只保留同名转发，对外 API 与成员名不变（视图与测试零改动）。

    /// Explicit reading completion preserves collection membership and review history.
    public func completeReading(_ card: KnowledgeCard) {
        library.completeReading(card)
    }

    @discardableResult
    public func updateCardContent(id: UUID, headline: String, category: String, summary: String, details: String) -> Bool {
        library.updateCardContent(id: id, headline: headline, category: category, summary: summary, details: details)
    }

    public func swipe(_ card: KnowledgeCard, direction: SwipeDirection) {
        library.swipe(card, direction: direction)
    }

    /// 撤销上一张（从历史顶部退回卡堆顶部）
    public func undoLastSwipe() {
        library.undoLastSwipe()
    }

    /// 清空历史（「重新探索全部卡片」）：重置浏览记录，保留收藏。
    public func clearHistory() {
        library.clearHistory()
    }

    /// 将指定卡片置顶到待刷卡堆顶部（走 `DeckDeriver` 统一插回入口，带防重校验）。
    public func promoteToDeckTop(_ card: KnowledgeCard) {
        library.promoteToDeckTop(card)
    }

    // MARK: - 收藏管理与笔记导出

    /// 切换卡片的收藏状态（只翻转 isFavorite，不写 seenAt、不改写 swiped）
    public func toggleFavorite(_ card: KnowledgeCard) {
        library.toggleFavorite(card)
    }

    /// 检查某张卡片是否已被收藏
    public func isFavorite(_ card: KnowledgeCard) -> Bool {
        library.isFavorite(card)
    }

    /// 导出收藏夹为兼容 Obsidian / Notion 的 Markdown 格式（渲染在 CardExportEngine）。
    public func exportFavoritesMarkdown(filtered: [KnowledgeCard]? = nil) -> String {
        library.exportFavoritesMarkdown(filtered: filtered)
    }

    // MARK: - 卡片批量导入与笔记提炼

    @discardableResult
    public func importCards(_ incoming: [KnowledgeCard], insertAtTop: Bool = true) -> CardImportResult {
        library.importCards(incoming, insertAtTop: insertAtTop)
    }

    /// 智能合并外部卡片库（支持局域网同步就地升级已有卡片的学习进度与内容）
    @discardableResult
    public func mergeCards(_ incoming: [KnowledgeCard], insertNewAtTop: Bool = false) -> (added: Int, updated: Int, ignored: Int) {
        library.mergeCards(incoming, insertNewAtTop: insertNewAtTop)
    }

    // MARK: - 局域网同步（协议 v2）

    /// 本地墓碑表内存快照：SyncServer 的 `getTombstones` 闭包由此取值（GET 载荷携带本地墓碑表）。
    public var currentTombstones: [SyncTombstone] { tombstones }

    /// 局域网同步合并入口（协议 §4）：合并对端卡片 + 应用对端墓碑，墓碑表变更落盘。
    ///
    /// - 卡片有变更（新增/更新/被对端墓碑删除）时**立即落盘**（persistImmediately，
    ///   不等 350ms 节流）——对应协议 §8「合并落库后显式落盘」，消除同步完成点的 kill-app 丢数窗口。
    /// - 墓碑表变更经持久化队列落盘，与卡片写入保持「先删卡后记墓碑」的跨文件顺序。
    /// - 返回 (added, updated, ignored, deleted)：`deleted` 仅统计规则 1 实际触发的本地删除
    ///   （POST 响应的 `"deleted":n` 上报给对端）。
    @discardableResult
    public func applySyncPayload(cards incomingCards: [KnowledgeCard], tombstones incomingTombstones: [SyncTombstone]) -> (added: Int, updated: Int, ignored: Int, deleted: Int) {
        let outcome = CardImportEngine.mergeSyncPayload(
            existing: cards,
            localTombstones: tombstones,
            incomingCards: incomingCards,
            incomingTombstones: incomingTombstones
        )
        if outcome.added > 0 || outcome.updated > 0 || outcome.deleted > 0 {
            cards = outcome.cards
            persistImmediately()
        }
        if outcome.tombstones != tombstones {
            tombstones = outcome.tombstones
            persistence.saveTombstones(outcome.tombstones)
        }
        return (outcome.added, outcome.updated, outcome.ignored, outcome.deleted)
    }

    /// 通过 AI 将长文笔记提纯为知识卡片
    public func transformNoteToCards(noteContent: String) async throws -> [KnowledgeCard] {
        try await aiService.transformNoteToCards(noteText: noteContent, settings: settings)
    }

    // MARK: - 知识测验 (Flashcard Quiz)

    /// 测验自评档位：定义移入 `CardLibraryStore`（与测验记录动作同域），typealias 保持 `AppStore.QuizRating` 原名可用。
    public typealias QuizRating = CardLibraryStore.QuizRating

    /// 记录单次测验反馈：更新卡片掌握度与复习次数，并写盘
    public func recordQuizResult(cardId: UUID, rating: QuizRating) {
        library.recordQuizResult(cardId: cardId, rating: rating)
    }

    /// 测验选题：域逻辑在 `QuizBuilder`（纯函数，可测排序与打乱），这里只做输入装配；
    /// 优先级规则（收藏/历史优先、掌握度升序）见 `QuizBuilder.ranked`
    public func generateQuizCards(category: String? = nil, limit: Int = 10) -> [KnowledgeCard] {
        QuizBuilder.selectCards(
            cards: cards,
            favorites: favorites,
            history: history,
            category: category,
            limit: limit
        )
    }

    // MARK: - 知识星图与语义关联链 (Knowledge Graph & Connected Cards)

    /// 获取指定卡片的相关灵感卡片列表
    public func getRelatedCards(for card: KnowledgeCard, limit: Int = 3) -> [RelatedCardItem] {
        KnowledgeGraphEngine.findRelatedCards(for: card, in: cards, limit: limit)
    }

    // MARK: - AI 生成

    // 生成域的方法与状态已随 Wave C2 移入 `GenerationCoordinator`（并发守卫 / 计时 /
    // exclude 装配 / 自动补卡节流的完整契约注释在子系统内），这里只保留同名转发，
    // 对外 API 与成员名不变（视图与测试零改动）。

    /// 生成 count 张新卡片并追加到队列
    /// - Parameter topic: 可选主题，非空时围绕该主题生成（全局搜索「围绕关键词生成」入口使用）
    public func generateNewCards(count: Int = 3, topic: String? = nil) async {
        await generation.generateNewCards(count: count, topic: topic)
    }

    /// 手动触发：换一批新知识——只跳过**当前顶卡**，再按设置条件生成新卡（语义见子系统）。
    public func refreshDeck() async {
        await generation.refreshDeck()
    }

    // MARK: - 设置

    /// 保存设置：key 单独进 Keychain，其余进 JSON；失败抛错。
    /// 事务细节（提交顺序、钥匙串回滚）已抽到 `SettingsStore`，这里只做「提交成功才写内存」。
    public func saveSettings(_ newSettings: AISettings) throws {
        settings = try settingsStore.commit(newSettings, replacing: settings)
    }

    /// 连通性测试：轻量 ping 请求，不消耗额度
    public func testConnection(settings testSettings: AISettings) async -> String {
        await settingsStore.testConnection(testSettings)
    }

    // MARK: - 语音与发音朗读接口

    /// 切换顶卡语音朗读 / 暂停
    public func toggleSpeechForTopCard() {
        guard let card = topCard else { return }
        speechService.togglePlayPause(for: card)
    }

    /// 切换磨耳朵连续播报模式
    public func toggleAmbientSpeechMode() {
        speechService.toggleAmbientMode(currentCard: topCard)
    }

    /// 停止全部语音播报
    public func stopSpeech() {
        speechService.stop()
        speechService.stopAmbientMode()
    }

    // MARK: - 卡片追问对话 (Card Follow-up Chat)

    // 会话状态与编排已抽到 `ChatSessionStore`（拆分方案 B Step 3）：状态属性在上方转发，
    // 方法在这里转发，对外 API 与成员名保持不变（视图层零 diff）。

    /// 打开某张卡片的 AI 追问面板。
    /// 读盘不再发生在主线程（旧实现在 MainActor 上全量读 + 解码 chat_sessions.json），
    /// 而是先给内存快照、再由 ChatSessionStore 排到串行队列异步校正。
    public func openChat(for card: KnowledgeCard) {
        chat.openChat(for: card)
    }

    /// 关闭追问面板
    public func closeChat() {
        chat.closeChat()
    }

    /// 发送追问消息
    public func sendChatMessage(prompt: String) {
        chat.sendChatMessage(prompt: prompt, settings: settings)
    }

    /// 终止当前流式生成
    public func cancelChatStreaming() {
        chat.cancelStreaming()
    }

    /// 清空当前卡片的追问历史
    public func clearCurrentChatSession() {
        chat.clearCurrentSession()
    }

    /// 将助手追问回复提炼为新卡片并插入卡堆
    @discardableResult
    public func deriveAndSaveCardFromChat(message: CardChatMessage, parentCard: KnowledgeCard) -> KnowledgeCard {
        let newCard = CardChatInsightDeriver.deriveCard(from: message.content, parentCard: parentCard)
        chat.savedCardMessageIds.insert(message.id)
        importCards([newCard], insertAtTop: true)
        return newCard
    }

    /// 导出当前追问会话为 Markdown
    public func exportCurrentChatMarkdown() -> String? {
        guard let session = currentChatSession, let card = activeChatCard else { return nil }
        return CardChatInsightDeriver.exportMarkdown(session: session, parentCard: card)
    }

    // MARK: - 搜索历史管理

    /// 记录一条搜索关键词（前插、去重、上限 8 条、过滤空串）
    public func addSearchHistory(_ query: String) {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        var list = searchHistory.filter { $0 != trimmed }
        list.insert(trimmed, at: 0)
        if list.count > 8 {
            list = Array(list.prefix(8))
        }
        searchHistory = list
        schedulePersistSearchHistory()
    }

    /// 移除单条搜索历史记录
    public func removeSearchHistory(_ query: String) {
        searchHistory.removeAll { $0 == query }
        schedulePersistSearchHistory()
    }

    /// 清空全部搜索历史
    public func clearSearchHistory() {
        searchHistory.removeAll()
        schedulePersistSearchHistory()
    }

    private func schedulePersistSearchHistory() {
        // 落盘编排与告警口径统一走 PersistenceCoordinator：失败上浮 persistenceWarning 横幅，
        // 与卡片/设置一致（原先直写队列失败只进 NSLog，用户无从得知）
        persistence.scheduleSearchHistoryPersist(searchHistory)
    }

    // MARK: - 预置库

    private nonisolated static func loadSeedCards() -> [KnowledgeCard] {
        // 用 CoreResources.bundle 而非 Bundle.module：后者在 Xcode 26.x 构建的 .app 里
        // 找不到 Contents/Resources 下的资源 bundle（详见 CoreResources 的说明）
        guard let url = CoreResources.bundle.url(forResource: "seed_cards", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return [] }
        struct SeedCard: Decodable {
            let category: String
            let headline: String
            let summary: String
            let details: String
            let links: [ScienceLink]
        }
        guard let seeds = try? JSONDecoder().decode([SeedCard].self, from: data) else { return [] }
        let now = Date()
        return seeds.map {
            KnowledgeCard(
                category: $0.category,
                headline: $0.headline,
                summary: $0.summary,
                details: $0.details,
                links: $0.links,
                source: .seed,
                createdAt: now
            )
        }
    }
}
