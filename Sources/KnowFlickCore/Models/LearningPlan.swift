import Foundation

/// A deterministic plan based on recorded learning, independent of view state.
public struct LearningPlan: Sendable {
    public let due: [KnowledgeCard]
    public let completedToday: Int
    public let mastered: Int

    public init(cards: [KnowledgeCard], now: Date = Date(), calendar: Calendar = .current) {
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
    }

    /// First review the day after reading; then 1 / 3 / 7 days by recall rating.
    public static func reviewDate(for card: KnowledgeCard, calendar: Calendar = .current) -> Date? {
        guard let last = card.lastReviewedAt ?? card.seenAt else { return nil }
        let days = card.lastReviewedAt == nil ? 1 : (card.masteryLevel >= 2 ? 7 : card.masteryLevel == 1 ? 3 : 1)
        return calendar.date(byAdding: .day, value: days, to: calendar.startOfDay(for: last))
    }
}
