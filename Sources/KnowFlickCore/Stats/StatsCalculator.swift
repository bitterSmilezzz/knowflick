import Foundation

/// 学习统计快照：从浏览记录纯派生，无视图依赖，可独立测试
public struct LearningStats: Equatable {
    public let seenCount: Int          // 已刷卡片（含左划/右划/系统跳过）
    public let likedCount: Int         // 感兴趣（右划）
    public let skipCount: Int          // 系统跳过（换一批）
    public let likeRate: Double        // 感兴趣率 = liked / seen
    public let streakDays: Int         // 连续学习天数
    public let categories: [CategoryStat]

    public struct CategoryStat: Equatable, Identifiable {
        public let category: String
        public let seen: Int
        public let liked: Int

        public var likeRate: Double { seen > 0 ? Double(liked) / Double(seen) : 0 }
        public var id: String { category }

        public init(category: String, seen: Int, liked: Int) {
            self.category = category
            self.seen = seen
            self.liked = liked
        }
    }

    /// 单日已刷数量（用于趋势图）
    public struct DailyCount: Equatable, Identifiable {
        public let day: Date   // 当日 startOfDay
        public let count: Int  // 当天已刷卡数（含跳过）

        public var id: Date { day }

        public init(day: Date, count: Int) {
            self.day = day
            self.count = count
        }
    }

    public init(seenCount: Int, likedCount: Int, skipCount: Int, streakDays: Int, categories: [CategoryStat]) {
        self.seenCount = seenCount
        self.likedCount = likedCount
        self.skipCount = skipCount
        self.likeRate = seenCount > 0 ? Double(likedCount) / Double(seenCount) : 0
        self.streakDays = streakDays
        self.categories = categories
    }
}

/// 统计计算器：输入浏览记录，输出统计快照
public enum StatsCalculator {
    /// 最近 days 天（含今天）每天已刷数量，从最旧到最新
    public static func dailyCounts(
        cards: [KnowledgeCard],
        calendar: Calendar = .current,
        days: Int = 7,
        endingAt now: Date = Date()
    ) -> [LearningStats.DailyCount] {
        guard days > 0 else { return [] }
        let today = calendar.startOfDay(for: now)
        // 只累计每天的数量，避免 grouping 先创建日期数组和分组数组。
        var counts: [Date: Int] = [:]
        counts.reserveCapacity(min(cards.count, days))
        for card in cards {
            guard let seenAt = card.seenAt else { continue }
            let day = calendar.startOfDay(for: seenAt)
            counts[day, default: 0] += 1
        }
        return (0..<days).reversed().map { offset in
            guard let day = calendar.date(byAdding: .day, value: -offset, to: today) else {
                return LearningStats.DailyCount(day: today, count: 0)
            }
            return LearningStats.DailyCount(day: day, count: counts[day] ?? 0)
        }
    }

    /// 从卡片数组派生统计。calendar / now 可注入以便测试边界情况。
    public static func compute(
        from cards: [KnowledgeCard],
        calendar: Calendar = .current,
        now: Date = Date()
    ) -> LearningStats {
        // 单次遍历完成已看、喜欢、跳过和分类聚合，避免多次 filter/grouping
        // 产生临时数组；这条路径在统计页每次卡片状态变化时都会触发。
        var seenCount = 0
        var likedCount = 0
        var skipCount = 0
        var categoryCounts: [String: (seen: Int, liked: Int)] = [:]
        categoryCounts.reserveCapacity(min(cards.count, 32))
        var seenCards: [KnowledgeCard] = []
        seenCards.reserveCapacity(min(cards.count, 128))

        for card in cards {
            guard card.seenAt != nil else { continue }
            seenCount += 1
            seenCards.append(card)
            let liked = card.swiped == .right
            if liked { likedCount += 1 }
            if card.swiped == .skip { skipCount += 1 }
            var counts = categoryCounts[card.category, default: (seen: 0, liked: 0)]
            counts.seen += 1
            if liked { counts.liked += 1 }
            categoryCounts[card.category] = counts
        }

        let categories = categoryCounts.map { category, counts in
            LearningStats.CategoryStat(category: category, seen: counts.seen, liked: counts.liked)
        }
        .sorted {
            if $0.seen != $1.seen { return $0.seen > $1.seen }
            // Dictionary 分组没有稳定顺序；并列时按分类名排序，避免统计页重绘时行跳动。
            return $0.category.localizedStandardCompare($1.category) == .orderedAscending
        }

        return LearningStats(
            seenCount: seenCount,
            likedCount: likedCount,
            skipCount: skipCount,
            streakDays: streakDays(seenCards: seenCards, calendar: calendar, now: now),
            categories: categories
        )
    }

    /// 连续学习天数：seenAt 按日去重后，从今天（或昨天，保留当天空档）往前数连续天数
    static func streakDays(seenCards: [KnowledgeCard], calendar: Calendar, now: Date) -> Int {
        let days = Set(
            seenCards.compactMap { $0.seenAt }
                .map { calendar.startOfDay(for: $0) }
        )
        guard !days.isEmpty else { return 0 }
        var cursor = calendar.startOfDay(for: now)
        if !days.contains(cursor) {
            guard let yesterday = calendar.date(byAdding: .day, value: -1, to: cursor) else { return 0 }
            cursor = yesterday
        }
        var streak = 0
        while days.contains(cursor) {
            streak += 1
            guard let prev = calendar.date(byAdding: .day, value: -1, to: cursor) else { break }
            cursor = prev
        }
        return streak
    }
}
