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
    public private(set) var persistenceWarning: String?

    // MARK: - 运行期状态

    public var isLoadingSeed = true                 // 首启是否还在加载预置库

    public private(set) var deck: [KnowledgeCard] = []
    public private(set) var history: [KnowledgeCard] = []

    /// 语音朗读与磨耳朵服务
    public let speechService: SpeechSynthesizerService

    /// 全文检索与智能搜索引擎
    public let searchEngine = KnowledgeSearchEngine()

    /// 收藏阁：显式收藏的卡片列表（按收藏时间倒序，与喜好意图解耦）
    public var favorites: [KnowledgeCard] {
        cards.filter(\.isFavorite)
            .sorted { ($0.favoritedAt ?? .distantPast) > ($1.favoritedAt ?? .distantPast) }
    }

    public var topCard: KnowledgeCard? { deck.first }

    /// 智能追问当前激活卡片与会话
    public var activeChatCard: KnowledgeCard? = nil
    public var currentChatSession: CardChatSession? = nil
    public var isChatStreaming: Bool = false
    public var chatErrorMessage: String? = nil
    private var chatStreamTask: Task<Void, Never>? = nil

    private let aiService = AIService()
    private let storage: Storage
    private let credentials: any CredentialStore
    private var lastSwipedCardId: UUID?
    private var lastSwipedKey: String?

    public init(
        storage: Storage = Storage(),
        credentials: (any CredentialStore)? = nil,
        speechService: SpeechSynthesizerService? = nil
    ) {
        self.storage = storage
        self.credentials = credentials ?? SystemCredentialStore()
        self.speechService = speechService ?? SpeechSynthesizerService()
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

    private func recomputeDeckAndHistory() {
        let hist = cards.filter { $0.seenAt != nil }.sorted { ($0.seenAt ?? .distantPast) > ($1.seenAt ?? .distantPast) }
        self.history = hist

        var unseen = cards.filter { $0.seenAt == nil }
        // 来源开关：只开其一则只看该来源；全关则队列为空（含外部导入卡片，口径见 CONTEXT.md）
        if !settings.enableSeed || !settings.enableAI {
            unseen = unseen.filter {
                switch $0.source {
                case .seed: return settings.enableSeed
                case .ai: return settings.enableAI
                case .imported: return false
                }
            }
        }
        let prefs = settings.preferredCategories
        let filtered: [KnowledgeCard]
        if prefs.isEmpty {
            filtered = unseen
        } else {
            let preferred = unseen.filter { prefs.contains($0.category) }
            filtered = preferred.isEmpty ? unseen : preferred
        }

        let existingDeckIds = Set(deck.map(\.id))
        let currentCards = Dictionary(filtered.map { ($0.id, $0) }, uniquingKeysWith: { _, latest in latest })
        let remainingInDeck = deck.compactMap { currentCards[$0.id] }
        let newCards = filtered.filter { !existingDeckIds.contains($0.id) }

        if !remainingInDeck.isEmpty && newCards.isEmpty {
            // 绝大多数日常划卡出队场景：直接移除划走卡片，100% 保留排好的无碰撞队列顺序，杜绝重排抖动
            self.deck = remainingInDeck
        } else if !remainingInDeck.isEmpty && newCards.count == 1 && newCards.first?.id == lastSwipedCardId {
            // 撤销上一张场景：将卡片精准插回顶部
            self.deck = [newCards[0]] + remainingInDeck
        } else if !remainingInDeck.isEmpty && !newCards.isEmpty && newCards.count <= 10 {
            // 后台 AI 异步生成新卡（3~6 张）：对新卡安排 minDistance 排布后追加至末尾，绝不打散前部正在浏览的卡堆
            let lastKey = remainingInDeck.last.map { CardThemeResolver.resolveKey(for: $0) }
            let arrangedNew = CardThemeResolver.arrangeWithMinDistance(newCards, minDistance: 5, avoidingTopKey: lastKey)
            self.deck = remainingInDeck + arrangedNew
        } else {
            // 全新初始化、切换分类过滤、清空历史等场景：全量重新排布无碰撞队列
            let lastKey = hist.first.map { CardThemeResolver.resolveKey(for: $0) } ?? lastSwipedKey
            self.deck = CardThemeResolver.arrangeWithMinDistance(filtered, minDistance: 5, avoidingTopKey: lastKey)
        }
    }

    // MARK: - 生命周期

    public func bootstrap() async {
        guard isLoadingSeed else { return }
        let loadedCards = storage.loadCards()
        if !loadedCards.isEmpty {
            cards = loadedCards
            // 自动同步增量种子卡：若内置 seed 库有新扩充卡片，增量合并到用户卡库
            let existingHeadlines = Set(cards.map(\.headline))
            let seeds = loadSeedCards()
            let newSeeds = seeds.filter { !existingHeadlines.contains($0.headline) }
            if !newSeeds.isEmpty {
                cards.append(contentsOf: newSeeds)
                persist()
            }
        } else {
            cards = loadSeedCards()
            persist()
        }
        settings = storage.loadSettings()
        // 迁移旧版本可能写入 JSON 的密钥；成功进入 Keychain 后再清除明文。
        let legacyKey = settings.apiKey
        if let key = credentials.read(account: "apiKey") {
            settings.apiKey = key
            if !legacyKey.isEmpty { try? storage.saveSettingsThrowing(settings) }
        } else if !legacyKey.isEmpty {
            do {
                try credentials.save(legacyKey, account: "apiKey")
                try? storage.saveSettingsThrowing(settings)
            } catch {
                lastError = error.localizedDescription
            }
        }
        for i in settings.speech.profiles.indices {
            settings.speech.profiles[i].apiKey = credentials.read(account: "tts." + settings.speech.profiles[i].id) ?? ""
        }
        isLoadingSeed = false
        // 卡片不足时尝试自动生成（来源含 AI 且已配置才触发）
        if deck.count < 5 && settings.autoGenerate && settings.isAIConfigured && settings.enableAI {
            await generateNewCards()
        }
    }

    // MARK: - 持久化

    private var persistTask: Task<Void, Never>?
    private var persistenceRevision: UInt64 = 0

    private let persistenceQueue = DispatchQueue(label: "com.knowflick.persistence", qos: .utility)

    /// 合并连续变更，再通过串行队列写盘，防止旧快照覆盖新快照。
    private func persist() {
        persistTask?.cancel()
        persistenceRevision &+= 1
        let revision = persistenceRevision
        persistTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(0.35)) }
            catch { return }
            guard let self, !Task.isCancelled else { return }
            let snapshot = self.cards
            let storage = self.storage
            self.persistenceQueue.async { [weak self] in
                let result = storage.saveCards(snapshot)
                Task { @MainActor [weak self] in
                    guard let self, self.persistenceRevision == revision else { return }
                    self.receiveSaveResult(result)
                }
            }
        }
    }

    /// 应用退出前同步保存最后状态，并等待已提交的写入完成。
    public func flushPersistence() {
        persistTask?.cancel()
        persistTask = nil
        persistenceRevision &+= 1
        let snapshot = cards
        let result = persistenceQueue.sync { storage.saveCards(snapshot) }
        receiveSaveResult(result)
    }

    public func retryPersistence() { persist() }

    /// 进入后台或应用退出前释放异步任务和音频资源，避免窗口关闭后仍继续播报或持有状态。
    public func shutdown() {
        closeChat()
        speechService.stopAmbientMode()
        speechService.onAmbientAdvanceRequest = nil
        persistTask?.cancel()
        persistTask = nil
        flushPersistence()
    }

    private func receiveSaveResult(_ result: CardSaveResult) {
        switch result {
        case .saved:
            persistenceWarning = nil
        case .failed(let message):
            persistenceWarning = "最新卡片更改尚未保存，请保留应用并重试。\n\(message)"
        case .savedWithoutBackup(let message):
            persistenceWarning = "卡片已保存，但备份未能更新。\n\(message)"
        }
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

    /// 将指定卡片置顶到待刷卡堆顶部（例如通过全局搜索快速定位并准备浏览）
    public func promoteToDeckTop(_ card: KnowledgeCard) {
        guard let target = cards.first(where: { $0.id == card.id }) else { return }
        if deck.first?.id == target.id { return }
        var updatedDeck = deck.filter { $0.id != target.id }
        updatedDeck.insert(target, at: 0)
        self.deck = updatedDeck
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

    /// 导出收藏夹为兼容 Obsidian / Notion 的 Markdown 格式
    public func exportFavoritesMarkdown(filtered: [KnowledgeCard]? = nil) -> String {
        let exportList = filtered ?? favorites
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd HH:mm"
        let todayStr = dateFormatter.string(from: Date())

        var md = """
        ---
        title: "KnowFlick 知识收藏阁"
        date: "\(todayStr)"
        total_cards: \(exportList.count)
        tags: [knowflick, knowledge, study-notes]
        source: KnowFlick macOS
        ---

        # 📚 KnowFlick 知识收藏阁

        > 沉淀闪念，连接灵感。共精选收藏 **\(exportList.count)** 条知识卡片。
        > 导出时间：\(todayStr)

        ---

        ## 📑 目录索引

        """

        for (idx, card) in exportList.enumerated() {
            let anchor = card.headline
                .replacingOccurrences(of: " ", with: "-")
                .lowercased()
            md += "\(idx + 1). [\(card.category) · \(card.headline)](#\(anchor))\n"
        }

        md += "\n---\n\n## 💡 知识笔记\n\n"

        for (idx, card) in exportList.enumerated() {
            let categoryName = card.category.isEmpty ? "未分类" : card.category
            let seenTimeStr: String
            if let seen = card.seenAt {
                seenTimeStr = dateFormatter.string(from: seen)
            } else {
                seenTimeStr = todayStr
            }

            md += """
            ### \(idx + 1). \(card.headline)

            - **领域分类**：`\(categoryName)`
            - **收藏时间**：`\(seenTimeStr)`
            - **卡片来源**：\(card.source == .ai ? "🤖 AI 灵感探索" : "🌱 精选启蒙")

            > **核心观点**
            > \(card.summary)

            **深入解读**
            \(card.details)

            """

            if !card.links.isEmpty {
                md += "**延伸阅读**\n"
                for link in card.links {
                    md += "- [\(link.title)](\(link.url))\n"
                }
                md += "\n"
            }

            md += "---\n\n"
        }

        md += "*Generated by KnowFlick (闪念智库)*\n"

        return md
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
            cards = processed + cards
            recomputeDeckAndHistory()
            let processedIds = Set(processed.map(\.id))
            let promoted = deck.filter { processedIds.contains($0.id) }
            let otherDeck = deck.filter { !processedIds.contains($0.id) }
            self.deck = promoted + otherDeck
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
            let catHistory = history.filter { $0.category == category && !catFavs.contains($0) }
            pool = catFavs + catHistory
            if pool.isEmpty {
                pool = cards.filter { $0.category == category }
            }
        } else {
            let favs = favorites
            let others = history.filter { c in !favs.contains(where: { $0.id == c.id }) }
            pool = favs + others
            if pool.count < limit {
                let rest = cards.filter { c in !pool.contains(where: { $0.id == c.id }) }
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

    /// 生成全量星图引力拓扑数据
    public func getKnowledgeGraphData(width: CGFloat = 860, height: CGFloat = 620) -> KnowledgeGraphData {
        KnowledgeGraphEngine.buildGraph(from: cards, width: width, height: height)
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

    /// 手动触发：换一批新知识（系统跳过，不表达喜好）
    public func refreshDeck() async {
        // 把当前卡堆标记为「跳过」再生成新的——跳过 ≠ 不喜欢，不污染统计
        var updated = cards
        for card in deck {
            guard let idx = updated.firstIndex(where: { $0.id == card.id }) else { continue }
            updated[idx].seenAt = Date()
            updated[idx].swiped = .skip
        }
        cards = updated
        persist()
        if settings.autoGenerate && settings.isAIConfigured && settings.enableAI {
            await generateNewCards(count: 6)
        }
    }

    // MARK: - 设置

    /// 保存设置：key 单独进 Keychain，其余进 JSON；失败抛错
    public func saveSettings(_ newSettings: AISettings) throws {
        let trimmedKey = newSettings.apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        // key 非空写钥匙串、为空则删除，与语音配置分支对称：清空后重启不会「复活」旧密钥。
        if trimmedKey.isEmpty {
            try credentials.delete(account: "apiKey")
        } else {
            try credentials.save(trimmedKey, account: "apiKey")
        }
        var persisted = newSettings
        persisted.apiKey = trimmedKey
        for index in persisted.speech.profiles.indices {
            let key = persisted.speech.profiles[index].apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
            persisted.speech.profiles[index].apiKey = key
            let account = "tts." + persisted.speech.profiles[index].id
            if key.isEmpty { try credentials.delete(account: account) }
            else { try credentials.save(key, account: account) }
        }
        let retainedIDs = Set(persisted.speech.profiles.map(\.id))
        for profile in settings.speech.profiles where !retainedIDs.contains(profile.id) {
            try credentials.delete(account: "tts." + profile.id)
        }
        settings = persisted
        try storage.saveSettingsThrowing(persisted)
    }

    /// 连通性测试：轻量 ping 请求，不消耗额度
    public func testConnection(settings testSettings: AISettings) async -> String {
        do {
            try await aiService.ping(settings: testSettings)
            return "连接成功，AI 服务可用"
        } catch {
            return error.localizedDescription
        }
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

    /// 打开某张卡片的 AI 追问面板
    public func openChat(for card: KnowledgeCard) {
        cancelChatStreaming()
        self.activeChatCard = card
        self.chatErrorMessage = nil
        // 加载历史会话或新建
        if let existing = storage.loadChatSession(for: card.id) {
            self.currentChatSession = existing
        } else {
            self.currentChatSession = CardChatSession(cardId: card.id, cardHeadline: card.headline)
        }
    }

    /// 关闭追问面板
    public func closeChat() {
        cancelChatStreaming()
        self.activeChatCard = nil
    }

    /// 发送追问消息
    public func sendChatMessage(prompt: String) {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !isChatStreaming, !trimmed.isEmpty, let card = activeChatCard else { return }

        if currentChatSession == nil {
            currentChatSession = CardChatSession(cardId: card.id, cardHeadline: card.headline)
        }

        // 添加用户消息
        let userMsg = CardChatMessage(sender: .user, content: trimmed)
        currentChatSession?.messages.append(userMsg)
        currentChatSession?.updatedAt = Date()

        // 准备助手消息占位
        let assistantMsgId = UUID()
        let assistantMsg = CardChatMessage(id: assistantMsgId, sender: .assistant, content: "", isStreaming: true)
        currentChatSession?.messages.append(assistantMsg)

        isChatStreaming = true
        chatErrorMessage = nil

        let historySnapshot = currentChatSession?.messages.dropLast(2) ?? []
        let settingsSnapshot = self.settings

        chatStreamTask?.cancel()
        chatStreamTask = Task { @MainActor in
            guard !Task.isCancelled else { return }
            do {
                let stream = self.aiService.streamCardChat(
                    card: card,
                    history: Array(historySnapshot),
                    userPrompt: trimmed,
                    settings: settingsSnapshot
                )

                for try await delta in stream {
                    guard !Task.isCancelled else { break }
                    if let index = self.currentChatSession?.messages.firstIndex(where: { $0.id == assistantMsgId }) {
                        self.currentChatSession?.messages[index].content += delta
                    }
                }

                guard !Task.isCancelled else { return }
                if let index = self.currentChatSession?.messages.firstIndex(where: { $0.id == assistantMsgId }) {
                    self.currentChatSession?.messages[index].isStreaming = false
                }
                self.isChatStreaming = false
                if let session = self.currentChatSession {
                    do { try self.storage.saveChatSessionThrowing(session) }
                    catch { self.chatErrorMessage = "聊天记录保存失败：\(error.localizedDescription)" }
                }
            } catch {
                if !Task.isCancelled {
                    self.isChatStreaming = false
                    self.chatErrorMessage = error.localizedDescription
                    if let index = self.currentChatSession?.messages.firstIndex(where: { $0.id == assistantMsgId }) {
                        if self.currentChatSession?.messages[index].content.isEmpty == true {
                            self.currentChatSession?.messages.remove(at: index)
                        } else {
                            self.currentChatSession?.messages[index].isStreaming = false
                        }
                    }
                    if let session = self.currentChatSession {
                        do { try self.storage.saveChatSessionThrowing(session) }
                        catch { self.chatErrorMessage = "聊天记录保存失败：\(error.localizedDescription)" }
                    }
                }
            }
        }
    }

    /// 终止当前流式生成
    public func cancelChatStreaming() {
        chatStreamTask?.cancel()
        chatStreamTask = nil
        isChatStreaming = false
        if var session = currentChatSession {
            session.messages.removeAll { $0.isStreaming && $0.content.isEmpty }
            for i in session.messages.indices { session.messages[i].isStreaming = false }
            session.updatedAt = Date()
            currentChatSession = session
            do { try storage.saveChatSessionThrowing(session) }
            catch { chatErrorMessage = "聊天记录保存失败：\(error.localizedDescription)" }
        }
    }

    /// 清空当前卡片的追问历史
    public func clearCurrentChatSession() {
        cancelChatStreaming()
        guard let card = activeChatCard else { return }
        do { try storage.clearChatSessionThrowing(for: card.id) }
        catch { chatErrorMessage = "聊天记录清除失败：\(error.localizedDescription)" }
        currentChatSession = CardChatSession(cardId: card.id, cardHeadline: card.headline)
    }

    // MARK: - 预置库

    private func loadSeedCards() -> [KnowledgeCard] {
        guard let url = Bundle.module.url(forResource: "seed_cards", withExtension: "json"),
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
