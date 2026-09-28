import Foundation
import Testing
@testable import KnowFlickCore

/// 学习范围与学习地图的纯逻辑测试（与 Android `StudyScopeTest.kt` 逐条对齐）。
///
/// 关键契约有两条：范围生效时**接管分类维度**（不再受 preferredCategories 影响），
/// 以及「专学」必须保持导入顺序（不能被背景图防重打散，否则一点点看就断了）。
struct StudyScopeTests {

    /// 用 headline 当断言锚点（mac 的 id 是 UUID，语义锚点用标题更可读）；
    /// UUID 由 key 确定性派生，同一用例内重复调用也稳定
    private func card(
        _ key: String,
        category: String = "英语",
        subject: String? = nil,
        branch: String? = nil,
        level: Int? = nil,
        orderKey: String? = nil,
        seen: Bool = false,
        mastery: Int = 0
    ) -> KnowledgeCard {
        var bytes = Array(key.utf8.prefix(16))
        bytes.append(contentsOf: Array(repeating: UInt8(0), count: 16 - bytes.count))
        return KnowledgeCard(
            id: UUID(uuid: (bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                            bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15])),
            category: category,
            headline: key,
            summary: "摘要",
            details: "正文内容",
            source: .seed,
            createdAt: Date(timeIntervalSince1970: 1_800_000_000),
            seenAt: seen ? Date(timeIntervalSince1970: 1_800_000_900) : nil,
            masteryLevel: mastery,
            subject: subject,
            branch: branch,
            level: level,
            orderKey: orderKey
        )
    }

    private func pool() -> [KnowledgeCard] {
        [
            card("E1", subject: "english", branch: "grammar", level: 1, orderKey: "english/grammar/0001"),
            card("E2", subject: "english", branch: "grammar", level: 2, orderKey: "english/grammar/0002", seen: true),
            card("E3", subject: "english", branch: "vocabulary", level: 2, orderKey: "english/vocabulary/0001", mastery: 2),
            card("A1", category: "中级会计", subject: "accounting", branch: "assets", level: 1, orderKey: "accounting/assets/0001"),
            // 同名分支 slug 出现在另一个学科下：复合键必须把它们分开
            card("X1", category: "冷知识", subject: "trivia", branch: "assets", level: 3, orderKey: "trivia/assets/0001"),
            card("P1", category: "物理"),   // 未分级
        ]
    }

    // MARK: - 范围过滤

    @Test func subjectScopeIgnoresLegacyCategoryAndKeepsUngradedOut() {
        let scope = StudyScope(subjects: ["english"])
        #expect(scope.filter(pool()).map(\.headline) == ["E1", "E2", "E3"])
    }

    @Test func branchKeysAreScopedPerSubject() {
        let englishAssets = StudyScope(branches: [StudyScope.branchKey("accounting", "assets")])
        #expect(englishAssets.filter(pool()).map(\.headline) == ["A1"])

        let triviaAssets = StudyScope(branches: [StudyScope.branchKey("trivia", "assets")])
        #expect(triviaAssets.filter(pool()).map(\.headline) == ["X1"])
    }

    @Test func levelFilterAndMixedSelection() {
        #expect(
            StudyScope(levels: [2]).filter(pool()).map(\.headline) == ["E2", "E3"]
        )
        let mixed = StudyScope(branches: [
            StudyScope.branchKey("english", "grammar"),
            StudyScope.branchKey("accounting", "assets"),
        ])
        #expect(mixed.filter(pool()).map(\.headline) == ["E1", "E2", "A1"])
    }

    @Test func ungradedCardsFormTheirOwnShard() {
        let ungraded = StudyScope(branches: [StudyScope.branchKey(nil, nil)])
        #expect(ungraded.filter(pool()).map(\.headline) == ["P1"])
    }

    // MARK: - 顺序推进

    @Test func sequentialOrderingKeepsImportOrderAndPushesUnorderedToTheEnd() {
        let unordered = card("Z9", subject: "english", branch: "grammar", level: 1)
        let cards = [unordered, pool()[2], pool()[0], pool()[1]]
        let scope = StudyScope(
            subjects: ["english"],
            branches: [StudyScope.branchKey("english", "grammar")],
            sequential: true
        )
        // orderForDeck 只排序不过滤：输入里的 E3（vocabulary/0001）也参与排序
        #expect(scope.orderForDeck(cards).map(\.headline) == ["E1", "E2", "E3", "Z9"])
        // 非顺序模式保持原样（由卡堆的防重排布负责打散）
        var mixed = scope
        mixed.sequential = false
        #expect(mixed.orderForDeck(cards).map(\.headline) == cards.map(\.headline))
    }

    // MARK: - 徽标文案

    @Test func describeReadsLikeAHumanLabel() {
        #expect(StudyScope.none.describe() == "")
        let scope = StudyScope(
            subjects: ["english"],
            branches: [StudyScope.branchKey("english", "grammar")],
            levels: [2]
        )
        #expect(scope.describe() == "英语 · 语法、L2 基础", "分支标签已含学科前缀，不应再重复学科名")
        #expect(
            StudyScope(subjects: ["accounting"], branches: [StudyScope.branchKey("accounting", nil)]).describe() == "会计",
            "未分分支的支线圈只显示学科名"
        )
        #expect(StudyScope(subjects: ["english"]).describe() == "英语")
    }

    // MARK: - 学习地图派生

    @Test func subjectProgressOrdersUngradedLastAndCountsProgress() {
        let rows = StudyMap.subjectProgress(pool())
        #expect(rows.last?.name == "未分级", "未分级必须排最后")
        let english = rows.first { $0.slug == "english" }
        #expect(english?.total == 3)
        #expect(english?.seen == 1)
        #expect(english?.mastered == 1)
        #expect(english?.branchCount == 2)
    }

    @Test func branchProgressExposesLevelLadderAndNextLevel() {
        let branches = StudyMap.branchProgress(pool(), subject: "english")
        let grammar = branches.first { $0.slug == "grammar" }
        #expect(grammar?.total == 2)
        #expect(grammar?.seen == 1)
        #expect(grammar?.levels.map(\.level) == [1, 2])
        #expect(grammar?.nextLevel == 1, "L1 还没学过 → 下一步就是 L1")

        let vocabulary = branches.first { $0.slug == "vocabulary" }
        #expect(vocabulary?.nextLevel == 2, "掌握≠看过：E3 没有 seenAt，下一步仍是它所在难度")

        let finished = StudyMap.branchProgress(
            [card("D1", subject: "english", branch: "grammar", level: 1, seen: true)],
            subject: "english"
        )
        #expect(finished.first?.nextLevel == nil, "全部看过的分支不再给下一步")
    }

    @Test func remainingCountsOnlyUnseenCards() {
        let scope = StudyScope(subjects: ["english"])
        #expect(StudyMap.remaining(pool(), scope: scope) == 2)
    }

    // MARK: - 卡堆接入（DeckDeriver）

    @Test func deckNarrowsToScopeAndTakesOverCategoryPreference() {
        let cards = pool()
        func derive(_ scope: StudyScope) -> [KnowledgeCard] {
            DeckDeriver.derive(
                cards: cards,
                currentDeck: [],
                enableSeed: true,
                enableAI: true,
                preferredCategories: ["中级会计"],
                studyScope: scope,
                lastSwipedCardId: nil,
                lastSwipedKey: nil
            ).deck
        }

        let withPreference = derive(.none).map(\.headline)
        #expect(withPreference == ["A1"])

        // 范围生效时接管分类维度：偏好「中级会计」不再起作用；
        // 卡堆只收未学过的，且严格按 orderKey 推进
        let scoped = StudyScope(subjects: ["english"], sequential: true)
        #expect(derive(scoped).map(\.headline) == ["E1", "E3"])

        #expect(derive(.none).map(\.headline) == withPreference, "退出范围后回到偏好分类")
    }

    @Test func sequentialScopeSkipsBackgroundAntiCollisionShuffle() {
        let many = (1...14).map { index -> KnowledgeCard in
            card(
                "S\(index)",
                category: "冷知识",
                subject: "trivia",
                branch: "assets",
                orderKey: String(format: "trivia/assets/%04d", index)
            )
        }
        let derived = DeckDeriver.derive(
            cards: many,
            currentDeck: [],
            enableSeed: true,
            enableAI: true,
            preferredCategories: [],
            studyScope: StudyScope(subjects: ["trivia"], sequential: true),
            lastSwipedCardId: nil,
            lastSwipedKey: nil
        )
        #expect(derived.deck.map(\.headline) == many.map(\.headline), "顺序模式下必须按导入顺序推进")
    }
}
