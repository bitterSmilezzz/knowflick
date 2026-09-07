import Foundation
import Observation

/// 全局状态：卡片池、历史记录、设置、AI 生成
@MainActor
@Observable
public final class AppStore {
    // MARK: - 持久化状态

    public var cards: [KnowledgeCard] = []          // 全部卡片（未看 + 历史）
    public var settings: AISettings = .default
    public var isGenerating = false
    public var lastError: String?

    // MARK: - 运行期状态

    public var isLoadingSeed = true                 // 首启是否还在加载预置库

    private let aiService = AIService()
    private let storage: Storage

    public init(storage: Storage = Storage()) {
        self.storage = storage
    }

    // MARK: - 计算属性

    /// 待刷卡片队列（未看过的）。
    /// 过滤顺序：来源开关（预置/AI）→ 偏好分类优先（耗尽回退全量）→ 确定性学科交织打散 → 相邻背景绝对防重（0 撞图）
    public var deck: [KnowledgeCard] {
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
        let lastKey = history.first.map { CardThemeResolver.resolveKey(for: $0) }
        return CardThemeResolver.interleavedAndDeduplicated(filtered, avoidingTopKey: lastKey)
    }

    /// 历史记录（看过的，最新在前）
    public var history: [KnowledgeCard] {
        cards.filter { $0.seenAt != nil }.sorted { ($0.seenAt ?? .distantPast) > ($1.seenAt ?? .distantPast) }
    }

    public var topCard: KnowledgeCard? { deck.first }

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
        cards[idx].seenAt = Date()
        cards[idx].swiped = direction
        persist()
    }

    /// 撤销上一张（从历史顶部退回卡堆）
    public func undoLastSwipe() {
        guard let last = history.first,
              let idx = cards.firstIndex(where: { $0.id == last.id }) else { return }
        cards[idx].seenAt = nil
        cards[idx].swiped = nil
        persist()
    }

    /// 清空历史（仅清 seenAt，保留卡片避免重复生成）
    public func clearHistory() {
        for i in cards.indices {
            cards[i].seenAt = nil
            cards[i].swiped = nil
        }
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
        for card in deck {
            guard let idx = cards.firstIndex(where: { $0.id == card.id }) else { continue }
            cards[idx].seenAt = Date()
            cards[idx].swiped = .skip
        }
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
