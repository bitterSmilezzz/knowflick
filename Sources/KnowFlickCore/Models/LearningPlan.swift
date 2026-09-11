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
        due = cards.filter { Self.reviewDate(for: $0, calendar: calendar).map { $0 <= now } ?? false }
            .sorted {
                let lhs = Self.reviewDate(for: $0, calendar: calendar) ?? .distantFuture
                let rhs = Self.reviewDate(for: $1, calendar: calendar) ?? .distantFuture
                if lhs != rhs { return lhs < rhs }
                return $0.id.uuidString < $1.id.uuidString
            }
    }

    /// First review the day after reading; then 1 / 3 / 7 days by recall rating.
    public static func reviewDate(for card: KnowledgeCard, calendar: Calendar = .current) -> Date? {
        guard let last = card.lastReviewedAt ?? card.seenAt else { return nil }
        let days = card.lastReviewedAt == nil ? 1 : (card.masteryLevel >= 2 ? 7 : card.masteryLevel == 1 ? 3 : 1)
        return calendar.date(byAdding: .day, value: days, to: calendar.startOfDay(for: last))
    }
}
