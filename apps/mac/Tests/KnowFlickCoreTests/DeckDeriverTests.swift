import Foundation
import Testing
@testable import KnowFlickCore

/// `DeckDeriver` 的纯函数单测（拆分方案 B Step 2）+ P2-3「插回/置顶不得绕过防重排布」的回归。
///
/// 为什么单独测纯函数：卡堆四条分支原先只能通过构造整个 AppStore 间接验证，`derive` 抽出来之后
/// 可以给定任意 `currentDeck` 构造边界（例如「撤销回来的卡与顶卡同图」这种真实可达但在 store 上难复现的序列）。
struct DeckDeriverTests {
    private func card(_ headline: String, category: String = "冷知识", source: CardSource = .seed) -> KnowledgeCard {
        KnowledgeCard(category: category, headline: headline, summary: "摘要", details: "正文", source: source)
    }

    /// 语义关键词「量子」→ quantum 图池：用来构造**确定的同图对**
    private func quantumCard(_ headline: String) -> KnowledgeCard {
        KnowledgeCard(category: "冷知识", headline: "量子\(headline)", summary: "摘要", details: "正文", source: .seed)
    }

    private func key(_ card: KnowledgeCard) -> String { CardThemeResolver.resolveKey(for: card) }

    // MARK: - 插回/置顶：防重排布不再被绕过（P2-3）

    /// 顶卡与队首同图时必须把冲突卡后移，而不是造出「间隔 1」的撞图。
    @Test func insertDisplacesCollidingNeighbourBehindMinDistance() {
        let top = quantumCard("顶卡")
        let colliding = quantumCard("近邻")
        let others = (0..<8).map { card("普通卡片\($0)") }
        #expect(key(top) == key(colliding), "前置条件：两张卡必须同图")

        let result = DeckDeriver.insertRespectingMinDistance(top, into: [colliding] + others)

        #expect(result.first?.id == top.id, "置顶语义不得改变")
        // 顶卡之后第一张同图卡的距离必须 ≥ 5（result 下标即距离）
        let firstSameKeyAfterTop = result.dropFirst().firstIndex { key($0) == key(top) }
        #expect((firstSameKeyAfterTop ?? Int.max) >= 5, "同图卡被顶卡压在 5 张以内")
        #expect(Set(result.map(\.id)).count == result.count, "不得重复或丢卡")
    }

    /// 无冲突时必须逐位保持原顺序（导入/置顶的正常路径不能因为防重检查而抖动）。
    @Test func insertWithoutCollisionPreservesOrderExactly() {
        let top = card("普通顶卡")
        let deck = (0..<7).map { card("普通卡片\($0)") }
        let result = DeckDeriver.insertRespectingMinDistance(top, into: deck)
        #expect(result.map(\.id) == [top.id] + deck.map(\.id))
    }

    /// 卡已在队里时插回应是「挪到队首」而不是复制一份。
    @Test func insertMovesAnExistingCardToTheTop() {
        let target = card("普通目标")
        let deck = [card("甲"), target, card("乙"), card("丙")]
        let result = DeckDeriver.insertRespectingMinDistance(target, into: deck)
        #expect(result.map(\.id) == [target.id] + deck.filter { $0.id != target.id }.map(\.id))
    }

    /// 退化输入（空队、单卡、全同图）不得崩溃或丢卡。
    @Test func insertHandlesDegenerateInputs() {
        let only = card("唯一")
        #expect(DeckDeriver.insertRespectingMinDistance(only, into: []).map(\.id) == [only.id])
        #expect(DeckDeriver.insertRespectingMinDistance(only, into: [only]).map(\.id) == [only.id])

        let allSameKey = (0..<6).map { quantumCard("同图\($0)") }
        let result = DeckDeriver.insertRespectingMinDistance(quantumCard("新顶卡"), into: allSameKey)
        #expect(result.count == 7)
        #expect(Set(result.map(\.id)).count == 7)
    }

    // MARK: - 撤销插回分支（原先裸插顶部）

    /// 撤销回来的卡与顶卡同图（收藏阁对未读收藏卡划不喜欢 → 撤销）：必须被安排到 ≥ minDistance 处。
    @Test func undoBranchKeepsSpacingWhenReturningCardCollidesWithTheTop() {
        let top = quantumCard("顶卡")
        let returning = quantumCard("被撤销的")
        let middles = (0..<8).map { card("中间卡\($0)") }
        let currentDeck = [top] + middles
        let allCards = [top, returning] + middles

        let derived = DeckDeriver.derive(
            cards: allCards,
            currentDeck: currentDeck,
            enableSeed: true,
            enableAI: true,
            preferredCategories: [],
            lastSwipedCardId: returning.id,
            lastSwipedKey: key(returning)
        )

        #expect(derived.deck.first?.id == returning.id, "撤销必须把卡插回顶部")
        let topIndex = try? #require(derived.deck.firstIndex { $0.id == top.id })
        #expect((topIndex ?? 0) >= 5, "同图的旧顶卡必须被推到 5 张以外")
    }

    /// 无冲突的撤销：顺序与撤销前完全一致（不得因为防重检查而重排）。
    @Test func undoBranchWithoutCollisionRestoresTheExactDeck() {
        let returning = card("被撤销的普通卡")
        let rest = (0..<6).map { card("后续卡片\($0)") }
        let derived = DeckDeriver.derive(
            cards: [returning] + rest,
            currentDeck: rest,
            enableSeed: true,
            enableAI: true,
            preferredCategories: [],
            lastSwipedCardId: returning.id,
            lastSwipedKey: key(returning)
        )
        #expect(derived.deck.map(\.id) == [returning.id] + rest.map(\.id))
    }

    // MARK: - 纯函数化的四条分支与过滤口径

    @Test func deriveEmptyPoolYieldsEmptyEverything() {
        let derived = DeckDeriver.derive(
            cards: [], currentDeck: [], enableSeed: true, enableAI: true,
            preferredCategories: [], lastSwipedCardId: nil, lastSwipedKey: nil
        )
        #expect(derived.deck.isEmpty)
        #expect(derived.history.isEmpty)
        #expect(derived.favorites.isEmpty)
    }

    /// 来源全关：队列为空（含导入卡片），历史/收藏仍照常派生
    @Test func deriveWithAllSourcesDisabledEmptiesTheDeck() {
        let seed = card("预置"), ai = card("生成", source: .ai), imported = card("导入", source: .imported)
        let derived = DeckDeriver.derive(
            cards: [seed, ai, imported], currentDeck: [seed, ai, imported],
            enableSeed: false, enableAI: false, preferredCategories: [],
            lastSwipedCardId: nil, lastSwipedKey: nil
        )
        #expect(derived.deck.isEmpty)
        #expect(derived.history.isEmpty)
    }

    /// 偏好分类耗尽后回退全量（不藏死其他卡）
    @Test func deriveFallsBackToAllUnseenWhenPreferenceIsExhausted() {
        let elsewhere = card("别处", category: "历史")
        let derived = DeckDeriver.derive(
            cards: [elsewhere], currentDeck: [],
            enableSeed: true, enableAI: true, preferredCategories: ["AI"],
            lastSwipedCardId: nil, lastSwipedKey: nil
        )
        #expect(derived.deck.map(\.id) == [elsewhere.id])
    }

    /// 历史按 seenAt 倒序、收藏按 favoritedAt 倒序（两条派生在同一处，顺序必须稳定）
    @Test func deriveSortsHistoryAndFavoritesByTheirOwnTimestamps() {
        let older = KnowledgeCard(category: "冷知识", headline: "较早", summary: "摘要", details: "正文",
                                  source: .seed, seenAt: Date(timeIntervalSince1970: 100))
        let newer = KnowledgeCard(category: "冷知识", headline: "较晚", summary: "摘要", details: "正文",
                                  source: .seed, seenAt: Date(timeIntervalSince1970: 200),
                                  isFavorite: true, favoritedAt: Date(timeIntervalSince1970: 300))
        let unreadFavorite = KnowledgeCard(category: "冷知识", headline: "未读但收藏", summary: "摘要", details: "正文",
                                           source: .seed, isFavorite: true, favoritedAt: Date(timeIntervalSince1970: 400))

        let derived = DeckDeriver.derive(
            cards: [older, newer, unreadFavorite], currentDeck: [],
            enableSeed: true, enableAI: true, preferredCategories: [],
            lastSwipedCardId: nil, lastSwipedKey: nil
        )
        #expect(derived.history.map(\.id) == [newer.id, older.id])
        #expect(derived.favorites.map(\.id) == [unreadFavorite.id, newer.id])
        #expect(derived.deck.map(\.id) == [unreadFavorite.id], "未读卡仍在待刷队列")
    }
}

/// P2-3 的端到端回归：三条绕过防重的路径（撤销插回 / 全局搜索置顶 / 导入置顶）在 store 上都不再撞图。
@MainActor
struct DeckInsertionRegressionTests {
    private func card(_ headline: String, category: String = "冷知识") -> KnowledgeCard {
        KnowledgeCard(category: category, headline: headline, summary: "摘要", details: "正文", source: .imported)
    }

    /// 语义关键词「量子」→ quantum 图池：构造确定的同图对
    private func quantumCard(_ headline: String) -> KnowledgeCard {
        KnowledgeCard(category: "冷知识", headline: "量子\(headline)", summary: "摘要", details: "正文", source: .imported)
    }

    private func key(_ card: KnowledgeCard) -> String { CardThemeResolver.resolveKey(for: card) }

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

    /// 全局搜索「准备浏览」置顶：目标卡与当前顶卡同图时，旧顶卡必须被推到 5 张以外。
    @Test func promoteToDeckTopKeepsDistanceFromThePreviousTop() throws {
        try withStore { store in
            let previousTop = quantumCard("原顶卡")
            store.cards = [previousTop] + (0..<8).map { card("普通卡\($0)") }
            store.promoteToDeckTop(previousTop)
            #expect(store.topCard?.id == previousTop.id)

            let target = quantumCard("要置顶的")
            store.cards.append(target)      // 置顶的目标卡必须已在卡片池里
            store.promoteToDeckTop(target)

            #expect(store.topCard?.id == target.id, "置顶语义不变")
            let previousTopIndex = try #require(store.deck.firstIndex { $0.id == previousTop.id })
            #expect(previousTopIndex >= 5, "同图的旧顶卡必须被推到 5 张以外")
        }
    }

    /// 导入置顶：导入块与原队首的新接缝也必须满足防重（旧的 `promoted + otherDeck` 拼接不保证）。
    @Test func importAtTopDoesNotCreateASeamCollision() throws {
        try withStore { store in
            let deckTop = quantumCard("原队首")
            store.cards = [deckTop] + (0..<8).map { card("普通卡\($0)") }
            store.promoteToDeckTop(deckTop)
            #expect(store.topCard?.id == deckTop.id)

            let imported = quantumCard("导入卡")
            store.importCards([imported], insertAtTop: true)

            #expect(store.topCard?.id == imported.id, "导入卡应置顶")
            let deckTopIndex = try #require(store.deck.firstIndex { $0.id == deckTop.id })
            #expect(deckTopIndex >= 5, "同图的原队首必须被推到 5 张以外")
            #expect(Set(store.deck.map(\.id)).count == store.deck.count, "不得重复卡")
        }
    }

    /// 导入置顶无冲突：导入块整体在最前，其余顺序逐位不变（原有行为不得倒退）。
    @Test func importAtTopWithoutCollisionKeepsTheRestOfTheDeckOrder() throws {
        try withStore { store in
            store.cards = (0..<6).map { card("原始卡\($0)") }
            let before = store.deck.map(\.id)
            let imported = [card("导入一"), card("导入二")]

            store.importCards(imported, insertAtTop: true)

            let importedIds = Set(imported.map(\.id))
            let front = store.deck.prefix(2).map(\.id)
            #expect(Set(front) == importedIds, "导入卡应在队首（顺序按哈希排布，集合相等即可）")
            #expect(store.deck.dropFirst(2).map(\.id) == before, "其余卡顺序逐位不变")
        }
    }

    /// 存档导入（`insertAtTop: false`）：已读卡进历史、不进卡堆（既有口径不得因防重改造而变）。
    @Test func importAppendingKeepsSeenCardsOutOfTheDeck() throws {
        try withStore { store in
            let seen = KnowledgeCard(category: "冷知识", headline: "已读卡", summary: "摘要", details: "正文",
                                     source: .imported, seenAt: Date(timeIntervalSince1970: 100))
            store.importCards([seen], insertAtTop: false)
            #expect(store.history.map(\.id) == [seen.id])
            #expect(store.deck.isEmpty)
        }
    }

    /// 同 key 的卡片池退化时插回不得丢卡（与 `arrangeWithMinDistance` 一致的降级口径）
    @Test func insertionNeverLosesCardsInDegradedPools() throws {
        try withStore { store in
            let pool = (0..<10).map { quantumCard("同图\($0)") }
            store.cards = pool
            let before = Set(store.deck.map(\.id))

            store.promoteToDeckTop(pool[5])

            #expect(Set(store.deck.map(\.id)) == before)
            #expect(store.topCard?.id == pool[5].id)
            let top = try #require(store.topCard)
            #expect(key(top) == key(pool[0]))
        }
    }
}
