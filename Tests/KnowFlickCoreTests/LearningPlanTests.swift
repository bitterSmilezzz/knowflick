import Foundation
import Testing
@testable import KnowFlickCore

struct LearningPlanTests {
    @Test func editedCardsRefreshTheirThemeAndMarsUsesAstronomy() {
        var subject = KnowledgeCard(category: "冷知识", headline: "火星的日落是蓝色的", summary: "尘埃散射红光", details: "正文", source: .seed)
        #expect(CardThemeResolver.resolveKey(for: subject) == "astronomy")
        subject.headline = "量子纠缠"
        subject.summary = "叠加态"
        #expect(CardThemeResolver.resolveKey(for: subject) == "quantum")
    }
    private var calendar: Calendar {
        var value = Calendar(identifier: .gregorian)
        value.timeZone = TimeZone(secondsFromGMT: 0)!
        return value
    }
    private var now: Date { Date(timeIntervalSince1970: 1_800_000_000) }
    private func card(seen: Date? = nil, reviewed: Date? = nil, mastery: Int = 0) -> KnowledgeCard {
        KnowledgeCard(category: "学习", headline: "主动回忆", summary: "摘要", details: "正文", source: .seed, createdAt: now,
                      seenAt: seen, reviewCount: reviewed == nil ? 0 : 1, masteryLevel: mastery, lastReviewedAt: reviewed)
    }

    @Test func unreadCardsAreNotScheduledAndTodayIsDeduplicated() {
        let plan = LearningPlan(cards: [card(), card(seen: now, reviewed: now)], now: now, calendar: calendar)
        #expect(plan.due.isEmpty)
        #expect(plan.completedToday == 1)
    }

    @Test func reviewIntervalsFollowRecallAndCalendarDays() {
        let start = calendar.startOfDay(for: now)
        for (mastery, days) in [(0, 1), (1, 3), (2, 7)] {
            let subject = card(seen: now, reviewed: now, mastery: mastery)
            #expect(LearningPlan.reviewDate(for: subject, calendar: calendar) == calendar.date(byAdding: .day, value: days, to: start))
        }
        #expect(LearningPlan.reviewDate(for: card(seen: now), calendar: calendar) == calendar.date(byAdding: .day, value: 1, to: start))
    }

    @Test func overdueCardsComeFirstAndFutureCardsStayOut() {
        let old = card(seen: now.addingTimeInterval(-4 * 86400))
        let recent = card(seen: now.addingTimeInterval(-2 * 86400))
        let future = card(seen: now, reviewed: now, mastery: 2)
        let plan = LearningPlan(cards: [future, recent, old], now: now, calendar: calendar)
        #expect(plan.due.map(\.id) == [old.id, recent.id])
        #expect(plan.mastered == 1)
    }

    @Test @MainActor func readingCompletionPreservesFavoriteAndReviewData() {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let storage = Storage(baseDir: directory)
        let store = AppStore(storage: storage)
        defer { store.flushPersistence(); try? FileManager.default.removeItem(at: directory) }
        var subject = card(seen: now, reviewed: now, mastery: 2)
        subject.swiped = .right
        store.cards = [subject]
        store.completeReading(subject)
        store.flushPersistence()
        let result = storage.loadCards().first
        #expect(result?.swiped == .right)
        #expect(result?.lastReviewedAt == now)
        #expect(result?.masteryLevel == 2)
        #expect(result?.reviewCount == 1)
        #expect(result?.seenAt != nil)
    }

    @Test @MainActor func hesitantRecallReschedulesPreviouslyMasteredCard() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = AppStore(storage: Storage(baseDir: directory))
        defer { store.flushPersistence(); try? FileManager.default.removeItem(at: directory) }
        let subject = card(seen: now, reviewed: now, mastery: 2)
        store.cards = [subject]
        store.recordQuizResult(cardId: subject.id, rating: .hesitant)
        let result = try #require(store.cards.first)
        #expect(result.masteryLevel == 1)
        let reviewDate = try #require(result.lastReviewedAt)
        #expect(LearningPlan.reviewDate(for: result, calendar: calendar) == calendar.date(byAdding: .day, value: 3, to: calendar.startOfDay(for: reviewDate)))
    }

    @Test @MainActor func editingContentPreservesIdentityAndRejectsEmptyFields() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = AppStore(storage: Storage(baseDir: directory))
        defer { store.flushPersistence(); try? FileManager.default.removeItem(at: directory) }
        var subject = card(seen: now, reviewed: now, mastery: 2)
        subject.swiped = .right
        store.cards = [subject]
        #expect(!store.updateCardContent(id: subject.id, headline: "  ", category: "分类", summary: "摘要", details: "正文"))
        #expect(store.cards.first == subject)
        #expect(store.updateCardContent(id: subject.id, headline: " 新标题 ", category: "新主题", summary: "新摘要", details: "自己的解释"))
        let result = try #require(store.cards.first)
        #expect(result.headline == "新标题")
        #expect(result.category == "新主题")
        #expect(result.id == subject.id)
        #expect(result.seenAt == subject.seenAt)
        #expect(result.swiped == .right)
        #expect(result.lastReviewedAt == subject.lastReviewedAt)
        #expect(result.reviewCount == subject.reviewCount)
        #expect(result.masteryLevel == 2)
        store.flushPersistence()
        #expect(Storage(baseDir: directory).loadCards().first == result)
    }
}
