import Foundation

/// 测验选题（原 AppStore.generateQuizCards 的域逻辑下沉）：收藏/历史优先 → 掌握度升序
/// （同级按上次复习时间升序）→ 取前 limit → 打乱。纯函数，`ranked` 给出打乱前的确定序
/// （测试可断言排序规则），`selectCards` 在其上加随机打乱（可注入随机源复现）。
public enum QuizBuilder {

    /// 打乱前的选取结果（确定性）：收藏/历史优先，其余按需补足。
    public static func ranked(
        cards: [KnowledgeCard],
        favorites: [KnowledgeCard],
        history: [KnowledgeCard],
        category: String? = nil,
        limit: Int = 10
    ) -> [KnowledgeCard] {
        guard limit > 0 else { return [] }
        var pool: [KnowledgeCard] = []

        if let category = category, !category.isEmpty {
            let catFavs = favorites.filter { $0.category == category }
            let catFavIds = Set(catFavs.map(\.id))
            let catHistory = history.filter { $0.category == category && !catFavIds.contains($0.id) }
            pool = catFavs + catHistory
            if pool.isEmpty {
                pool = cards.filter { $0.category == category }
            }
        } else {
            let favs = favorites
            let favIds = Set(favs.map(\.id))
            let others = history.filter { !favIds.contains($0.id) }
            pool = favs + others
            if pool.count < limit {
                let poolIds = Set(pool.map(\.id))
                let rest = cards.filter { !poolIds.contains($0.id) }
                pool += rest
            }
        }

        let sorted = pool.sorted { c1, c2 in
            if c1.masteryLevel != c2.masteryLevel {
                return c1.masteryLevel < c2.masteryLevel
            }
            let r1 = c1.lastReviewedAt ?? .distantPast
            let r2 = c2.lastReviewedAt ?? .distantPast
            return r1 < r2
        }

        return Array(sorted.prefix(min(limit, sorted.count)))
    }

    /// 选题（生产入口）：在 `ranked` 的确定序上打乱，避免每次测验顺序固定。
    public static func selectCards(
        cards: [KnowledgeCard],
        favorites: [KnowledgeCard],
        history: [KnowledgeCard],
        category: String? = nil,
        limit: Int = 10
    ) -> [KnowledgeCard] {
        var generator = SystemRandomNumberGenerator()
        return selectCards(
            cards: cards,
            favorites: favorites,
            history: history,
            category: category,
            limit: limit,
            using: &generator
        )
    }

    /// 可注入随机源的选题（测试用固定种子复现）
    public static func selectCards<G: RandomNumberGenerator>(
        cards: [KnowledgeCard],
        favorites: [KnowledgeCard],
        history: [KnowledgeCard],
        category: String? = nil,
        limit: Int = 10,
        using generator: inout G
    ) -> [KnowledgeCard] {
        ranked(cards: cards, favorites: favorites, history: history, category: category, limit: limit)
            .shuffled(using: &generator)
    }
}
