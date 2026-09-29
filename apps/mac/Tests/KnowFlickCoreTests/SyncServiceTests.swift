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

    @Test(.timeLimit(.minutes(1))) func syncClientInvalidPairingCodeFailsImmediately() async {
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

    /// 退避重试必须尊重取消：取消后应当立刻以 `CancellationError` 结束，而不是把用户自己的
    /// 取消伪装成一条网络故障。
    ///
    /// 实测（去掉修复后本用例变红，失败的是**错误类型**那条）暴露的真实影响比预想小：
    /// `URLSession` 在已取消的 task 上会直接短路，**不会真的发出请求**——所以「取消后仍向对端
    /// POST 整个卡片库」并不会发生，`requests == 1` 那条在未修复时也照样通过。真正的两个问题是：
    /// ① 循环空转剩余尝试，各白等一次退避（0.5s + 1s）；
    /// ② 最终把 `URLError.cancelled` 包成「局域网通信失败: cancelled」抛给用户，
    ///    用户看到的是网络故障，而操作是他自己取消的。
    ///
    /// 两条断言都留着：请求数守住「不产生额外对外流量」，错误类型守住「取消语义不被伪装」。
    @Test(.timeLimit(.minutes(1))) func cancelledSyncStopsRetryingAndNeverHitsPeerAgain() async throws {
        let peer = try CountingRefusingPeer()
        defer { peer.stop() }

        let task = Task { try await SyncClient.fetchRemoteInfo(target: "127.0.0.1:\(peer.port)#123456") }

        // 对端回 500（可重试）→ 首次尝试失败 → 客户端进入退避
        let gotFirst = await peer.waitForRequests(atLeast: 1)
        #expect(gotFirst, "对端至少应收到第一次请求")

        task.cancel()

        // 退避首档是 0.5s + 抖动（最多 100ms），第二档 1s。等过第一个窗口：
        // 若退避仍在继续，第二次尝试一定已经发生（发不发得出去另说）。
        try await Task.sleep(for: .milliseconds(1500))

        #expect(peer.requests == 1, "取消后不应再向对端发起请求，实际发出 \(peer.requests) 次")

        let outcome = await task.result
        if case .failure(let error) = outcome {
            #expect(error is CancellationError, "取消应抛 CancellationError，实际 \(error)")
        } else {
            Issue.record("被取消的同步不应成功返回")
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

/// 只数「完整 HTTP 请求」并回 500 的假对端，用来把 SyncClient 稳定地推进退避分支。
///
/// 为什么不用 URLProtocol 替身：`performRequestWithRetry` 走的是 `URLSession.shared`，
/// 全局注册 URLProtocol 既脆弱又会污染同进程内其它测试。
///
/// 为什么数「请求」而不是「连接」：对端若接受连接后立刻关闭，`URLSession` 会在**内部**
/// 自行重试连接级失败，客户端的一次 `data(for:)` 就可能产生多条 TCP 连接——那测到的是
/// URLSession 的行为，不是退避循环的行为。这里读满一个请求行再回 500：每次尝试都走完整
/// HTTP 往返，URLSession 不会内部重试，于是「收到几个请求」精确等于「退避循环尝试了几次」。
private final class CountingRefusingPeer: @unchecked Sendable {
    enum PeerError: Error { case socketFailed, bindFailed }

    private let listenFD: Int32
    private let boundPort: UInt16
    private let lock = NSLock()
    private var requestCount = 0
    private var stopped = false

    var port: UInt16 { boundPort }

    /// 收到的完整 HTTP 请求数
    var requests: Int {
        lock.lock(); defer { lock.unlock() }
        return requestCount
    }

    init() throws {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { throw PeerError.socketFailed }
        var reuse: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))

        // 端口交给内核分配，避免与其它测试的固定端口撞车
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = 0
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        let bound = withUnsafePointer(to: &addr) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bound == 0, listen(fd, 8) == 0 else {
            close(fd)
            throw PeerError.bindFailed
        }

        var actual = sockaddr_in()
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        _ = withUnsafeMutablePointer(to: &actual) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                getsockname(fd, $0, &length)
            }
        }
        self.listenFD = fd
        self.boundPort = UInt16(bigEndian: actual.sin_port)
        startAcceptLoop()
    }

    deinit { stop() }

    private func startAcceptLoop() {
        let thread = Thread { [weak self] in
            guard let self else { return }
            while true {
                let client = accept(self.listenFD, nil, nil)
                if client < 0 {
                    self.lock.lock()
                    let done = self.stopped
                    self.lock.unlock()
                    if done { return }      // stop() 关了 listenFD
                    continue                // 被信号打断，重试
                }
                self.serveOneRequest(on: client)
                close(client)
            }
        }
        thread.name = "CountingRefusingPeer.accept"
        thread.stackSize = 512 * 1024
        thread.start()
    }

    /// 读满一个请求行就计数，然后回 500（可重试状态码）让客户端进入退避。
    private func serveOneRequest(on fd: Int32) {
        var buffer = [UInt8](repeating: 0, count: 2048)
        let readCount = buffer.withUnsafeMutableBytes { raw -> Int in
            guard let base = raw.baseAddress else { return 0 }
            return recv(fd, base, raw.count, 0)
        }
        guard readCount > 0 else { return }
        let text = String(decoding: buffer[0..<readCount], as: UTF8.self)
        // 请求行以 CRLF 结束：读满它才算「一次完整请求」
        guard text.contains("\r\n") else { return }

        lock.lock()
        requestCount += 1
        lock.unlock()

        let response = "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        _ = response.withCString { pointer in
            send(fd, pointer, strlen(pointer), 0)
        }
    }

    /// 轮询等待请求数达到阈值（供测试在「第一次尝试已完成、正处于退避」的时刻取消）
    func waitForRequests(atLeast threshold: Int, timeout: Duration = .seconds(5)) async -> Bool {
        let deadline = ContinuousClock.now.advanced(by: timeout)
        while ContinuousClock.now < deadline {
            if requests >= threshold { return true }
            try? await Task.sleep(for: .milliseconds(20))
        }
        return requests >= threshold
    }

    func stop() {
        lock.lock()
        let already = stopped
        stopped = true
        lock.unlock()
        if !already { close(listenFD) }
    }
}
