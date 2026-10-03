import Foundation
import Testing
@testable import KnowFlickCore

/// 测验选题语义（`QuizBuilder`）：原 AppStore.generateQuizCards 的域逻辑下沉，
/// 这些规则此前只被测过「负数 limit 返回空」一条——本轮补齐优先序、补足、排序、打乱可复现。
struct QuizBuilderTests {

    private func card(
        _ headline: String,
        category: String = "物理",
        mastery: Int = 0,
        reviewedAt: Date? = nil
    ) -> KnowledgeCard {
        var c = KnowledgeCard(category: category, headline: headline, summary: "摘要", details: "详情", source: .seed)
        c.masteryLevel = mastery
        c.lastReviewedAt = reviewedAt
        return c
    }

    /// limit ≤ 0：空题库
    @Test func nonPositiveLimitYieldsEmpty() {
        let cards = [card("A")]
        #expect(QuizBuilder.ranked(cards: cards, favorites: [], history: [], limit: 0).isEmpty)
        #expect(QuizBuilder.ranked(cards: cards, favorites: [], history: [], limit: -3).isEmpty)
    }

    /// 无分类：收藏优先 → 历史（非收藏）→ 不足时从余量补足；再按掌握度升序排序
    @Test func favoritesThenHistoryThenRestWithMasteryOrdering() {
        let favLow = card("收藏-掌握0", mastery: 0)
        let histHigh = card("历史-掌握2", mastery: 2)
        let histLow = card("历史-掌握0-早", mastery: 0, reviewedAt: Date(timeIntervalSince1970: 100))
        let rest = card("余量", mastery: 1)

        let ranked = QuizBuilder.ranked(
            cards: [rest, histHigh, favLow, histLow],
            favorites: [favLow],
            history: [histHigh, histLow],
            limit: 4
        )

        // 全员进入（收藏 1 + 历史 2 + 余量补 1），排序：掌握度升序，同级按复习时间升序
        #expect(Set(ranked.map(\.id)) == Set([favLow.id, histHigh.id, histLow.id, rest.id]))
        #expect(ranked[0].id == favLow.id, "同为掌握 0：未复习（distantPast）早于 1970 年时间戳，排最前")
        #expect(ranked[1].id == histLow.id, "掌握 0 且已复习者次之")
        #expect(ranked[2].id == rest.id)
        #expect(ranked[3].id == histHigh.id, "掌握 2 排最后")
    }

    /// 历史中的卡片若同时是收藏，不重复计入池
    @Test func favoritesAreNotDoubleCountedInHistory() {
        let fav = card("收藏且已读", mastery: 0)
        let ranked = QuizBuilder.ranked(
            cards: [fav],
            favorites: [fav],
            history: [fav],
            limit: 10
        )
        #expect(ranked.count == 1)
    }

    /// 分类路径：该分类收藏+历史优先；池为空时退回该分类全量；不掺其他分类
    @Test func categoryPathPrefersFavoritesAndHistoryThenFallsBack() {
        let physFav = card("物理收藏", category: "物理")
        let physHist = card("物理历史", category: "物理")
        let physOther = card("物理其他", category: "物理")
        let chem = card("化学", category: "化学")
        let all = [physFav, physHist, physOther, chem]

        let withHistory = QuizBuilder.ranked(
            cards: all,
            favorites: [physFav],
            history: [physHist],
            category: "物理",
            limit: 10
        )
        #expect(Set(withHistory.map(\.id)) == Set([physFav.id, physHist.id]), "有收藏/历史时不再补该分类余量")
        #expect(!withHistory.contains { $0.id == chem.id }, "不掺其他分类")

        let fallback = QuizBuilder.ranked(
            cards: all,
            favorites: [],
            history: [],
            category: "物理",
            limit: 10
        )
        #expect(Set(fallback.map(\.id)) == Set([physFav.id, physHist.id, physOther.id]), "空池退回该分类全量")
    }

    /// limit 截断：按排序取前 limit 张
    @Test func limitTruncatesAfterRanking() {
        let cards = (0..<5).map { card("卡\($0)", mastery: $0) }
        let ranked = QuizBuilder.ranked(cards: cards, favorites: [], history: [], limit: 3)
        #expect(ranked.count == 3)
        #expect(ranked.map(\.masteryLevel) == [0, 1, 2], "掌握度最低的三张入选")
    }

    /// 打乱可复现：同一随机种子两次选题结果一致；乱序后集合与 ranked 相同
    @Test func shuffledSelectionIsDeterministicGivenSeed() {
        let cards = (0..<10).map { card("卡\($0)") }
        var g1 = SeededGenerator(seed: 42)
        var g2 = SeededGenerator(seed: 42)
        let a = QuizBuilder.selectCards(cards: cards, favorites: [], history: [], limit: 6, using: &g1)
        let b = QuizBuilder.selectCards(cards: cards, favorites: [], history: [], limit: 6, using: &g2)
        #expect(a.map(\.id) == b.map(\.id), "同种子结果一致")
        #expect(Set(a.map(\.id)) == Set(QuizBuilder.ranked(cards: cards, favorites: [], history: [], limit: 6).map(\.id)))
    }

    /// AppStore 门面委派：generateQuizCards 与 QuizBuilder 选取集合一致（含分类与 limit）
    @MainActor
    @Test func appStoreFacadeMatchesBuilder() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let store = AppStore(storage: Storage(baseDir: directory))
        let c1 = card("一", category: "物理")
        let c2 = card("二", category: "物理")
        let c3 = card("三", category: "化学")
        store.importCards([c1, c2, c3], insertAtTop: false)

        let viaFacade = store.generateQuizCards(category: "物理", limit: 5)
        let viaBuilder = QuizBuilder.ranked(
            cards: store.cards,
            favorites: store.favorites,
            history: store.history,
            category: "物理",
            limit: 5
        )
        #expect(Set(viaFacade.map(\.id)) == Set(viaBuilder.map(\.id)))
    }
}

/// 测试用确定性随机源（SplitMix64）：同种子同序列
private struct SeededGenerator: RandomNumberGenerator {
    private var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }
}
