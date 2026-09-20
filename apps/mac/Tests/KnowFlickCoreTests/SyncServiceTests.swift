import Foundation
import Testing
@testable import KnowFlickCore

struct SyncServiceTests {

    private func createTestCard(id: UUID = UUID(), headline: String) -> KnowledgeCard {
        KnowledgeCard(
            id: id,
            category: "物理",
            headline: headline,
            summary: "测试摘要",
            details: "测试详情",
            links: [],
            source: .seed,
            createdAt: Date(),
            seenAt: nil
        )
    }

    @Test func syncServerStartAndStop() {
        let server = SyncServer(
            accessCode: "123456",
            getCards: { [] },
            onReceiveCards: { _ in (added: 0, restored: 0, ignored: 0) }
        )

        let result = server.start(preferredPort: 18998)
        switch result {
        case .success(let port):
            #expect(port >= 18998)
            #expect(server.isRunning)
        case .failure(let error):
            Issue.record("SyncServer start failed: \(error)")
        }

        server.stop()
        #expect(!server.isRunning)
    }

    @Test func syncClientFetchRemoteInfo() async throws {
        let serverCard = createTestCard(headline: "量子纠缠")
        let server = SyncServer(
            accessCode: "654321",
            getCards: { [serverCard] },
            onReceiveCards: { _ in (added: 0, restored: 0, ignored: 0) }
        )

        let startRes = server.start(preferredPort: 18999)
        guard case .success(let port) = startRes else {
            Issue.record("Server start failed")
            return
        }
        defer { server.stop() }

        let target = "127.0.0.1:\(port)#654321"
        let info = try await SyncClient.fetchRemoteInfo(target: target)
        #expect(info.cardCount == 1)
        #expect(!info.deviceName.isEmpty)
    }

    @Test func syncClientBidirectionalSync() async throws {
        let serverCard = createTestCard(headline: "中子星")
        let clientCard = createTestCard(headline: "黑洞")

        let receivedBox = ReceivedBox()

        let server = SyncServer(
            accessCode: "888999",
            getCards: { [serverCard] },
            onReceiveCards: { incoming in
                receivedBox.set(incoming)
                return (added: incoming.count, restored: 0, ignored: 0)
            }
        )

        let startRes = server.start(preferredPort: 19001)
        guard case .success(let port) = startRes else {
            Issue.record("Server start failed")
            return
        }
        defer { server.stop() }

        let target = "127.0.0.1:\(port)#888999"
        let result = try await SyncClient.executeBidirectionalSync(
            target: target,
            localCards: [clientCard]
        ) { pulled in
            #expect(pulled.count == 1)
            #expect(pulled[0].headline == "中子星")
            return (added: 1, restored: 0, ignored: 0)
        }

        #expect(result.pushedCount == 1)
        #expect(result.pulledCount == 1)
        #expect(result.addedCount == 1)

        // 验证服务端收到 clientCard
        let received = receivedBox.get()
        #expect(received.count == 1)
        #expect(received[0].headline == "黑洞")
    }

    @Test func fieldLevelMergeCommutative() {
        let cardId = UUID()
        let t1 = Date(timeIntervalSince1970: 1000)
        let t2 = Date(timeIntervalSince1970: 2000)
        let t3 = Date(timeIntervalSince1970: 3000)

        // 设备 A：在 t2 收藏了卡片，复习了 1 次（熟练度 1）
        let cardA = KnowledgeCard(
            id: cardId,
            category: "物理",
            headline: "量子纠缠",
            summary: "幽灵般的超距作用",
            details: "爱因斯坦称之为幽灵般的超距作用...",
            source: .seed,
            createdAt: t1,
            seenAt: t2,
            swiped: .right,
            isFavorite: true,
            favoritedAt: t2,
            reviewCount: 1,
            masteryLevel: 1,
            lastReviewedAt: t2,
            repetition: 1,
            intervalDays: 3,
            easeFactor: 2.5
        )

        // 设备 B：未收藏，但在更晚的 t3 进行了第二次复习（熟练度 2，掌握）
        let cardB = KnowledgeCard(
            id: cardId,
            category: "物理",
            headline: "量子纠缠",
            summary: "幽灵般的超距作用",
            details: "爱因斯坦称之为幽灵般的超距作用...",
            source: .seed,
            createdAt: t1,
            seenAt: t3,
            swiped: .skip,
            isFavorite: false,
            favoritedAt: nil,
            reviewCount: 2,
            masteryLevel: 2,
            lastReviewedAt: t3,
            repetition: 2,
            intervalDays: 7,
            easeFactor: 2.6
        )

        let mergedAB = CardImportEngine.mergeCard(cardA, cardB)
        let mergedBA = CardImportEngine.mergeCard(cardB, cardA)

        // 验证对称性：merge(A, B) == merge(B, A)
        #expect(mergedAB == mergedBA)

        // 验证字段级智能合并结果：
        // 1. 收藏：A 端收藏了，保留收藏，favoritedAt 为 t2
        #expect(mergedAB.isFavorite == true)
        #expect(mergedAB.favoritedAt == t2)
        // 2. 浏览足迹：取最新的 t3
        #expect(mergedAB.seenAt == t3)
        // 3. 复习次数：取最大值 2
        #expect(mergedAB.reviewCount == 2)
        // 4. 记忆模型与熟练度：B 端在 t3 复习更新，继承 B 端的熟练度 2 与排程参数
        #expect(mergedAB.masteryLevel == 2)
        #expect(mergedAB.lastReviewedAt == t3)
        #expect(mergedAB.repetition == 2)
        #expect(mergedAB.intervalDays == 7)
        #expect(mergedAB.easeFactor == 2.6)
    }

    @Test func mergeCardListUpgradesExistingCards() {
        let cardId = UUID()
        let t1 = Date(timeIntervalSince1970: 1000)
        let t2 = Date(timeIntervalSince1970: 2000)

        let localCard = KnowledgeCard(
            id: cardId,
            category: "计算机",
            headline: "图灵完备",
            summary: "计算模型理论",
            details: "图灵机是计算的抽象模型",
            source: .seed,
            createdAt: t1,
            seenAt: t1,
            isFavorite: false,
            reviewCount: 0,
            masteryLevel: 0
        )

        let remoteCard = KnowledgeCard(
            id: cardId,
            category: "计算机",
            headline: "图灵完备",
            summary: "计算模型理论",
            details: "图灵机是计算的抽象模型",
            source: .seed,
            createdAt: t1,
            seenAt: t2,
            isFavorite: true,
            favoritedAt: t2,
            reviewCount: 1,
            masteryLevel: 2,
            lastReviewedAt: t2
        )

        let newCard = KnowledgeCard(
            id: UUID(),
            category: "哲学",
            headline: "忒修斯之船",
            summary: "同一性悖论",
            details: "当所有木板都被替换...",
            source: .seed,
            createdAt: t1
        )

        let (merged, added, updated, ignored) = CardImportEngine.mergeCardList(
            existing: [localCard],
            incoming: [remoteCard, newCard]
        )

        #expect(merged.count == 2)
        #expect(added == 1)
        #expect(updated == 1)
        #expect(ignored == 0)

        // 验证原有卡片在原位被就地升级
        let updatedLocal = merged.first { $0.id == cardId }!
        #expect(updatedLocal.isFavorite == true)
        #expect(updatedLocal.masteryLevel == 2)
        #expect(updatedLocal.reviewCount == 1)
    }

    @Test func syncClientInvalidPairingCodeFailsImmediately() async {
        let server = SyncServer(
            accessCode: "999888",
            getCards: { [] },
            onReceiveCards: { _ in (added: 0, restored: 0, ignored: 0) }
        )
        let startRes = server.start(preferredPort: 19003)
        guard case .success(let port) = startRes else {
            Issue.record("Server start failed")
            return
        }
        defer { server.stop() }

        let wrongTarget = "127.0.0.1:\(port)#000000"
        do {
            _ = try await SyncClient.fetchRemoteInfo(target: wrongTarget)
            Issue.record("Should have failed with invalid pairing code")
        } catch {
            let nsErr = error as NSError
            #expect(nsErr.code == 401)
            #expect(nsErr.localizedDescription.contains("配对码错误"))
        }
    }
}

private final class ReceivedBox: @unchecked Sendable {
    private let lock = NSLock()
    private var cards: [KnowledgeCard] = []

    func set(_ newCards: [KnowledgeCard]) {
        lock.lock()
        defer { lock.unlock() }
        cards = newCards
    }

    func get() -> [KnowledgeCard] {
        lock.lock()
        defer { lock.unlock() }
        return cards
    }
}
