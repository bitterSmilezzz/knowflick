import Foundation
import Testing
@testable import KnowFlickCore

/// 测验选题语义的表征测试（Wave C1 下沉 `QuizBuilder` 前先锁现状）。
///
/// 此前唯一覆盖是「负数 limit 返回空」——收藏/历史优先、掌握度排序、混池补齐、
/// 分类过滤与打乱置换这些真实选题语义全部零断言。下沉到纯函数前把现状钉死：
/// 重构后这套断言逐字不变地保持绿色，才算行为等价。
@MainActor
struct QuizSelectionCharacterizationTests {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func card(
        _ headline: String,
        category: String = "冷知识",
        isFavorite: Bool = false,
        favoritedAt: Date? = nil,
        seenAt: Date? = nil,
        masteryLevel: Int = 0,
        lastReviewedAt: Date? = nil
    ) -> KnowledgeCard {
        KnowledgeCard(
            category: category,
            headline: headline,
            summary: "摘要",
            details: "正文",
            source: .seed,
            createdAt: now,
            seenAt: seenAt,
            isFavorite: isFavorite,
            favoritedAt: favoritedAt,
            masteryLevel: masteryLevel,
            lastReviewedAt: lastReviewedAt
        )
    }

    private func withStore(_ body: (AppStore) throws -> Void) throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = AppStore(storage: Storage(baseDir: directory))
        defer {
            store.closeChat()
            store.flushPersistence()
            try? FileManager.default.removeItem(at: directory)
        }
        try body(store)
    }

    // MARK: - 基础守卫

    /// 非 1 的正数 limit 合法；负数与 0 返回空（唯一曾有覆盖的语义，随迁保持）
    @Test func nonPositiveLimitsYieldEmptySelection() throws {
        try withStore { store in
            store.cards = [card("甲")]
            #expect(store.generateQuizCards(limit: -1).isEmpty)
            #expect(store.generateQuizCards(limit: 0).isEmpty)
            #expect(store.generateQuizCards(limit: 1).count == 1)
        }
    }

    // MARK: - 无分类：收藏 → 历史 → 混池补齐

    /// 优先级：收藏最先，其次历史（已读未收藏），最后才动用从未读过的卡。
    /// limit 收紧时按「掌握度升序 → 复习时间升序」排序取前缀。
    @Test func selectionPrefersFavoritesThenHistoryBeforeUnreadPool() throws {
        try withStore { store in
            let fav = card("收藏卡", isFavorite: true, favoritedAt: now, seenAt: now, masteryLevel: 2, lastReviewedAt: now)
            let seen = card("已读卡", seenAt: now, masteryLevel: 1, lastReviewedAt: now)
            let unread = card("未读卡")
            store.cards = [unread, fav, seen]

            let quiz = store.generateQuizCards(limit: 2)

            // 未读卡完全不进入前 2：pool = 收藏 + 历史，排序取前缀
            #expect(Set(quiz.map(\.headline)) == Set(["收藏卡", "已读卡"]))
        }
    }

    /// 掌握度升序是第一排序键：越没掌握越先被选中（mastery 0 在 mastery 2 之前）。
    @Test func lowerMasteryIsSelectedFirst() throws {
        try withStore { store in
            let mastered = card("已掌握", isFavorite: true, favoritedAt: now, seenAt: now, masteryLevel: 2, lastReviewedAt: now)
            let forgot = card("没想起来", isFavorite: true, favoritedAt: now, seenAt: now, masteryLevel: 0, lastReviewedAt: now)
            let hesitant = card("犹豫想起", isFavorite: true, favoritedAt: now, seenAt: now, masteryLevel: 1, lastReviewedAt: now)
            store.cards = [mastered, hesitant, forgot]

            // limit 2：排序后取 mastery 0 与 1，再打乱（集合相等即可，顺序不保证）
            let quiz = store.generateQuizCards(limit: 2)
            #expect(quiz.count == 2)
            #expect(Set(quiz.map(\.headline)) == Set(["没想起来", "犹豫想起"]))
            #expect(!quiz.contains { $0.headline == "已掌握" })
        }
    }

    /// 同掌握度按 lastReviewedAt 升序（从未复习 = distantPast，最先被选中）。
    @Test func olderReviewTimeIsSelectedFirstAtEqualMastery() throws {
        try withStore { store in
            let neverReviewed = card("从未复习", isFavorite: true, favoritedAt: now, seenAt: now)
            let recent = card("刚复习过", isFavorite: true, favoritedAt: now, seenAt: now,
                              masteryLevel: 0, lastReviewedAt: now)
            store.cards = [recent, neverReviewed]

            let quiz = store.generateQuizCards(limit: 1)
            #expect(quiz.map(\.headline) == ["从未复习"])
        }
    }

    /// 混池补齐：pool（收藏+历史）不足 limit 时，从未读卡中补齐。
    /// 注意现状语义：补齐后的排序是**跨全池**的掌握度排序——未读卡（mastery 0）
    /// 会排在 mastery 1 的收藏之前，limit 收紧时收藏可能被挤出选题（钉死现状，非理想化）。
    @Test func unreadCardsFillThePoolUpToLimit() throws {
        try withStore { store in
            let fav = card("收藏卡", isFavorite: true, favoritedAt: now, seenAt: now, masteryLevel: 1, lastReviewedAt: now)
            let unread = (0..<4).map { card("未读\($0)") }
            store.cards = [fav] + unread

            let quiz = store.generateQuizCards(limit: 3)
            #expect(quiz.count == 3)
            #expect(Set(quiz.map(\.headline)).count == 3, "选题不得重复")
            // 排序跨全池：mastery 0 的未读卡占满前 3，mastery 1 的收藏出局
            #expect(quiz.allSatisfy { $0.headline.hasPrefix("未读") })
        }
    }

    /// 收藏与历史去重：同一张卡既是收藏又在历史里时只出现一次（历史侧排除收藏 id）。
    @Test func favoritesAndHistoryDoNotDuplicateTheSameCard() throws {
        try withStore { store in
            let both = card("既收藏又读过", isFavorite: true, favoritedAt: now, seenAt: now)
            store.cards = [both]

            let quiz = store.generateQuizCards(limit: 5)
            #expect(quiz.map(\.headline) == ["既收藏又读过"])
        }
    }

    /// 输出是输入池同一集合的置换：打乱不增不减不换卡。
    @Test func shuffledOutputIsAPermutationOfTheSelectedPool() throws {
        try withStore { store in
            let favs = (0..<3).map { card("收藏\($0)", isFavorite: true, favoritedAt: now, seenAt: now) }
            let unread = (0..<5).map { card("未读\($0)") }
            store.cards = favs + unread

            let quiz = store.generateQuizCards(limit: 3)
            #expect(quiz.count == 3)
            // limit = 收藏数：选中的必是 3 张收藏（未读只在补齐时进入，此刻 pool 足额）
            #expect(Set(quiz.map(\.headline)) == Set(favs.map(\.headline)))
        }
    }

    // MARK: - 分类过滤

    /// 指定分类时只从该分类的收藏+历史里选；pool 为空才回退到该分类的全部卡。
    @Test func categoryScopedSelectionNeverMixesOtherCategories() throws {
        try withStore { store in
            let physicsFav = card("物理收藏", category: "物理", isFavorite: true, favoritedAt: now, seenAt: now)
            let physicsSeen = card("物理已读", category: "物理", seenAt: now)
            let physicsUnread = card("物理未读", category: "物理")
            let bioSeen = card("生物已读", category: "生物", seenAt: now)
            store.cards = [physicsFav, physicsSeen, physicsUnread, bioSeen]

            let quiz = store.generateQuizCards(category: "物理", limit: 2)
            #expect(Set(quiz.map(\.headline)) == Set(["物理收藏", "物理已读"]))
        }
    }

    /// 分类内收藏+历史为空时，回退到该分类全部卡（含未读）。
    @Test func emptyCategoryPoolFallsBackToAllCardsOfThatCategory() throws {
        try withStore { store in
            let physicsUnread = card("物理未读", category: "物理")
            let bioUnread = card("生物未读", category: "生物")
            store.cards = [physicsUnread, bioUnread]

            let quiz = store.generateQuizCards(category: "物理", limit: 5)
            #expect(quiz.map(\.headline) == ["物理未读"])
        }
    }

    /// 分类回退池同样受掌握度排序与 limit 约束。
    @Test func categoryFallbackPoolIsSortedAndLimited() throws {
        try withStore { store in
            let low = card("物理低掌握", category: "物理", masteryLevel: 0)
            let high = card("物理高掌握", category: "物理", masteryLevel: 2)
            store.cards = [high, low]

            let quiz = store.generateQuizCards(category: "物理", limit: 1)
            #expect(quiz.map(\.headline) == ["物理低掌握"])
        }
    }
}
