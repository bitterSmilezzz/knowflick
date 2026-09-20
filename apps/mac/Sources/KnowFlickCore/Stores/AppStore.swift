import Foundation
import Observation

/// 全局状态：卡片池、历史记录、设置、AI 生成
@MainActor
@Observable
public final class AppStore {
    // MARK: - 持久化状态

    public var cards: [KnowledgeCard] = [] {
        didSet {
            recomputeDeckAndHistory()
        }
    }
    public var settings: AISettings = .default {
        didSet {
            recomputeDeckAndHistory()
            speechService.configuration = settings.speech
            speechService.speedMultiplier = settings.speechRate
            speechService.preferredVoiceIdentifier = settings.speechVoiceIdentifier
            speechService.ambientGapSeconds = settings.ambientGapSeconds
        }
    }
    public var isGenerating = false
    public var lastError: String?
    /// 落盘告警（顶栏横幅）：由 `PersistenceCoordinator` 持有，这里转发。
    /// 转发属性同样能被观察（`@Observable` 的读取会穿透到协调器），视图零改动。
    public var persistenceWarning: String? { persistence.persistenceWarning }

    // MARK: - 运行期状态

    public var isLoadingSeed = true                 // 首启是否还在加载预置库

    public private(set) var deck: [KnowledgeCard] = []
    public private(set) var history: [KnowledgeCard] = []

    /// 语音朗读与磨耳朵服务
    public let speechService: SpeechSynthesizerService

    /// 全文检索与智能搜索引擎
    public let searchEngine = KnowledgeSearchEngine()

    /// 收藏阁：显式收藏的卡片列表（按收藏时间倒序，与喜好意图解耦）。
    /// 存储派生快照，随 recomputeDeckAndHistory 刷新；避免视图 body 每次访问都全库 filter+sort。
    public private(set) var favorites: [KnowledgeCard] = []

    public var topCard: KnowledgeCard? { deck.first }

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

    private let aiService: AIService
    private let storage: Storage
    private let credentials: any CredentialStore
    /// 串行持久化队列：卡片、设置、聊天会话共用同一条，保证「先后顺序」在跨文件写之间也成立
    private let persistenceQueue: DispatchQueue
    private let persistence: PersistenceCoordinator
    private let chat: ChatSessionStore
    private let settingsStore: SettingsStore
    private var lastSwipedCardId: UUID?
    private var lastSwipedKey: String?

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
        recomputeDeckAndHistory()

        self.speechService.speedMultiplier = settings.speechRate
        self.speechService.preferredVoiceIdentifier = settings.speechVoiceIdentifier
        self.speechService.ambientGapSeconds = settings.ambientGapSeconds

        self.speechService.onAmbientAdvanceRequest = { [weak self] in
            guard let self = self else { return nil }
            if let current = self.topCard {
                self.swipe(current, direction: .skip)
            }
            return self.topCard
        }
    }

    /// 卡片池 → 卡堆/历史/收藏 的派生统一走 `DeckDeriver`（纯函数，可穷举单测）。
    /// 这里只做「取值 → 派生 → 一次性赋值」，避免逐项变更触发观察风暴。
    private func recomputeDeckAndHistory() {
        let derived = DeckDeriver.derive(
            cards: cards,
            currentDeck: deck,
            enableSeed: settings.enableSeed,
            enableAI: settings.enableAI,
            preferredCategories: settings.preferredCategories,
            lastSwipedCardId: lastSwipedCardId,
            lastSwipedKey: lastSwipedKey
        )
        history = derived.history
        favorites = derived.favorites
        deck = derived.deck
    }

    // MARK: - 生命周期

    public func bootstrap() async {
        guard isLoadingSeed else { return }
        // 文件 IO 与种子解码（338KB JSON）放后台线程，钥匙串读取保持主线程（协议隔离）；
        // 卡片与设置均一次性赋值，避免逐字段变更触发 didSet → recompute 风暴
        let storage = self.storage
        let io = Task.detached(priority: .userInitiated) { () -> (loaded: [KnowledgeCard], seeds: [KnowledgeCard], settings: AISettings) in
            (storage.loadCards(), Self.loadSeedCards(), storage.loadSettings())
        }
        let loaded = await io.value

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
        var migratedSettings = loaded.settings
        // 迁移旧版本可能写入 JSON 的密钥；成功进入 Keychain 后再清除明文。
        let legacyKey = migratedSettings.apiKey
        if let key = credentials.read(account: "apiKey") {
            migratedSettings.apiKey = key
            if !legacyKey.isEmpty { try? storage.saveSettingsThrowing(migratedSettings) }
        } else if !legacyKey.isEmpty {
            do {
                try credentials.save(legacyKey, account: "apiKey")
                try? storage.saveSettingsThrowing(migratedSettings)
            } catch {
                lastError = error.localizedDescription
            }
        }
        for i in migratedSettings.speech.profiles.indices {
            migratedSettings.speech.profiles[i].apiKey = credentials.read(account: "tts." + migratedSettings.speech.profiles[i].id) ?? ""
        }
        settings = migratedSettings
        // 卡片不足时尝试自动生成（来源含 AI 且已配置才触发）
        if deck.count < 5 && settings.autoGenerate && settings.isAIConfigured && settings.enableAI {
            await generateNewCards()
        }
    }

    // MARK: - 持久化

    /// 落盘编排（节流 / revision 门 / 告警文案）已抽到 `PersistenceCoordinator`；
    /// AppStore 保留同名 API 作为对外转发，视图与测试零改动。
    /// 卡片快照此刻是否可信：bootstrap 未完成（`isLoadingSeed`）时内存里的 `cards` 还是默认值 `[]`，
    /// 落盘等于把「空库」写成用户数据（实测「启动未完成即退出」会让 cards.json 变成 `[]`，
    /// 下次启动被判损坏并重播种）。判据取「仍在加载中 **且** 没有任何卡片」：加载中却有卡片 =
    /// 调用方已经明确放进来的内容，照常落盘；两者同时成立才说明这份快照不可信。
    private var cardSnapshotIsUntrusted: Bool { isLoadingSeed && cards.isEmpty }

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
        speechService.stopAmbientMode()
        speechService.onAmbientAdvanceRequest = nil
        persistence.cancelPendingThrottles()
        flushPersistence()
    }

    // MARK: - 刷卡动作

    /// Explicit reading completion preserves collection membership and review history.
    public func completeReading(_ card: KnowledgeCard) {
        guard let index = cards.firstIndex(where: { $0.id == card.id }) else { return }
        var updated = cards
        updated[index].seenAt = Date()
        cards = updated
        persist()
    }

    /// Edit content without replacing the card or its learning state.
    @discardableResult
    public func updateCardContent(id: UUID, headline: String, category: String, summary: String, details: String) -> Bool {
        let fields = [headline, category, summary, details].map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard fields.allSatisfy({ !$0.isEmpty }), let index = cards.firstIndex(where: { $0.id == id }) else { return false }
        var updated = cards
        updated[index].headline = fields[0]
        updated[index].category = fields[1]
        updated[index].summary = fields[2]
        updated[index].details = fields[3]
        cards = updated
        persist()
        return true
    }

    /// 卡片被划走：记入历史并落盘。
    /// - `right` = 感兴趣：同时写入收藏（与「收藏阁」入口语义一致）
    /// - `left` = 不喜欢：同时移出收藏，避免「不喜欢却仍在收藏阁」
    /// - `skip` = 系统跳过：只写浏览状态，不表达喜好，也不动收藏
    /// 已看过的卡片（历史页/收藏阁打标签等场景）保留原 `seenAt`，避免时间线被重排。
    public func swipe(_ card: KnowledgeCard, direction: SwipeDirection) {
        guard let idx = cards.firstIndex(where: { $0.id == card.id }) else { return }
        lastSwipedCardId = card.id
        lastSwipedKey = CardThemeResolver.resolveKey(for: card)
        var updated = cards
        if updated[idx].seenAt == nil { updated[idx].seenAt = Date() }
        updated[idx].swiped = direction
        switch direction {
        case .right:
            updated[idx].isFavorite = true
            updated[idx].favoritedAt = updated[idx].favoritedAt ?? Date()
        case .left:
            updated[idx].isFavorite = false
            updated[idx].favoritedAt = nil
        case .skip: break
        }
        cards = updated
        persist()
    }

    /// 撤销上一张（从历史顶部退回卡堆顶部）
    public func undoLastSwipe() {
        guard let last = history.first,
              let idx = cards.firstIndex(where: { $0.id == last.id }) else { return }
        // 与 recomputeDeckAndHistory 的「插回顶部」分支对齐：撤销目标就是这张卡。
        lastSwipedCardId = last.id
        lastSwipedKey = CardThemeResolver.resolveKey(for: last)
        var updated = cards
        updated[idx].seenAt = nil
        updated[idx].swiped = nil
        cards = updated
        persist()
    }

    /// 清空历史（「重新探索全部卡片」）：重置浏览记录以重新开始探索。
    /// - 清除 `seenAt`：卡片回到待刷卡堆，历史时间线与由此派生的统计（已刷/喜欢率/连续天数）随之归零，
    ///   这是「重新探索」的预期语义。
    /// - **保留 `isFavorite`**：收藏阁是用户显式沉淀的内容，不因重置浏览进度而丢失。
    /// - 保留 `swiped`：它只在 `seenAt != nil` 时参与统计，清空后不可见，下次刷卡会覆写，无需额外清理。
    public func clearHistory() {
        var updated = cards
        for i in updated.indices {
            updated[i].seenAt = nil
        }
        cards = updated
        persist()
    }

    /// 将指定卡片置顶到待刷卡堆顶部（例如通过全局搜索快速定位并准备浏览）。
    /// 走 `DeckDeriver` 的统一插回入口：置顶语义不变，但插入前做防重校验（P2-3）。
    public func promoteToDeckTop(_ card: KnowledgeCard) {
        guard let target = cards.first(where: { $0.id == card.id }) else { return }
        if deck.first?.id == target.id { return }
        self.deck = DeckDeriver.insertRespectingMinDistance(target, into: deck)
    }

    // MARK: - 收藏管理与笔记导出

    /// 切换卡片的收藏状态（已收藏则取消收藏为 skip，未收藏则标记为 right 收藏）
    public func toggleFavorite(_ card: KnowledgeCard) {
        guard let idx = cards.firstIndex(where: { $0.id == card.id }) else { return }
        var updated = cards
        // 收藏与喜好意图解耦：只翻转 isFavorite，不改写 swiped（否则会污染喜欢/不喜欢统计）。
        // 也不写 seenAt：收藏一张未读卡不应被计为「已浏览」（否则今日目标/统计/复习队列都会凭空 +1）。
        // 收藏时间单独记在 favoritedAt，供收藏阁排序（取消收藏时一并清空）。
        updated[idx].isFavorite.toggle()
        updated[idx].favoritedAt = updated[idx].isFavorite ? Date() : nil
        cards = updated
        persist()
    }

    /// 检查某张卡片是否已被收藏
    public func isFavorite(_ card: KnowledgeCard) -> Bool {
        cards.first(where: { $0.id == card.id })?.isFavorite ?? false
    }

    /// 导出收藏夹为兼容 Obsidian / Notion 的 Markdown 格式。
    /// 渲染统一由 CardExportEngine 承担（目录锚点、来源标注、收藏时间口径与通用导出一致）。
    public func exportFavoritesMarkdown(filtered: [KnowledgeCard]? = nil) -> String {
        CardExportEngine.exportFavoritesMarkdown(cards: filtered ?? favorites)
    }

    // MARK: - 卡片批量导入与笔记提炼

    @discardableResult
    public func importCards(_ incoming: [KnowledgeCard], insertAtTop: Bool = true) -> CardImportResult {
        let (toAdd, dupCount) = CardImportEngine.deduplicateAndMerge(existing: cards, incoming: incoming)
        guard !toAdd.isEmpty else {
            return CardImportResult(parsedCards: [], duplicateCount: dupCount, sourceDescription: "所有卡片均已存在，已自动去重")
        }

        let processed = toAdd
        if insertAtTop {
            // didSet 已同步触发 recomputeDeckAndHistory，无需再显式重算一遍。
            // 只有**真正进入卡堆**的导入卡才置顶（已读卡、被来源开关过滤掉的卡不在卡堆里，口径与原先一致）；
            // 逐张从底部反插到队首，让每张都过一次防重校验，保证「导入块 ↔ 原队首」的新接缝也不撞图（P2-3）。
            // 无冲突时结果与原先的 `promoted + otherDeck` 完全一致（导入块内部相对顺序不变）。
            cards = processed + cards
            let processedIds = Set(processed.map(\.id))
            let promoted = deck.filter { processedIds.contains($0.id) }
            var updatedDeck = deck.filter { !processedIds.contains($0.id) }
            for card in promoted.reversed() {
                updatedDeck = DeckDeriver.insertRespectingMinDistance(card, into: updatedDeck)
            }
            self.deck = updatedDeck
        } else {
            cards.append(contentsOf: processed)
            recomputeDeckAndHistory()
        }
        persist()

        return CardImportResult(
            parsedCards: processed,
            duplicateCount: dupCount,
            sourceDescription: "成功导入 \(processed.count) 张新卡片\(dupCount > 0 ? "，自动去重跳过 \(dupCount) 张" : "")"
        )
    }

    /// 智能合并外部卡片库（支持局域网同步就地升级已有卡片的学习进度与内容）
    @discardableResult
    public func mergeCards(_ incoming: [KnowledgeCard], insertNewAtTop: Bool = false) -> (added: Int, updated: Int, ignored: Int) {
        let (merged, added, updated, ignored) = CardImportEngine.mergeCardList(existing: cards, incoming: incoming)
        guard added > 0 || updated > 0 else {
            return (added: 0, updated: 0, ignored: ignored)
        }

        if insertNewAtTop && added > 0 {
            let newCards = Array(merged.suffix(added))
            let existingAndUpdated = Array(merged.prefix(merged.count - added))
            cards = newCards + existingAndUpdated
        } else {
            cards = merged
        }
        persist()

        return (added: added, updated: updated, ignored: ignored)
    }

    /// 通过 AI 将长文笔记提纯为知识卡片
    public func transformNoteToCards(noteContent: String) async throws -> [KnowledgeCard] {
        try await aiService.transformNoteToCards(noteText: noteContent, settings: settings)
    }

    // MARK: - 知识测验 (Flashcard Quiz)

    public enum QuizRating: Int, CaseIterable, Identifiable {
        case forgot = 1      // 没想起来 (完全遗忘)
        case hesitant = 2    // 犹豫想起 (模糊记忆)
        case mastered = 3    // 熟练掌握 (清晰再认)

        public var id: Int { rawValue }

        public var title: String {
            switch self {
            case .forgot: return "没想起来"
            case .hesitant: return "犹豫想起"
            case .mastered: return "熟练掌握"
            }
        }

        public var icon: String {
            switch self {
            case .forgot: return "xmark.circle.fill"
            case .hesitant: return "questionmark.circle.fill"
            case .mastered: return "checkmark.circle.fill"
            }
        }

        public var shortcut: String {
            switch self {
            case .forgot: return "⌘1"
            case .hesitant: return "⌘2"
            case .mastered: return "⌘3"
            }
        }
    }

    /// 记录单次测验反馈：更新卡片掌握度与复习次数，并写盘
    public func recordQuizResult(cardId: UUID, rating: QuizRating) {
        guard let idx = cards.firstIndex(where: { $0.id == cardId }) else { return }
        var updated = cards
        updated[idx].reviewCount += 1
        updated[idx].lastReviewedAt = Date()
        switch rating {
        case .forgot:
            updated[idx].masteryLevel = 0
        case .hesitant:
            updated[idx].masteryLevel = 1
        case .mastered:
            updated[idx].masteryLevel = 2
        }
        cards = updated
        persist()
    }

    /// 生成测验题库：可按分类筛选；优先收藏与未掌握卡片，混合历史已读卡片，生成指定数量并打乱
    public func generateQuizCards(category: String? = nil, limit: Int = 10) -> [KnowledgeCard] {
        guard limit > 0 else { return [] }
        var pool: [KnowledgeCard] = []

        if let category = category, !category.isEmpty {
            let catFavs = favorites.filter { $0.category == category }
            let catFavIds = Set(catFavs.map(\.id))
            let catHistory = history.filter { $0.category == category && !catFavIds.contains($0.id) }
            pool = catFavs + catHistory
            if pool.isEmpty {
                pool = cards.filter { $0.category == category }
            }
        } else {
            let favs = favorites
            let favIds = Set(favs.map(\.id))
            let others = history.filter { !favIds.contains($0.id) }
            pool = favs + others
            if pool.count < limit {
                let poolIds = Set(pool.map(\.id))
                let rest = cards.filter { !poolIds.contains($0.id) }
                pool += rest
            }
        }

        let sorted = pool.sorted { c1, c2 in
            if c1.masteryLevel != c2.masteryLevel {
                return c1.masteryLevel < c2.masteryLevel
            }
            let r1 = c1.lastReviewedAt ?? .distantPast
            let r2 = c2.lastReviewedAt ?? .distantPast
            return r1 < r2
        }

        let countToTake = min(limit, sorted.count)
        let selection = Array(sorted.prefix(countToTake))
        return selection.shuffled()
    }

    // MARK: - 知识星图与语义关联链 (Knowledge Graph & Connected Cards)

    /// 获取指定卡片的相关灵感卡片列表
    public func getRelatedCards(for card: KnowledgeCard, limit: Int = 3) -> [RelatedCardItem] {
        KnowledgeGraphEngine.findRelatedCards(for: card, in: cards, limit: limit)
    }

    // MARK: - AI 生成

    /// 生成 count 张新卡片并追加到队列
    /// - Parameter topic: 可选主题，非空时围绕该主题生成（全局搜索「围绕关键词生成」入口使用）
    public func generateNewCards(count: Int = 3, topic: String? = nil) async {
        guard !isGenerating else { return }
        isGenerating = true
        defer { isGenerating = false }

        do {
            // 排除标题传全量，截断上限由 AIService 单点决定
            let existing = cards.map { $0.headline }
            let newCards = try await aiService.generateCards(
                settings: settings,
                count: count,
                excludeHeadlines: existing,
                topic: topic
            )
            cards.append(contentsOf: newCards)
            persist()
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// 手动触发：换一批新知识——只跳过**当前顶卡**，再按设置条件生成新卡。
    ///
    /// 为什么不是「跳过整个卡堆」：`deck` 是全部未读卡（实测用户库 216 张），整堆写 `seenAt`/`skip`
    /// 会让待刷池一次归零、历史 +216、`skipCount` +216，直接污染今日目标与连续天数，
    /// 用户只能靠「重新探索全部卡片」回退（同时丢掉真实浏览进度）。
    /// 口径对齐 Android 端「换一批」只跳顶卡（`DeckScreen.kt:224`），也复用意图化方法 `swipe`，
    /// 保证 `skip` 语义（仅计已刷、不表达喜好、按 CONTEXT.md 不动收藏）与其它入口一致。
    public func refreshDeck() async {
        if let top = deck.first {
            swipe(top, direction: .skip)
        }
        if settings.autoGenerate && settings.isAIConfigured && settings.enableAI {
            await generateNewCards(count: 6)
        }
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
