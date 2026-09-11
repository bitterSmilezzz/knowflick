import Foundation
import Testing
@testable import KnowFlickCore

@MainActor
struct AppStoreTests {
    private func card(_ name: String, source: CardSource = .seed, category: String = "冷知识") -> KnowledgeCard {
        KnowledgeCard(category: category, headline: name, summary: "摘要", details: "详情", source: source)
    }

    private func withStore(_ body: (AppStore, Storage, URL) throws -> Void) throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let storage = Storage(baseDir: directory)
        let store = AppStore(storage: storage)
        defer {
            store.closeChat()
            store.flushPersistence()
            try? FileManager.default.removeItem(at: directory)
        }
        try body(store, storage, directory)
    }

    @Test func sourceSwitchesRespectAllFourCombinations() throws {
        try withStore { store, _, _ in
            let seed = card("种子"), ai = card("人工智能", source: .ai)
            store.cards = [seed, ai]
            for seedEnabled in [true, false] {
                for aiEnabled in [true, false] {
                    store.settings.enableSeed = seedEnabled
                    store.settings.enableAI = aiEnabled
                    let expected = [seedEnabled ? seed.id : nil, aiEnabled ? ai.id : nil].compactMap { $0 }
                    #expect(Set(store.deck.map(\.id)) == Set(expected))
                }
            }
        }
    }

    @Test @MainActor func injectedSpeechServiceIsUsedByTheStore() {
        let service = SpeechSynthesizerService()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = AppStore(storage: Storage(baseDir: directory), speechService: service)
        #expect(store.speechService === service)
        store.closeChat()
        store.flushPersistence()
        try? FileManager.default.removeItem(at: directory)
    }

    @Test @MainActor func shutdownStopsSpeechAndFlushesWithoutLeakingState() {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let service = SpeechSynthesizerService()
        let store = AppStore(storage: Storage(baseDir: directory), speechService: service)
        let card = card("退出测试")
        store.cards = [card]
        service.speak(card: card)
        store.shutdown()
        #expect(service.state == .idle)
        #expect(!service.isAmbientMode)
        #expect(store.persistenceWarning == nil)
        try? FileManager.default.removeItem(at: directory)
    }

    @Test func exhaustedPreferencesFallBackAndUndoReturnsCardToTop() throws {
        try withStore { store, _, _ in
            let preferred = card("优先", category: "AI")
            let other = card("其他")
            store.cards = [preferred, other]
            store.settings.categoryFilter = "AI"
            #expect(store.deck.map(\.id) == [preferred.id])
            store.swipe(preferred, direction: .right)
            #expect(store.deck.map(\.id) == [other.id])
            store.undoLastSwipe()
            #expect(store.topCard?.id == preferred.id)
            #expect(store.history.isEmpty)
        }
    }

    @Test func deckKeepsOrderButRefreshesCardValues() throws {
        try withStore { store, _, _ in
            store.cards = [card("一"), card("二"), card("三")]
            let order = store.deck.map(\.id)
            let top = try #require(store.topCard)
            store.recordQuizResult(cardId: top.id, rating: .mastered)
            #expect(store.deck.map(\.id) == order)
            #expect(store.topCard?.masteryLevel == 2)
            #expect(store.topCard?.reviewCount == 1)
        }
    }

    @Test func immediateFlushSavesLatestSwipeAndUndo() throws {
        try withStore { store, storage, _ in
            let first = card("一")
            store.cards = [first]
            store.swipe(first, direction: .right)
            store.flushPersistence()
            #expect(storage.loadCards().first?.swiped == .right)
            store.undoLastSwipe()
            store.flushPersistence()
            #expect(storage.loadCards().first?.seenAt == nil)
            #expect(storage.loadCards().first?.swiped == nil)
        }
    }

    @Test func cancelChatRemovesEmptyPlaceholderAndPersistsPartialReply() throws {
        try withStore { store, storage, _ in
            let first = card("一")
            store.openChat(for: first)
            store.currentChatSession?.messages = [
                CardChatMessage(sender: .user, content: "解释"),
                CardChatMessage(sender: .assistant, content: "部分回答", isStreaming: true)
            ]
            store.cancelChatStreaming()
            #expect(store.currentChatSession?.messages.last?.isStreaming == false)
            #expect(storage.loadChatSession(for: first.id)?.messages.last?.content == "部分回答")
            store.currentChatSession?.messages.append(CardChatMessage(sender: .assistant, content: "", isStreaming: true))
            store.cancelChatStreaming()
            #expect(store.currentChatSession?.messages.count == 2)
        }
    }

    @Test func switchingChatSavesPreviousCardAndClearKeepsOtherSessions() throws {
        try withStore { store, storage, _ in
            let first = card("一"), second = card("二")
            store.openChat(for: first)
            store.currentChatSession?.messages.append(CardChatMessage(sender: .user, content: "问题"))
            store.openChat(for: second)
            #expect(storage.loadChatSession(for: first.id)?.messages.count == 1)
            #expect(store.currentChatSession?.cardId == second.id)
            store.clearCurrentChatSession()
            #expect(storage.loadChatSession(for: first.id)?.messages.count == 1)
            #expect(storage.loadChatSession(for: second.id) == nil)
        }
    }

    @Test func nonpositiveQuizLimitsAreEmpty() throws {
        try withStore { store, _, _ in
            store.cards = [card("一")]
            #expect(store.generateQuizCards(limit: -1).isEmpty)
            #expect(store.generateQuizCards(limit: 0).isEmpty)
        }
    }

    // MARK: - 收藏与喜好意图解耦（回归：P1-3 / P1-1）

    /// 右划「感兴趣」应同时进入收藏阁，左划「不喜欢」应移出收藏阁——
    /// 否则收藏阁空状态承诺的「向右轻划沉淀知识」永不成立（交叉审计 P1-1）。
    @Test func swipeDirectionDrivesFavoriteMembership() throws {
        try withStore { store, _, _ in
            let liked = card("喜欢"), disliked = card("不喜欢")
            store.cards = [liked, disliked]

            store.swipe(liked, direction: .right)
            #expect(store.isFavorite(liked))
            #expect(store.favorites.map(\.id) == [liked.id])

            store.swipe(disliked, direction: .right)
            #expect(store.isFavorite(disliked))
            store.swipe(disliked, direction: .left)
            #expect(!store.isFavorite(disliked))   // 不喜欢应移出收藏
            #expect(store.favorites.map(\.id) == [liked.id])

            // 系统跳过不表达喜好，也不应改动收藏状态
            store.swipe(liked, direction: .skip)
            #expect(store.isFavorite(liked))
        }
    }

    /// 收藏只翻转 isFavorite，不得改写 swiped，否则会污染 likeRate / skipCount 统计。
    @Test func toggleFavoriteDoesNotTouchSwiped() throws {
        try withStore { store, _, _ in
            let disliked = card("不喜欢但想留着")
            store.cards = [disliked]
            store.swipe(disliked, direction: .left)

            store.toggleFavorite(disliked)
            #expect(store.isFavorite(disliked))
            #expect(store.cards[0].swiped == .left)   // 收藏不得把「不喜欢」改写成 right/skip

            store.toggleFavorite(disliked)
            #expect(!store.isFavorite(disliked))
            #expect(store.cards[0].swiped == .left)   // 取消收藏不得改写成 skip
        }
    }

    /// 取消收藏后卡片必须从 store.favorites 消失（favorites 由 isFavorite 派生）。
    @Test func unfavoriteRemovesCardFromFavorites() throws {
        try withStore { store, _, _ in
            let first = card("一"), second = card("二")
            store.cards = [first, second]
            store.toggleFavorite(first)
            store.toggleFavorite(second)
            #expect(Set(store.favorites.map(\.id)) == Set([first.id, second.id]))

            store.toggleFavorite(first)
            #expect(store.favorites.map(\.id) == [second.id])
            #expect(!store.isFavorite(first))
        }
    }

    /// 历史页打标签只改 swiped，保留原 seenAt，避免卡片被顶到时间线顶部。
    @Test func swipeOnSeenCardPreservesSeenAt() throws {
        try withStore { store, _, _ in
            let seen = card("已读")
            store.cards = [seen]
            store.swipe(seen, direction: .skip)
            let firstSeenAt = try #require(store.cards[0].seenAt)

            store.swipe(seen, direction: .right)
            #expect(store.cards[0].swiped == .right)
            #expect(store.cards[0].seenAt == firstSeenAt)
            #expect(store.history.first?.id == seen.id)
        }
    }

    /// 「重新探索全部卡片」应重置浏览进度与派生统计，但**不得**清空收藏阁。
    @Test func clearHistoryResetsProgressButKeepsFavorites() throws {
        try withStore { store, _, _ in
            let liked = card("已收藏"), other = card("其他")
            store.cards = [liked, other]
            store.swipe(liked, direction: .right)
            store.swipe(other, direction: .left)
            #expect(store.favorites.map(\.id) == [liked.id])

            store.clearHistory()

            // 浏览进度与派生统计归零
            #expect(store.history.isEmpty)
            #expect(store.cards.allSatisfy { $0.seenAt == nil })
            let stats = StatsCalculator.compute(from: store.cards)
            #expect(stats.seenCount == 0)
            #expect(stats.likedCount == 0)
            // 收藏阁内容保留
            #expect(store.favorites.map(\.id) == [liked.id])
            #expect(store.isFavorite(liked))
        }
    }

    /// 收藏阁按 favoritedAt 排序：收藏未读卡不再因 seenAt 为空而沉底。
    @Test func favoritesOrderByFavoriteTimeNotSeenTime() throws {
        try withStore { store, _, _ in
            let unread = card("未读"), read = card("已读")
            store.cards = [unread, read]

            store.swipe(read, direction: .skip)     // 已读但未收藏
            store.toggleFavorite(unread)            // 收藏未读卡（不写 seenAt）
            store.toggleFavorite(read)              // 再收藏已读卡（收藏时间更晚）

            #expect(store.cards.first(where: { $0.id == unread.id })?.seenAt == nil)
            // 后收藏的排前面，与是否浏览过无关
            #expect(store.favorites.map(\.id) == [read.id, unread.id])
        }
    }
}
