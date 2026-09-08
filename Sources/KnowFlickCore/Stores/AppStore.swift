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
        }
    }
    public var isGenerating = false
    public var lastError: String?

    // MARK: - 运行期状态

    public var isLoadingSeed = true                 // 首启是否还在加载预置库

    public private(set) var deck: [KnowledgeCard] = []
    public private(set) var history: [KnowledgeCard] = []

    /// 收藏阁：右划感兴趣的卡片列表（按收藏时间倒序）
    public var favorites: [KnowledgeCard] {
        cards.filter { $0.swiped == .right }
            .sorted { ($0.seenAt ?? .distantPast) > ($1.seenAt ?? .distantPast) }
    }

    public var topCard: KnowledgeCard? { deck.first }

    private let aiService = AIService()
    private let storage: Storage
    private var lastSwipedCardId: UUID?
    private var lastSwipedKey: String?

    public init(storage: Storage = Storage()) {
        self.storage = storage
        recomputeDeckAndHistory()
    }

    private func recomputeDeckAndHistory() {
        let hist = cards.filter { $0.seenAt != nil }.sorted { ($0.seenAt ?? .distantPast) > ($1.seenAt ?? .distantPast) }
        self.history = hist

        var unseen = cards.filter { $0.seenAt == nil }
        // 来源开关：只开其一则只看该来源；全关则队列为空
        if !settings.enableSeed || !settings.enableAI {
            unseen = unseen.filter { settings.enableSeed ? $0.source == .seed : $0.source == .ai }
        }
        let prefs = settings.preferredCategories
        let filtered: [KnowledgeCard]
        if prefs.isEmpty {
            filtered = unseen
        } else {
            let preferred = unseen.filter { prefs.contains($0.category) }
            filtered = preferred.isEmpty ? unseen : preferred
        }

        let filteredIds = Set(filtered.map(\.id))
        let existingDeckIds = Set(deck.map(\.id))
        let remainingInDeck = deck.filter { filteredIds.contains($0.id) }
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
        if storage.hasSeeded() {
            cards = storage.loadCards()
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
        // 读回 Keychain 里的 key
        settings.apiKey = KeychainHelper.read() ?? ""
        isLoadingSeed = false
        // 卡片不足时尝试自动生成（来源含 AI 且已配置才触发）
        if deck.count < 5 && settings.autoGenerate && !settings.apiKey.isEmpty && settings.enableAI {
            await generateNewCards()
        }
    }

    // MARK: - 持久化

    private var persistTask: Task<Void, Never>?

    /// 唯一落盘入口：所有变异方法统一走这里。
    /// 节流合并（350ms 内的连续刷卡只写最后一次）+ 后台线程执行（JSON 编码与文件 IO 不卡主线程）。
    /// Task.detached 不随 MainActor 取消，应用退出前未完成的写盘仍会跑完。
    private func persist() {
        persistTask?.cancel()
        let snapshot = cards
        let storage = self.storage
        persistTask = Task.detached {
            try? await Task.sleep(for: .seconds(0.35))
            guard !Task.isCancelled else { return }
            storage.saveCards(snapshot)
        }
    }

    // MARK: - 刷卡动作

    /// 卡片被划走：记入历史并落盘
    public func swipe(_ card: KnowledgeCard, direction: SwipeDirection) {
        guard let idx = cards.firstIndex(where: { $0.id == card.id }) else { return }
        lastSwipedCardId = card.id
        lastSwipedKey = CardThemeResolver.resolveKey(for: card)
        var updated = cards
        updated[idx].seenAt = Date()
        updated[idx].swiped = direction
        cards = updated
        persist()
    }

    /// 撤销上一张（从历史顶部退回卡堆）
    public func undoLastSwipe() {
        guard let last = history.first,
              let idx = cards.firstIndex(where: { $0.id == last.id }) else { return }
        var updated = cards
        updated[idx].seenAt = nil
        updated[idx].swiped = nil
        cards = updated
        persist()
    }

    /// 清空历史（仅清 seenAt，保留卡片避免重复生成）
    public func clearHistory() {
        var updated = cards
        for i in updated.indices {
            updated[i].seenAt = nil
            updated[i].swiped = nil
        }
        cards = updated
        persist()
    }

    // MARK: - 收藏管理与笔记导出

    /// 切换卡片的收藏状态（已收藏则取消收藏为 skip，未收藏则标记为 right 收藏）
    public func toggleFavorite(_ card: KnowledgeCard) {
        guard let idx = cards.firstIndex(where: { $0.id == card.id }) else { return }
        var updated = cards
        if updated[idx].swiped == .right {
            updated[idx].swiped = .skip
        } else {
            updated[idx].seenAt = updated[idx].seenAt ?? Date()
            updated[idx].swiped = .right
        }
        cards = updated
        persist()
    }

    /// 检查某张卡片是否已被收藏
    public func isFavorite(_ card: KnowledgeCard) -> Bool {
        cards.first(where: { $0.id == card.id })?.swiped == .right
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

    // MARK: - AI 生成

    /// 生成 count 张新卡片并追加到队列
    public func generateNewCards(count: Int = 3) async {
        guard !isGenerating else { return }
        isGenerating = true
        defer { isGenerating = false }

        do {
            // 排除标题传全量，截断上限由 AIService 单点决定
            let existing = cards.map { $0.headline }
            let newCards = try await aiService.generateCards(
                settings: settings,
                count: count,
                excludeHeadlines: existing
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
        if settings.autoGenerate && !settings.apiKey.isEmpty && settings.enableAI {
            await generateNewCards(count: 6)
        }
    }

    // MARK: - 设置

    /// 保存设置：key 单独进 Keychain，其余进 JSON；失败抛错
    public func saveSettings(_ newSettings: AISettings) throws {
        let trimmedKey = newSettings.apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        // key 非空才写钥匙串；写入失败向上抛，视图可见
        if !trimmedKey.isEmpty {
            try KeychainHelper.save(trimmedKey)
        }
        var persisted = newSettings
        persisted.apiKey = trimmedKey
        settings = persisted
        storage.saveSettings(persisted)
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
