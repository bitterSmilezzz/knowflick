import XCTest
@testable import KnowFlickCore

final class StatsCalculatorTests: XCTestCase {
    private func makeCard(
        category: String = "物理",
        seenAt: Date? = Date(),
        swiped: SwipeDirection? = nil
    ) -> KnowledgeCard {
        KnowledgeCard(
            category: category,
            headline: "测试标题",
            summary: "摘要",
            details: "详情详情详情详情详情",
            source: .seed,
            createdAt: Date(timeIntervalSince1970: 1_000_000),
            seenAt: seenAt,
            swiped: swiped
        )
    }

    private var calendar: Calendar { Calendar(identifier: .gregorian) }

    /// 从 2026-09-06 往前数 n 天的日期（当天不含，用于造「昨天、前天」数据）
    private func daysBefore(_ n: Int, from date: Date = Date(timeIntervalSince1970: 1_752_870_000)) -> Date {
        calendar.date(byAdding: .day, value: -n, to: date)!
    }

    // MARK: - 空数据

    func testEmptyCardsYieldsZeroStats() {
        let stats = StatsCalculator.compute(from: [], calendar: calendar)
        XCTAssertEqual(stats.seenCount, 0)
        XCTAssertEqual(stats.likedCount, 0)
        XCTAssertEqual(stats.skipCount, 0)
        XCTAssertEqual(stats.likeRate, 0)
        XCTAssertEqual(stats.streakDays, 0)
        XCTAssertTrue(stats.categories.isEmpty)
    }

    func testUnseenCardsNotCounted() {
        let cards = [makeCard(seenAt: nil)]
        let stats = StatsCalculator.compute(from: cards, calendar: calendar)
        XCTAssertEqual(stats.seenCount, 0)
        XCTAssertEqual(stats.streakDays, 0)
    }

    // MARK: - 意图计数

    func testCountsSplitByIntention() {
        let cards = [
            makeCard(swiped: .right),
            makeCard(swiped: .left),
            makeCard(swiped: .skip),
            makeCard(swiped: .right),
            makeCard(seenAt: nil)   // 未刷，不计
        ]
        let stats = StatsCalculator.compute(from: cards, calendar: calendar)
        XCTAssertEqual(stats.seenCount, 4)    // 4 张带意图的都已刷；skip 计入已刷
        XCTAssertEqual(stats.likedCount, 2)   // 只算右划
        XCTAssertEqual(stats.skipCount, 1)    // 跳过单独计数，不污染不喜欢
        XCTAssertEqual(stats.likeRate, 0.5, accuracy: 0.001)
    }

    // MARK: - 连续天数

    func testStreakTodayAndYesterday() {
        let now = Date(timeIntervalSince1970: 1_752_870_000)
        let cards = [
            makeCard(seenAt: now),
            makeCard(seenAt: daysBefore(1, from: now))
        ]
        let stats = StatsCalculator.compute(from: cards, calendar: calendar, now: now)
        XCTAssertEqual(stats.streakDays, 2)
    }

    func testStreakGapBreaks() {
        let now = Date(timeIntervalSince1970: 1_752_870_000)
        let cards = [
            makeCard(seenAt: now),
            makeCard(seenAt: daysBefore(1, from: now)),
            makeCard(seenAt: daysBefore(3, from: now))   // 前天断档
        ]
        let stats = StatsCalculator.compute(from: cards, calendar: calendar, now: now)
        XCTAssertEqual(stats.streakDays, 2)
    }

    func testStreakAllowsTodayGap() {
        // 今天没刷，但昨天和前天刷了 → 从昨天起算 2 天
        let now = Date(timeIntervalSince1970: 1_752_870_000)
        let cards = [
            makeCard(seenAt: daysBefore(1, from: now)),
            makeCard(seenAt: daysBefore(2, from: now))
        ]
        let stats = StatsCalculator.compute(from: cards, calendar: calendar, now: now)
        XCTAssertEqual(stats.streakDays, 2)
    }

    func testStreakTodayGapBeyondYesterdayBreaks() {
        let now = Date(timeIntervalSince1970: 1_752_870_000)
        let cards = [makeCard(seenAt: daysBefore(2, from: now))]
        let stats = StatsCalculator.compute(from: cards, calendar: calendar, now: now)
        XCTAssertEqual(stats.streakDays, 0)
    }

    func testStreakCountsSameDayOnce() {
        // 同一天刷多张只算一天
        let now = Date(timeIntervalSince1970: 1_752_870_000)
        let cards = [
            makeCard(seenAt: now),
            makeCard(seenAt: now.addingTimeInterval(3600)),
            makeCard(seenAt: daysBefore(1, from: now))
        ]
        let stats = StatsCalculator.compute(from: cards, calendar: calendar, now: now)
        XCTAssertEqual(stats.streakDays, 2)
    }

    // MARK: - 每日趋势

    func testDailyCountsLastSevenDays() {
        let now = Date(timeIntervalSince1970: 1_752_870_000)
        let cards = [
            makeCard(seenAt: now),                       // 今天 1 张
            makeCard(seenAt: now.addingTimeInterval(60)),
            makeCard(seenAt: daysBefore(1, from: now)),  // 昨天 1 张
            makeCard(seenAt: daysBefore(4, from: now)),  // 4 天前 1 张
            makeCard(seenAt: nil)                        // 未刷不计
        ]
        let daily = StatsCalculator.dailyCounts(cards: cards, calendar: calendar, days: 7, endingAt: now)
        XCTAssertEqual(daily.count, 7)
        XCTAssertEqual(daily[6].count, 2)    // 今天
        XCTAssertEqual(daily[5].count, 1)    // 昨天
        XCTAssertEqual(daily[2].count, 1)    // 4 天前
        XCTAssertEqual(daily[0].count, 0)    // 6 天前
        // 顺序从最旧到最新
        XCTAssertLessThan(daily[0].day, daily[6].day)
    }

    // MARK: - 分类统计

    func testCategoryGroupingSortedBySeenDesc() {
        let cards = [
            makeCard(category: "生物", swiped: .right),
            makeCard(category: "生物", swiped: .left),
            makeCard(category: "生物", swiped: .skip),
            makeCard(category: "物理", swiped: .right),
            makeCard(category: "历史", swiped: .right)
        ]
        let stats = StatsCalculator.compute(from: cards, calendar: calendar)
        // 排序只保证按已刷降序；同数量分类间的相对顺序不保证（字典序输入）
        XCTAssertEqual(stats.categories.first?.category, "生物")
        XCTAssertEqual(stats.categories.first?.seen, 3)
        XCTAssertEqual(stats.categories.first?.liked, 1)   // skip 不进入喜欢
        let rest = stats.categories.dropFirst().map(\.category)
        XCTAssertEqual(Set(rest), ["历史", "物理"])
        XCTAssertEqual(stats.categories.first { $0.category == "历史" }?.likeRate, 1.0)
    }
}
