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
