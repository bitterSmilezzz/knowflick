import Foundation

/// 掌握度三档分布及全局记忆健康度统计
public struct MasteryDistribution: Sendable, Equatable {
    public let masteredCount: Int       // Level 2 ★★ (熟练掌握，7天间隔)
    public let hesitantCount: Int       // Level 1 ★☆ (学习中/犹豫，3天间隔)
    public let needsReviewCount: Int    // Level 0 ☆☆ (需强化/未测验，1天间隔)
    public let totalCards: Int          // 卡片总数
    public let testedCards: Int         // 至少测验过一次或有熟练度的卡片数
    public let retentionRate: Int       // 记忆留存率 (0 ~ 100%)
    public let totalReviews: Int        // 累计复习总人次

    public init(
        masteredCount: Int,
        hesitantCount: Int,
        needsReviewCount: Int,
        totalCards: Int,
        testedCards: Int,
        retentionRate: Int,
        totalReviews: Int
    ) {
        self.masteredCount = masteredCount
        self.hesitantCount = hesitantCount
        self.needsReviewCount = needsReviewCount
        self.totalCards = totalCards
        self.testedCards = testedCards
        self.retentionRate = retentionRate
        self.totalReviews = totalReviews
    }
}

/// 单日待复习统计项（用于未来 7 天到期预测时间线）
public struct UpcomingDayStat: Sendable, Equatable, Identifiable {
    public var id: Date { date }
    public let date: Date
    public let count: Int
    public let isToday: Bool

    public init(date: Date, count: Int, isToday: Bool) {
        self.date = date
        self.count = count
        self.isToday = isToday
    }
}

/// A deterministic plan based on recorded learning, independent of view state.
public struct LearningPlan: Sendable {
    public let due: [KnowledgeCard]
    public let completedToday: Int
    public let mastered: Int
    public let masteryDistribution: MasteryDistribution
    public let cards: [KnowledgeCard]
    public let now: Date
    public let calendar: Calendar
    private let scheduledCards: [(card: KnowledgeCard, date: Date)]

    public init(cards: [KnowledgeCard], now: Date = Date(), calendar: Calendar = .current) {
        self.cards = cards
        self.now = now
        self.calendar = calendar

        var completed = 0
        var masteredCount = 0
        var hesitantCount = 0
        var testedCards = 0
        var totalReviews = 0
        var scheduled: [(card: KnowledgeCard, date: Date)] = []
        scheduled.reserveCapacity(cards.count)
        for card in cards {
            if card.seenAt.map({ calendar.isDate($0, inSameDayAs: now) }) == true ||
                card.lastReviewedAt.map({ calendar.isDate($0, inSameDayAs: now) }) == true {
                completed += 1
            }
            if card.masteryLevel >= 2 { masteredCount += 1 }
            else if card.masteryLevel == 1 { hesitantCount += 1 }
            if card.reviewCount > 0 || card.masteryLevel > 0 { testedCards += 1 }
            totalReviews += card.reviewCount
            if let date = Self.reviewDate(for: card, calendar: calendar) {
                scheduled.append((card, date))
            }
        }
        scheduled.sort {
            if $0.date != $1.date { return $0.date < $1.date }
            return $0.card.id.uuidString < $1.card.id.uuidString
        }
        scheduledCards = scheduled
        due = scheduled.prefix { $0.date <= now }.map(\.card)
        completedToday = completed
        mastered = masteredCount

        let totalCards = cards.count
        let needsReviewCount = max(0, totalCards - masteredCount - hesitantCount)
        let retentionRate = testedCards == 0 ? 0 : min(100, max(0, Int(
            ((Double(masteredCount) + Double(hesitantCount) * 0.5) / Double(testedCards) * 100).rounded()
        )))

        masteryDistribution = MasteryDistribution(
            masteredCount: masteredCount,
            hesitantCount: hesitantCount,
            needsReviewCount: needsReviewCount,
            totalCards: totalCards,
            testedCards: testedCards,
            retentionRate: retentionRate,
            totalReviews: totalReviews
        )
    }

    /// First review the day after reading; then 1 / 3 / 7 days by recall rating.
    public static func reviewDate(for card: KnowledgeCard, calendar: Calendar = .current) -> Date? {
        guard let last = card.lastReviewedAt ?? card.seenAt else { return nil }
        let days = card.lastReviewedAt == nil ? 1 : (card.masteryLevel >= 2 ? 7 : card.masteryLevel == 1 ? 3 : 1)
        return calendar.date(byAdding: .day, value: days, to: calendar.startOfDay(for: last))
    }

    /// 未来天数（默认 7 天）到期卡片预测统计表
    public func upcomingSchedule(days: Int = 7) -> [UpcomingDayStat] {
        guard days > 0 else { return [] }
        let startOfToday = calendar.startOfDay(for: now)
        var counts: [Date: Int] = [:]
        for item in scheduledCards where item.date > now {
            counts[calendar.startOfDay(for: item.date), default: 0] += 1
        }
        return (0..<days).compactMap { offset -> UpcomingDayStat? in
            guard let targetDate = calendar.date(byAdding: .day, value: offset, to: startOfToday) else { return nil }
            let count: Int
            if offset == 0 {
                count = due.count
            } else {
                count = counts[targetDate] ?? 0
            }
            return UpcomingDayStat(
                date: targetDate,
                count: count,
                isToday: offset == 0
            )
        }
    }

    /// 近期即将到期的卡片清单
    public func upcomingCards(limit: Int = 5) -> [(card: KnowledgeCard, date: Date)] {
        guard limit > 0 else { return [] }
        return Array(scheduledCards.prefix(limit))
    }
}
