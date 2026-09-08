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
}
