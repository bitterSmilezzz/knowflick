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

    public init(cards: [KnowledgeCard], now: Date = Date(), calendar: Calendar = .current) {
        self.cards = cards
        self.now = now
        self.calendar = calendar

        completedToday = cards.filter {
            [$0.seenAt, $0.lastReviewedAt].compactMap { $0 }.contains {
                calendar.isDate($0, inSameDayAs: now)
            }
        }.count
        mastered = cards.filter { $0.masteryLevel >= 2 }.count

        // 预计算到期时间再排序：避免比较器内 O(n log n) 次重复日历运算
        due = cards.compactMap { card -> (card: KnowledgeCard, date: Date)? in
            guard let date = Self.reviewDate(for: card, calendar: calendar), date <= now else { return nil }
            return (card, date)
        }
        .sorted {
            if $0.date != $1.date { return $0.date < $1.date }
            return $0.card.id.uuidString < $1.card.id.uuidString
        }
        .map(\.card)

        let masteredCount = cards.filter { $0.masteryLevel >= 2 }.count
        let hesitantCount = cards.filter { $0.masteryLevel == 1 }.count
        let totalCards = cards.count
        let needsReviewCount = max(0, totalCards - masteredCount - hesitantCount)
        let testedCards = cards.filter { $0.reviewCount > 0 || $0.masteryLevel > 0 }.count
        let retentionRate: Int
        if testedCards == 0 {
            retentionRate = 0
        } else {
            let rate = (Double(masteredCount) * 1.0 + Double(hesitantCount) * 0.5) / Double(testedCards) * 100.0
            retentionRate = min(100, max(0, Int(rate.rounded())))
        }
        let totalReviews = cards.reduce(0) { $0 + $1.reviewCount }

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
        let startOfToday = calendar.startOfDay(for: now)
        return (0..<days).compactMap { offset -> UpcomingDayStat? in
            guard let targetDate = calendar.date(byAdding: .day, value: offset, to: startOfToday) else { return nil }
            let count: Int
            if offset == 0 {
                count = due.count
            } else {
                count = cards.filter { card in
                    guard let rDate = Self.reviewDate(for: card, calendar: calendar) else { return false }
                    return calendar.isDate(rDate, inSameDayAs: targetDate)
                }.count
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
        cards.compactMap { card -> (card: KnowledgeCard, date: Date)? in
            guard let date = Self.reviewDate(for: card, calendar: calendar) else { return nil }
            return (card, date)
        }
        .sorted {
            if $0.date != $1.date { return $0.date < $1.date }
            return $0.card.id.uuidString < $1.card.id.uuidString
        }
        .prefix(limit)
        .map { $0 }
    }
}
