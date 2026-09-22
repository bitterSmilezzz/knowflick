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

    /// 评分提交的真实 store 契约：`recordQuizResult` 每次调用都会累计 reviewCount 并
    /// 覆盖 masteryLevel / lastReviewedAt —— 即「去重守卫」的职责在 View 层（ratings[id] == nil），
    /// store 层忠实记录每次提交。该测试锚定这一分工，防止有人误改其一却未同步另一侧。
    @Test func recordQuizResultCountsEverySubmissionAndUpdatesMastery() throws {
        try withStore { store, _, _ in
            let subject = card(seen: Date())
            store.cards = [subject]

            store.recordQuizResult(cardId: subject.id, rating: .forgot)
            var updated = try #require(store.cards.first { $0.id == subject.id })
            #expect(updated.reviewCount == 1)
            #expect(updated.masteryLevel == 0)
            #expect(updated.lastReviewedAt != nil)

            // 第二次提交（View 层守卫失效时的行为）：仍会累计并覆盖熟练度
            store.recordQuizResult(cardId: subject.id, rating: .mastered)
            updated = try #require(store.cards.first { $0.id == subject.id })
            #expect(updated.reviewCount == 2)
            #expect(updated.masteryLevel == 2)

            // 未知卡片：静默忽略，不产生副作用
            store.recordQuizResult(cardId: UUID(), rating: .mastered)
            #expect(store.cards.first { $0.id == subject.id }?.reviewCount == 2)
        }
    }

    /// 错题置顶到卡堆顶部：已刷过的卡片默认不在常规卡堆里，`promoteToDeckTop` 把它插回首位
    @Test func promoteWeakCardPlacesItOnTopOfTheDeck() throws {
        try withStore { store, _, _ in
            let c1 = card(seen: now)
            let c2 = card(seen: now)
            store.cards = [c1, c2]
            #expect(store.topCard == nil)

            // 将第二张错题卡置顶
            store.promoteToDeckTop(c2)
            #expect(store.topCard?.id == c2.id)
        }
    }
}
