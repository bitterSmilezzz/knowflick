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

    @Test func masteryDistributionAndUpcomingScheduleAreCalculatedAccurately() {
        let c1 = card(seen: now, reviewed: now, mastery: 2) // mastered (7 days)
        let c2 = card(seen: now, reviewed: now, mastery: 1) // hesitant (3 days)
        let c3 = card(seen: now, reviewed: now, mastery: 0) // needsReview (1 day)
        let c4 = card() // unread

        let plan = LearningPlan(cards: [c1, c2, c3, c4], now: now, calendar: calendar)
        #expect(plan.masteryDistribution.masteredCount == 1)
        #expect(plan.masteryDistribution.hesitantCount == 1)
        #expect(plan.masteryDistribution.needsReviewCount == 2)
        #expect(plan.masteryDistribution.testedCards == 3)
        #expect(plan.masteryDistribution.totalCards == 4)
        #expect(plan.masteryDistribution.retentionRate > 0)

        let schedule = plan.upcomingSchedule(days: 7)
        #expect(schedule.count == 7)
        // Day 0 is today, Day 1 is 1 day later (c3 due), Day 3 is 3 days later (c2 due)
        #expect(schedule[1].count == 1) // c3
        #expect(schedule[3].count == 1) // c2
    }

    @Test func nonpositiveForecastAndPreviewLimitsAreEmpty() {
        let plan = LearningPlan(cards: [card(seen: now)], now: now, calendar: calendar)
        for limit in [0, -1] {
            #expect(plan.upcomingSchedule(days: limit).isEmpty)
            #expect(plan.upcomingCards(limit: limit).isEmpty)
        }
    }

    @Test func midnightResetsCompletionAndMakesFirstReviewDue() throws {
        let tomorrow = try #require(calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)))
        let subject = card(seen: tomorrow.addingTimeInterval(-1))
        let before = LearningPlan(cards: [subject], now: tomorrow.addingTimeInterval(-1), calendar: calendar)
        let after = LearningPlan(cards: [subject], now: tomorrow, calendar: calendar)
        #expect(before.completedToday == 1)
        #expect(before.due.isEmpty)
        #expect(after.completedToday == 0)
        #expect(after.due.map(\.id) == [subject.id])
    }

    @Test func forecastIncludesOverdueTodayAndKeepsFutureDaysSeparate() {
        let cards = [card(seen: now.addingTimeInterval(-3 * 86400)), card(seen: now), card()]
        let plan = LearningPlan(cards: cards, now: now, calendar: calendar)
        #expect(plan.upcomingSchedule(days: 3).map(\.count) == [1, 1, 0])
        #expect(plan.upcomingCards(limit: 5).count == 2)
        #expect(plan.upcomingCards(limit: 1).first?.card.id == cards[0].id)
    }

    @Test func reviewDatesFollowCalendarAcrossDaylightSavingChange() throws {
        var local = Calendar(identifier: .gregorian)
        local.timeZone = try #require(TimeZone(identifier: "America/Los_Angeles"))
        let reading = try #require(local.date(from: DateComponents(year: 2026, month: 3, day: 8, hour: 12)))
        let expected = try #require(local.date(from: DateComponents(year: 2026, month: 3, day: 9)))
        #expect(LearningPlan.reviewDate(for: card(seen: reading), calendar: local) == expected)
    }
}

