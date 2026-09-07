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

    public var topCard: KnowledgeCard? { deck.first }

    private let aiService = AIService()
    private let storage: Storage

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
        let lastKey = hist.first.map { CardThemeResolver.resolveKey(for: $0) }
        self.deck = CardThemeResolver.interleavedAndDeduplicated(filtered, avoidingTopKey: lastKey)
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
