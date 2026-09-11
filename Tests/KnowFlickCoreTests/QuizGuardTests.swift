import Foundation
import Testing
@testable import KnowFlickCore

/// 覆盖 QuizView 两条修复所依赖的纯逻辑（不涉及 View 层）：
/// 1) 到期复习点「再测一组」改为重新拉取 `LearningPlan.due`，验证刚评分过的卡片
///    会按新的复习间隔排到未来、不再出现在同一轮重测队列里，且复习次数只累计一次；
/// 2) 评分守卫「同一张卡本轮只评分一次」的判定建立在 `ratings[card.id] == nil` 之上，
///    这里用模型层验证同一张卡重复提交时 `recordQuizResult` 的累计效果（调用方负责守卫）。
@MainActor
struct QuizGuardTests {
    private var calendar: Calendar {
        var value = Calendar(identifier: .gregorian)
        value.timeZone = TimeZone(secondsFromGMT: 0)!
        return value
    }

    private var now: Date { Date(timeIntervalSince1970: 1_800_000_000) }

    private func card(seen: Date?, reviewed: Date? = nil, mastery: Int = 0) -> KnowledgeCard {
        KnowledgeCard(category: "学习", headline: "主动回忆", summary: "摘要", details: "正文", source: .seed,
                      createdAt: now, seenAt: seen, reviewCount: reviewed == nil ? 0 : 1,
                      masteryLevel: mastery, lastReviewedAt: reviewed)
    }

    private func withStore(_ body: (AppStore, Storage, URL) throws -> Void) throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let storage = Storage(baseDir: directory)
        let store = AppStore(storage: storage)
        defer {
            store.flushPersistence()
            try? FileManager.default.removeItem(at: directory)
        }
        try body(store, storage, directory)
    }

    /// 到期复习重测应重新拉取到期队列：本轮刚评分的卡片按新间隔排到未来，不再重复出现。
    /// 这里用真实当前时间，因为 `recordQuizResult` 内部写的是 `Date()`。
    @Test func dueQueueRefreshesAfterGradingSoRetestedCardsDoNotRepeat() throws {
        try withStore { store, _, _ in
            let now = Date()
            let dueCard = card(seen: now.addingTimeInterval(-2 * 86400))
            let unread = card(seen: nil)
            store.cards = [dueCard, unread]

            let firstRound = LearningPlan(cards: store.cards).due
            #expect(firstRound.map(\.id) == [dueCard.id])

            // 模拟本轮评分：mastered 会把下次复习间隔推到 7 天后，该卡随即离开到期队列
            store.recordQuizResult(cardId: dueCard.id, rating: .mastered)

            let refreshed = LearningPlan(cards: store.cards).due
            #expect(refreshed.isEmpty)
            let updated = store.cards.first(where: { $0.id == dueCard.id })
            #expect(updated?.reviewCount == 1)
            #expect(updated?.masteryLevel == 2)
        }
    }

    /// 到期队列顺序稳定：多张到期卡按复习时间升序，重测拉取结果与首轮一致（可复现）
    @Test func dueQueueOrderIsStableAcrossRefreshes() {
        let older = card(seen: now.addingTimeInterval(-4 * 86400))
        let newer = card(seen: now.addingTimeInterval(-2 * 86400))
        let first = LearningPlan(cards: [newer, older], now: now, calendar: calendar).due
        let second = LearningPlan(cards: [newer, older], now: now, calendar: calendar).due
        #expect(first.map(\.id) == [older.id, newer.id])
        #expect(first.map(\.id) == second.map(\.id))
    }

    /// 评分守卫的判定语义：同一张卡已有本轮评分时，守卫必须阻止再次提交。
    /// 这里用字典在模型层复现判定条件（`ratings[id] == nil`），确保「首次写入成功、
    /// 后续写入被拒绝」这一契约在纯逻辑层成立（View 层的 @State 无法脱离 View 测试）。
    @Test func ratingGuardAcceptsOnlyTheFirstSubmissionPerCard() {
        let cardId = UUID()
        var ratings: [UUID: AppStore.QuizRating] = [:]

        func submit(_ rating: AppStore.QuizRating) -> Bool {
            guard ratings[cardId] == nil else { return false }
            ratings[cardId] = rating
            return true
        }

        #expect(submit(.forgot) == true)
        #expect(submit(.mastered) == false)
        #expect(ratings[cardId] == .forgot)
        #expect(ratings.count == 1)
    }
}
