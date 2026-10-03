import Foundation
import Testing
@testable import KnowFlickCore

/// Wave C2 主线程减负（c）的证据：追问会话表常驻内存——每条消息的落盘不再
/// load+decode 整个 `chat_sessions.json`，同时「磁盘为准」的口径不回退
/// （文件刚出现 / 别的实例刚写过时重新读盘，绝不拿旧内存表覆盖）。
///
/// 判据 `chatSessionDecodeCount` 是内部测试护栏（同 `deckRecomputeTrace` 口径）：
/// 它数的是**全量读盘（decode）次数**，不是方法调用次数。
struct ChatSessionStorageCacheTests {
    private func makeStorage() -> (Storage, URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        return (Storage(baseDir: directory), directory)
    }

    private func session(_ headline: String) -> CardChatSession {
        var session = CardChatSession(cardId: UUID(), cardHeadline: headline)
        session.messages = [CardChatMessage(sender: .user, content: "初始提问")]
        return session
    }

    /// 读一次：首次读盘后，反复读与连续落盘都不再触发 decode；写进去的内容一条不丢。
    @Test func repeatedSavesAndLoadsDecodeTheWholeFileOnlyOnce() throws {
        let (storage, directory) = makeStorage()
        defer { try? FileManager.default.removeItem(at: directory) }

        var latest = session("长会话")
        try storage.saveChatSessionThrowing(latest)
        #expect(storage.chatSessionDecodeCount == 1, "首次落盘读一次盘")

        for index in 1...20 {
            latest.messages.append(CardChatMessage(sender: .assistant, content: "第 \(index) 段回答"))
            try storage.saveChatSessionThrowing(latest)
        }
        for _ in 0..<5 { _ = storage.loadChatSessions() }

        #expect(storage.chatSessionDecodeCount == 1, "每条消息的落盘/每次读取不得再全量 decode")
        #expect(storage.loadChatSession(for: latest.cardId)?.messages.last?.content == "第 20 段回答")

        // 磁盘侧同样是最终版本（换一个全新实例读，绕开内存表）
        let fresh = Storage(baseDir: directory)
        #expect(fresh.loadChatSession(for: latest.cardId)?.messages.count == 21)
    }

    /// 不同会话交叉落盘：内存表是全量的，写一条不得丢别的会话。
    @Test func savingOneSessionKeepsEveryOtherSession() throws {
        let (storage, directory) = makeStorage()
        defer { try? FileManager.default.removeItem(at: directory) }

        let first = session("第一张"), second = session("第二张")
        try storage.saveChatSessionThrowing(first)
        try storage.saveChatSessionThrowing(second)
        var updated = first
        updated.messages.append(CardChatMessage(sender: .assistant, content: "补充回答"))
        try storage.saveChatSessionThrowing(updated)

        #expect(storage.chatSessionDecodeCount == 1)
        #expect(storage.loadChatSession(for: first.cardId)?.messages.count == 2)
        #expect(storage.loadChatSession(for: second.cardId)?.messages.count == 1)
    }

    /// 清除只移除目标会话，其余会话与磁盘内容保持一致。
    @Test func clearingOneSessionKeepsTheOthers() throws {
        let (storage, directory) = makeStorage()
        defer { try? FileManager.default.removeItem(at: directory) }

        let removed = session("被清除的"), kept = session("保留的")
        try storage.saveChatSessionThrowing(removed)
        try storage.saveChatSessionThrowing(kept)
        try storage.clearChatSessionThrowing(for: removed.cardId)

        #expect(storage.loadChatSession(for: removed.cardId) == nil)
        #expect(storage.loadChatSession(for: kept.cardId) != nil)

        let fresh = Storage(baseDir: directory)
        #expect(fresh.loadChatSession(for: removed.cardId) == nil, "清除必须落到磁盘")
        #expect(fresh.loadChatSession(for: kept.cardId) != nil)
    }

    /// 文件「晚于读取才出现」：读盘时文件还不存在，之后另一实例写入，读方必须能感知
    /// （否则 `ChatStreamTests` 的落盘轮询会永远读到空表）。
    @Test func fileAppearingAfterFirstReadIsPickedUp() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let reader = Storage(baseDir: directory)
        let writer = Storage(baseDir: directory)

        #expect(reader.loadChatSessions().isEmpty, "文件尚不存在时为空表")
        let subject = session("后出现的会话")
        try writer.saveChatSessionThrowing(subject)

        #expect(reader.loadChatSession(for: subject.cardId) != nil, "文件刚出现必须重新读盘")
        #expect(reader.chatSessionDecodeCount == 2, "首次空读 + 感知到文件出现后各读一次")
    }

    /// 多个实例（同一目录）不互相覆盖：A 读过的旧内存表不得在 A 落盘时挤掉 B 刚写入的会话。
    @Test func concurrentInstancesNeverClobberEachOthersWrites() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let firstInstance = Storage(baseDir: directory)
        let secondInstance = Storage(baseDir: directory)

        let fromFirst = session("一号写的")
        try firstInstance.saveChatSessionThrowing(fromFirst)

        let fromSecond = session("二号写的")
        #expect(secondInstance.loadChatSession(for: fromFirst.cardId) != nil, "新实例首次读盘必须看到已写内容")
        try secondInstance.saveChatSessionThrowing(fromSecond)

        // 一号实例此时内存表里还没有二号写的会话：落盘前必须先按指纹重新读盘，否则会把它挤掉
        let fromFirstAgain = session("一号又写的")
        try firstInstance.saveChatSessionThrowing(fromFirstAgain)

        let fresh = Storage(baseDir: directory)
        #expect(fresh.loadChatSession(for: fromFirst.cardId) != nil)
        #expect(fresh.loadChatSession(for: fromSecond.cardId) != nil, "别的实例刚写入的会话不得被旧内存表覆盖")
        #expect(fresh.loadChatSession(for: fromFirstAgain.cardId) != nil)
    }

    /// 不同 baseDir 的实例互不串缓存。
    @Test func differentBaseDirsDoNotShareTheTable() throws {
        let (storageA, directoryA) = makeStorage()
        let (storageB, directoryB) = makeStorage()
        defer {
            try? FileManager.default.removeItem(at: directoryA)
            try? FileManager.default.removeItem(at: directoryB)
        }

        let onlyInA = session("A 库的会话")
        try storageA.saveChatSessionThrowing(onlyInA)

        #expect(storageB.loadChatSessions().isEmpty, "不同 baseDir 不得串缓存")
        #expect(storageB.loadChatSession(for: onlyInA.cardId) == nil)

        let onlyInB = session("B 库的会话")
        try storageB.saveChatSessionThrowing(onlyInB)
        #expect(storageA.loadChatSession(for: onlyInB.cardId) == nil, "B 的会话不得出现在 A")
        #expect(storageA.loadChatSession(for: onlyInA.cardId) != nil, "A 自己的会话不受 B 影响")
    }
}
