import Foundation
import Observation
import SwiftUI

/// 全局状态：卡片池、历史记录、设置、AI 生成
@MainActor
@Observable
final class AppStore {
    // MARK: - 持久化状态

    var cards: [KnowledgeCard] = []          // 全部卡片（未看 + 历史）
    var settings: AISettings = .default
    var isGenerating = false
    var lastError: String?

    // MARK: - 运行期状态

    var isLoadingSeed = true                 // 首启是否还在加载预置库

    private let aiService = AIService()

    // MARK: - 计算属性

    /// 待刷卡片队列（未看过的，按加入时间）
    var deck: [KnowledgeCard] {
        cards.filter { $0.seenAt == nil }
    }

    /// 历史记录（看过的，最新在前）
    var history: [KnowledgeCard] {
        cards.filter { $0.seenAt != nil }.sorted { ($0.seenAt ?? .distantPast) > ($1.seenAt ?? .distantPast) }
    }

    var topCard: KnowledgeCard? { deck.first }

    // MARK: - 生命周期

    func bootstrap() async {
        if Storage.hasSeeded() {
            cards = Storage.loadCards()
        } else {
            cards = loadSeedCards()
            Storage.saveCards(cards)
        }
        settings = Storage.loadSettings()
        // 读回 Keychain 里的 key
        if !settings.apiKey.isEmpty {
            settings.apiKey = KeychainHelper.read() ?? settings.apiKey
        } else {
            settings.apiKey = KeychainHelper.read() ?? ""
        }
        isLoadingSeed = false
        // 卡片不足时尝试自动生成
        if deck.count < 3 && settings.autoGenerate && !settings.apiKey.isEmpty {
            await generateNewCards()
        }
    }

    // MARK: - 刷卡动作

    /// 卡片被划走：记入历史并落盘
    func swipe(_ card: KnowledgeCard, direction: SwipeDirection) {
        guard let idx = cards.firstIndex(where: { $0.id == card.id }) else { return }
        cards[idx].seenAt = Date()
        cards[idx].swiped = direction
        Storage.saveCards(cards)
    }

    /// 撤销上一张（从历史顶部退回卡堆）
    func undoLastSwipe() {
        guard let last = history.first,
              let idx = cards.firstIndex(where: { $0.id == last.id }) else { return }
        cards[idx].seenAt = nil
        cards[idx].swiped = nil
        Storage.saveCards(cards)
    }

    /// 清空历史（仅清 seenAt，保留卡片避免重复生成）
    func clearHistory() {
        for i in cards.indices {
            cards[i].seenAt = nil
            cards[i].swiped = nil
        }
        Storage.saveCards(cards)
    }

    // MARK: - AI 生成

    /// 生成 count 张新卡片并追加到队列
    func generateNewCards(count: Int = 3) async {
        guard !isGenerating else { return }
        isGenerating = true
        defer { isGenerating = false }

        do {
            let existing = Array(cards.prefix(200)).map { $0.headline }
            let newCards = try await aiService.generateCards(
                settings: settings,
                count: count,
                excludeHeadlines: existing
            )
            if newCards.isEmpty {
                lastError = "AI 没有生成有效的新卡片，请再试一次"
            } else {
                cards.append(contentsOf: newCards)
                Storage.saveCards(cards)
                lastError = nil
            }
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// 手动触发：换一批新知识
    func refreshDeck() async {
        // 把当前卡堆标记为看过（跳过）再生成新的
        for card in deck {
            guard let idx = cards.firstIndex(where: { $0.id == card.id }) else { continue }
            cards[idx].seenAt = Date()
            cards[idx].swiped = .left
        }
        Storage.saveCards(cards)
        if settings.autoGenerate && !settings.apiKey.isEmpty {
            await generateNewCards(count: 5)
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
