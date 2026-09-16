import Foundation
import Testing
@testable import KnowFlickCore

/// P2-4 回归 + Step 3 证据：追问会话的读盘不再阻塞主线程，且不牺牲正确性。
///
/// 旧实现 `AppStore.openChat` 在 MainActor 上同步读整个 `chat_sessions.json` 并全量解码，
/// 长会话下打开面板会有可感知停顿。新实现：命中进程内缓存直接给结果，未命中先给空会话，
/// 读盘排到串行持久化队列上异步校正（并校验「还是这张卡 + 会话未被用户改动」）。
@MainActor
struct ChatSessionLoadTests {
    private func card(_ name: String) -> KnowledgeCard {
        KnowledgeCard(category: "冷知识", headline: name, summary: "摘要", details: "详情", source: .imported)
    }

    private func makeStore() -> (AppStore, Storage, URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let storage = Storage(baseDir: directory)
        return (AppStore(storage: storage), storage, directory)
    }

    private func withStore(_ body: (AppStore, Storage) async throws -> Void) async throws {
        let (store, storage, directory) = makeStore()
        defer {
            store.closeChat()
            store.flushPersistence()
            try? FileManager.default.removeItem(at: directory)
        }
        try await body(store, storage)
    }

    /// 轮询等待条件成立（超时保护，避免慢机误报）
    private func waitUntil(_ condition: () -> Bool) async {
        let deadline = ContinuousClock.now.advanced(by: .seconds(10))
        while !condition() && ContinuousClock.now < deadline {
            try? await Task.sleep(for: .milliseconds(20))
        }
    }

    private func persistedSession(cardId: UUID, headline: String) -> CardChatSession {
        var session = CardChatSession(cardId: cardId, cardHeadline: headline)
        session.messages = [CardChatMessage(sender: .user, content: "历史问题")]
        return session
    }

    /// 打开面板的那一刻不得同步读盘：先给空会话，磁盘内容稍后异步补上（且补得上）。
    @Test func openChatDoesNotReadFromDiskSynchronously() async throws {
        try await withStore { store, storage in
            let subject = card("异步读盘")
            try storage.saveChatSessionThrowing(persistedSession(cardId: subject.id, headline: subject.headline))

            store.openChat(for: subject)
            // 同步返回时必须是空会话：主线程没有等待任何文件 IO
            #expect(store.currentChatSession?.messages.isEmpty == true)

            await waitUntil { store.currentChatSession?.messages.isEmpty == false }
            #expect(store.currentChatSession?.messages.first?.content == "历史问题", "异步读盘必须把历史会话补上")
        }
    }

    /// 进程内缓存：第二次打开同一张卡直接命中缓存，不再读盘。
    /// 判据：把磁盘上的内容改成另一个版本，重开后必须仍是缓存版本（读盘的话会看到被改过的版本）。
    @Test func secondOpenServesFromTheInProcessCache() async throws {
        try await withStore { store, storage in
            let subject = card("缓存命中")
            try storage.saveChatSessionThrowing(persistedSession(cardId: subject.id, headline: subject.headline))

            store.openChat(for: subject)
            await waitUntil { store.currentChatSession?.messages.isEmpty == false }
            store.closeChat()

            var changed = CardChatSession(cardId: subject.id, cardHeadline: subject.headline)
            changed.messages = [CardChatMessage(sender: .user, content: "磁盘上被改过的版本")]
            try storage.saveChatSessionThrowing(changed)

            store.openChat(for: subject)
            try await Task.sleep(for: .milliseconds(200))
            #expect(
                store.currentChatSession?.messages.first?.content == "历史问题",
                "第二次打开应命中进程内缓存，而不是重新读盘"
            )
        }
    }

    /// 刚清除的卡以内存墓碑为准：重开时同步为空，异步读盘排在被清除之后，不会复活旧会话。
    @Test func clearedSessionIsNotResurrectedByTheAsyncLoad() async throws {
        try await withStore { store, storage in
            let subject = card("清除后重开")
            try storage.saveChatSessionThrowing(persistedSession(cardId: subject.id, headline: subject.headline))

            store.openChat(for: subject)
            await waitUntil { store.currentChatSession?.messages.isEmpty == false }

            store.clearCurrentChatSession()
            #expect(store.currentChatSession?.messages.isEmpty == true)

            store.openChat(for: subject)
            #expect(store.currentChatSession?.messages.isEmpty == true, "同步返回时必须为空（墓碑生效）")

            // 等队列真正跑到「清除已落盘」这一步，再确认内存里没有被迟到的读盘复活
            await waitUntil { storage.loadChatSession(for: subject.id) == nil }
            #expect(store.currentChatSession?.messages.isEmpty == true, "迟到的读盘不得复活被清除的会话")
        }
    }

    /// 用户已经动过这次会话（发了消息）时，迟到的读盘绝不覆盖。
    @Test func lateLoadNeverOverwritesWhatTheUserAlreadyTyped() async throws {
        try await withStore { store, storage in
            let subject = card("迟到读盘")
            try storage.saveChatSessionThrowing(persistedSession(cardId: subject.id, headline: subject.headline))

            store.openChat(for: subject)
            store.currentChatSession?.messages.append(CardChatMessage(sender: .user, content: "我抢先输入的内容"))

            // 等足够久（小文件读盘远快于此），磁盘内容始终不得覆盖用户输入
            try await Task.sleep(for: .seconds(1))
            #expect(
                store.currentChatSession?.messages.map(\.content) == ["我抢先输入的内容"],
                "磁盘内容不得覆盖用户已经输入的会话"
            )
        }
    }

    /// 换卡后晚到的读取结果必须丢弃（否则会把 A 卡的历史会话挂到 B 卡的会话里）。
    @Test func lateLoadIsDiscardedAfterSwitchingCards() async throws {
        try await withStore { store, storage in
            let first = card("第一张"), second = card("第二张")
            try storage.saveChatSessionThrowing(persistedSession(cardId: first.id, headline: first.headline))

            store.openChat(for: first)
            store.openChat(for: second)

            // 给排队的读盘足够时间落地（1s 远大于小文件读盘耗时；负载极高的机器上可能仍未跑完，
            // 那只会让这条断言变宽松，不会误报）
            try await Task.sleep(for: .seconds(1))
            #expect(store.currentChatSession?.cardId == second.id)
            #expect(store.currentChatSession?.messages.isEmpty == true, "第一张卡的历史会话不得挂到第二张上")
        }
    }

    /// 无历史会话的卡：打开即空会话，且不会因为异步读盘被替换成别的卡的内容。
    @Test func openingACardWithoutHistoryStaysEmpty() async throws {
        try await withStore { store, _ in
            let subject = card("没有历史")
            store.openChat(for: subject)
            try await Task.sleep(for: .milliseconds(200))
            #expect(store.currentChatSession?.cardId == subject.id)
            #expect(store.currentChatSession?.messages.isEmpty == true)
        }
    }

}
