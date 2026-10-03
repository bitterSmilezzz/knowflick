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
            getTombstones: { [] },
            onReceiveCards: { _, _ in (added: 0, restored: 0, ignored: 0, deleted: 0) }
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
            getTombstones: { [] },
            onReceiveCards: { _, _ in (added: 0, restored: 0, ignored: 0, deleted: 0) }
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

    // MARK: - Wave B B1：/api/info 协议版本握手（协议 v2 §2）

    /// 服务端 /api/info 必须携带 protocolVersion=2，客户端解析出对端版本。
    @Test("B1 /api/info 返回 protocolVersion=2 且客户端解析出对端版本")
    func infoEndpointCarriesProtocolVersion() async throws {
        let serverCard = createTestCard(headline: "版本握手")
        let server = SyncServer(
            accessCode: "334455",
            getCards: { [serverCard] },
            getTombstones: { [] },
            onReceiveCards: { _, _ in (added: 0, restored: 0, ignored: 0, deleted: 0) }
        )
        let startRes = server.start(preferredPort: 19011)
        guard case .success(let port) = startRes else {
            Issue.record("Server start failed")
            return
        }
        defer { server.stop() }

        let info = try await SyncClient.fetchRemoteInfo(target: "127.0.0.1:\(port)#334455")
        #expect(info.protocolVersion == SyncProtocol.currentVersion)
    }

    /// 缺 `protocolVersion` 字段 = v1 旧端 → 解析为 nil（UI 提示「建议两端升级」，不阻断）；
    /// 高于本端支持版本的值如实透出（UI 提示「对端版本更新」，同样不阻断）。
    @Test("B1 缺 protocolVersion 字段按旧端解析（nil），更高版本如实透出")
    func infoVersionParsingTreatsMissingFieldAsLegacyPeer() {
        let legacy = RemoteDeviceInfo.parseInfo([
            "deviceName": "旧端设备", "cardCount": 3, "favoriteCount": 1, "timestamp": 1_727_900_000_000
        ])
        #expect(legacy.protocolVersion == nil)
        #expect(legacy.deviceName == "旧端设备")
        #expect(legacy.cardCount == 3)

        let newer = RemoteDeviceInfo.parseInfo([
            "deviceName": "新端设备", "cardCount": 3, "favoriteCount": 1, "timestamp": 1_727_900_000_000,
            "protocolVersion": SyncProtocol.currentVersion + 1
        ])
        #expect(newer.protocolVersion == SyncProtocol.currentVersion + 1)
    }

    @Test func syncClientBidirectionalSync() async throws {
        let serverCard = createTestCard(headline: "中子星")
        let clientCard = createTestCard(headline: "黑洞")

        let receivedBox = ReceivedBox()

        let server = SyncServer(
            accessCode: "888999",
            getCards: { [serverCard] },
            getTombstones: { [] },
            onReceiveCards: { incoming, _ in
                receivedBox.set(incoming)
                return (added: incoming.count, restored: 0, ignored: 0, deleted: 0)
            }
        )

        let startRes = server.start(preferredPort: 19001)
        guard case .success(let port) = startRes else {
            Issue.record("Server start failed")
            return
        }
        defer { server.stop() }

        // 客户端本地状态：合并回调把拉到的卡片并入本地，currentCards 返回合并后的最新快照
        let localState = ServerSyncState(cards: [clientCard])

        let target = "127.0.0.1:\(port)#888999"
        let result = try await SyncClient.executeBidirectionalSync(
            target: target,
            currentCards: { await localState.cards },
            currentTombstones: { await localState.tombstones }
        ) { incoming, tombstones in
            #expect(incoming.count == 1)
            #expect(incoming[0].headline == "中子星")
            #expect(tombstones.isEmpty)
            return await localState.apply(incoming, tombstones)
        }

        #expect(result.pushedCount == 2, "推送计数必须是合并后快照（黑洞 + 刚拉到的中子星）")
        #expect(result.pulledCount == 1)
        #expect(result.addedCount == 1)
        #expect(result.peerProtocolVersion == SyncProtocol.currentVersion, "对端 GET 载荷是 v2 信封")

        // 验证服务端收到的是合并后快照：clientCard + 刚拉到的 serverCard（修复前只推送合并前的
        // localCards 快照，刚拉到的中子星会被重复推回对端一次）
        let received = receivedBox.get()
        #expect(received.count == 2)
        #expect(Set(received.map(\.headline)) == ["黑洞", "中子星"])
    }

    /// 推送载荷必须携带本地墓碑表（协议 §3）：本地已删除的卡片不再推给对端，
    /// 删除记录以墓碑形式广播，防止对端把已删卡片再推回来。
    @Test("B5 推送载荷携带合并后快照与本地墓碑表")
    func syncClientPushIncludesPostMergeSnapshotAndTombstones() async throws {
        let deletedCardId = UUID()
        let deletedCard = KnowledgeCard(
            id: deletedCardId, category: "冷知识", headline: "本地已删卡", summary: "摘要", details: "正文",
            source: .seed, createdAt: Date(timeIntervalSince1970: 1_727_900_000)
        )
        let tombstone = SyncTombstone(id: deletedCardId.uuidString, deletedAt: 1_727_900_001_000)
        let survivor = KnowledgeCard(
            category: "冷知识", headline: "幸存卡", summary: "摘要", details: "正文",
            source: .seed, createdAt: Date(timeIntervalSince1970: 1_727_900_000)
        )

        // 服务端状态：曾删除过 deletedCard（墓碑 {X,t}），当前只有幸存卡
        let serverState = ServerSyncState(cards: [survivor], tombstones: [tombstone])

        let server = SyncServer(
            accessCode: "556677",
            getCards: { await serverState.cards },
            getTombstones: { await serverState.tombstones },
            onReceiveCards: { incoming, tombstones in
                await serverState.apply(incoming, tombstones)
            }
        )
        let startRes = server.start(preferredPort: 19015)
        guard case .success(let port) = startRes else {
            Issue.record("Server start failed")
            return
        }
        defer { server.stop() }

        // 客户端本地状态：同样删除过该卡（对称墓碑），只剩幸存卡
        let localState = ServerSyncState(cards: [survivor], tombstones: [tombstone])

        let result = try await SyncClient.executeBidirectionalSync(
            target: "127.0.0.1:\(port)#556677",
            currentCards: { await localState.cards },
            currentTombstones: { await localState.tombstones }
        ) { incoming, incomingTombstones in
            await localState.apply(incoming, incomingTombstones)
        }

        // 服务端终态：无新增（幸存卡已存在、墓碑对称），本地墓碑表仍在
        #expect(result.pushedCount == 1)
        #expect(await serverState.cards.map(\.headline) == ["幸存卡"])
        #expect(await serverState.tombstones == [tombstone])
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
            getTombstones: { [] },
            onReceiveCards: { _, _ in (added: 0, restored: 0, ignored: 0, deleted: 0) }
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

    // MARK: - Wave A：响应写全量 + SIGPIPE 防护

    /// 大响应体必须完整送达：全库导出（上限 25MiB）远超 socket 发送缓冲，单次 write 遇上
    /// 对端读得慢 / SO_SNDTIMEO / EINTR 都可能只写出一部分，客户端会拿到 Content-Length
    /// 对不上的截断 JSON。这里用 ~1MB 级卡片库走回环，按 Content-Length 逐字节核对。
    @Test func syncServerDeliversFullBodyForLargeLibrary() async throws {
        let cards = (0..<200).map { i in
            KnowledgeCard(
                category: "物理",
                headline: "大库卡\(i)",
                summary: "摘要\(i)",
                details: String(repeating: "这段说明用于撑大同步响应体以覆盖部分写路径。", count: 100),
                source: .seed,
                createdAt: Date(timeIntervalSince1970: 1_000_000)
            )
        }
        let server = SyncServer(
            accessCode: "135790",
            getCards: { cards },
            getTombstones: { [] },
            onReceiveCards: { _, _ in (added: 0, restored: 0, ignored: 0, deleted: 0) }
        )
        let startRes = server.start(preferredPort: 19107)
        guard case .success(let port) = startRes else {
            Issue.record("Server start failed")
            return
        }
        defer { server.stop() }

        let peer = try RawLoopbackPeer(port: UInt16(port))
        let response = try peer.request(
            "GET /api/cards HTTP/1.1\r\nHost: 127.0.0.1\r\n\(SyncServer.authHeader): 135790\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
        )

        guard let headerEnd = response.range(of: Data("\r\n\r\n".utf8)) else {
            Issue.record("响应缺少头部结束标记")
            return
        }
        let headerText = String(decoding: response[..<headerEnd.lowerBound], as: UTF8.self)
        guard let lengthLine = headerText.split(separator: "\r\n").first(where: { $0.lowercased().hasPrefix("content-length:") }),
              let declaredBytes = Int(lengthLine.split(separator: ":")[1].trimmingCharacters(in: .whitespaces)) else {
            Issue.record("响应头部缺少 Content-Length: \(headerText)")
            return
        }
        let body = response.subdata(in: headerEnd.upperBound..<response.count)
        #expect(body.count == declaredBytes, "实际收到 \(body.count) 字节，头部声明 \(declaredBytes) 字节")
        // 协议 v2 §3：GET 响应为信封（cards 与请求前的卡库逐张一致，tombstones 为空表预留）
        let payload = try CardImportEngine.parseJSON(data: body)
        #expect(payload.protocolVersion == SyncProtocol.currentVersion)
        #expect(payload.tombstones.isEmpty)
        #expect(payload.cards.count == 200)
        #expect(payload.cards.map(\.headline) == cards.map(\.headline))
    }

    /// 对端提前断开：客户端发完请求立即 close，服务端向已断开的连接写响应不得崩溃
    /// （无 SO_NOSIGPIPE 防护时 SIGPIPE 的默认动作是杀掉整个进程），且后续新连接仍能正常服务。
    /// 用大响应体让「写响应」持续进行：对端的 RST 必然落在写入中途，EPIPE 无处可躲。
    @Test func syncServerSurvivesPeerClosingEarly() async throws {
        let cards = (0..<200).map { i in
            KnowledgeCard(
                category: "物理",
                headline: "大库卡\(i)",
                summary: "摘要\(i)",
                details: String(repeating: "这段说明用于撑大同步响应体以覆盖部分写路径。", count: 100),
                source: .seed,
                createdAt: Date(timeIntervalSince1970: 1_000_000)
            )
        }
        let server = SyncServer(
            accessCode: "246810",
            getCards: { cards },
            getTombstones: { [] },
            onReceiveCards: { _, _ in (added: 0, restored: 0, ignored: 0, deleted: 0) }
        )
        let startRes = server.start(preferredPort: 19109)
        guard case .success(let port) = startRes else {
            Issue.record("Server start failed")
            return
        }
        defer { server.stop() }

        // 发完请求立即断开（响应一字节都不读）。多次连接抬高「写响应时对端已断开」的确定性。
        for _ in 0..<3 {
            let peer = try RawLoopbackPeer(port: UInt16(port))
            try peer.sendAndClose(
                "GET /api/cards HTTP/1.1\r\nHost: 127.0.0.1\r\n\(SyncServer.authHeader): 246810\r\n\r\n"
            )
            try await Task.sleep(for: .milliseconds(100))
        }

        // 进程未死、监听未坏：新连接照常完整走一次请求-响应
        let info = try await SyncClient.fetchRemoteInfo(target: "127.0.0.1:\(port)#246810")
        #expect(info.cardCount == 200)
        #expect(info.deviceName.isEmpty == false)
    }

    // MARK: - Wave B B3：服务端墓碑语义（协议 §4）

    /// 端到端：POST 载荷携带墓碑 → 服务端按规则 1 删除本地卡、响应上报 "deleted":1，
    /// 之后 GET 载荷带出更新后的本地墓碑表。
    @Test("B3 POST 墓碑删卡并上报 deleted，GET 带出本地墓碑表")
    func syncServerAppliesPeerTombstones() async throws {
        let cardId = UUID()
        let card = KnowledgeCard(
            id: cardId, category: "冷知识", headline: "待删卡", summary: "摘要", details: "正文",
            source: .seed, createdAt: Date(timeIntervalSince1970: 1_727_900_000)
        )
        let tombstone = SyncTombstone(id: cardId.uuidString, deletedAt: 1_727_900_001_000)
        let state = ServerSyncState(cards: [card])

        let server = SyncServer(
            accessCode: "778899",
            getCards: { await state.cards },
            getTombstones: { await state.tombstones },
            onReceiveCards: { incoming, tombstones in
                await state.apply(incoming, tombstones)
            }
        )
        let startRes = server.start(preferredPort: 19013)
        guard case .success(let port) = startRes else {
            Issue.record("Server start failed")
            return
        }
        defer { server.stop() }

        // POST 信封：无卡片、带墓碑
        let body = try CardExportEngine.exportJSONArchive(cards: [], tombstones: [tombstone])
        let peer = try RawLoopbackPeer(port: UInt16(port))
        let response = try peer.request(
            "POST /api/cards HTTP/1.1\r\nHost: 127.0.0.1\r\n\(SyncServer.authHeader): 778899\r\n"
                + "Content-Type: application/json; charset=utf-8\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
                + String(decoding: body, as: UTF8.self)
        )
        guard let headerEnd = response.range(of: Data("\r\n\r\n".utf8)) else {
            Issue.record("响应缺少头部结束标记")
            return
        }
        let postResult = try #require(JSONSerialization.jsonObject(with: response.subdata(in: headerEnd.upperBound..<response.count)) as? [String: Any])
        #expect(postResult["status"] as? String == "success")
        #expect(postResult["deleted"] as? Int == 1, "POST 响应必须上报规则 1 实际删除的本地卡数")
        #expect(postResult["total"] as? Int == 0)

        // GET 载荷：卡片已删、本地墓碑表带出墓碑
        let getResponse = try RawLoopbackPeer(port: UInt16(port)).request(
            "GET /api/cards HTTP/1.1\r\nHost: 127.0.0.1\r\n\(SyncServer.authHeader): 778899\r\nConnection: close\r\n\r\n"
        )
        guard let getHeaderEnd = getResponse.range(of: Data("\r\n\r\n".utf8)) else {
            Issue.record("GET 响应缺少头部结束标记")
            return
        }
        let payload = try CardImportEngine.parseJSON(data: getResponse.subdata(in: getHeaderEnd.upperBound..<getResponse.count))
        #expect(payload.cards.isEmpty)
        #expect(payload.tombstones == [tombstone])
    }

    // MARK: - Wave B B6：配对码防枚举

    /// 60s 滑动窗口内第 5 次鉴权失败触发 30s 限速（第 6 次起直接 429，正确码也被限速），
    /// 窗口过期后恢复：正确码放行、错误码回到 401。时钟注入使「窗口过期」无需真等 30s。
    @Test("B6 第 5 次配对码失败后触发限速，窗口过期恢复")
    func authThrottleTriggersAfterFifthFailureAndRecoversAfterWindow() async throws {
        let clock = MutableClock(startMs: 1_727_900_000_000)
        let server = SyncServer(
            accessCode: "246813",
            getCards: { [] },
            getTombstones: { [] },
            onReceiveCards: { _, _ in (added: 0, restored: 0, ignored: 0, deleted: 0) },
            now: { clock.nowMs() }
        )
        let startRes = server.start(preferredPort: 19017)
        guard case .success(let port) = startRes else {
            Issue.record("Server start failed")
            return
        }
        defer { server.stop() }

        func status(for authValue: String) throws -> Int {
            let response = try RawLoopbackPeer(port: UInt16(port)).request(
                "GET /api/info HTTP/1.1\r\nHost: 127.0.0.1\r\n\(SyncServer.authHeader): \(authValue)\r\nConnection: close\r\n\r\n"
            )
            let statusLine = String(decoding: response.prefix(while: { $0 != UInt8(ascii: "\r") }), as: UTF8.self)
            let parts = statusLine.split(separator: " ")
            return Int(parts.count > 1 ? parts[1] : "0") ?? 0
        }

        // 前 4 次失败 → 401
        for _ in 0..<4 {
            #expect(try status(for: "000000") == 401)
        }
        // 第 5 次失败触发限速（本次仍是 401），后续请求直接 429——正确码也被限速
        #expect(try status(for: "000000") == 401)
        #expect(try status(for: "000000") == 429, "第 6 次请求必须命中限速")
        #expect(try status(for: "246813") == 429, "限速期内正确码同样被限速（不泄露码正确性）")

        // 窗口过期（推进 31s）→ 恢复：正确码放行、错误码回到 401
        clock.advance(byMs: 31_000)
        #expect(try status(for: "246813") == 200, "限速窗口过期后必须恢复服务")
        #expect(try status(for: "000000") == 401, "过期后错误码回到普通 401")
    }

    /// 配对码比较语义：常量时间实现的正确性契约（相等/不等/长度不等/空串）。
    @Test("B6 配对码常量时间比较结果正确")
    func pairingCodeConstantTimeComparisonIsExact() {
        #expect(SyncServer.constantTimeEquals("123456", "123456"))
        #expect(!SyncServer.constantTimeEquals("123456", "123457"), "末位差异必须判不等")
        #expect(!SyncServer.constantTimeEquals("123456", "1234567"), "长度不同必须判不等")
        #expect(!SyncServer.constantTimeEquals("", "123456"))
        #expect(SyncServer.constantTimeEquals("", ""))
        // 首位差异与末位差异结果一致（时序上不可区分是常量时间实现的前提）
        #expect(!SyncServer.constantTimeEquals("923456", "123456"))
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

/// 可手动推进的毫秒时钟（B6 限速窗口测试用）：免真等 30s 验证「窗口过期恢复」。
private final class MutableClock: @unchecked Sendable {
    private let lock = NSLock()
    private var currentMs: Int64

    init(startMs: Int64) {
        currentMs = startMs
    }

    func nowMs() -> Int64 {
        lock.lock(); defer { lock.unlock() }
        return currentMs
    }

    func advance(byMs: Int64) {
        lock.lock(); defer { lock.unlock() }
        currentMs += byMs
    }
}

/// 服务端同步状态（测试用）：按协议 §4 对称语义合并对端载荷，供端到端墓碑测试驱动。
private actor ServerSyncState {
    private(set) var cards: [KnowledgeCard]
    private(set) var tombstones: [SyncTombstone]

    init(cards: [KnowledgeCard], tombstones: [SyncTombstone] = []) {
        self.cards = cards
        self.tombstones = tombstones
    }

    func apply(_ incoming: [KnowledgeCard], _ incomingTombstones: [SyncTombstone]) -> (added: Int, restored: Int, ignored: Int, deleted: Int) {
        let outcome = CardImportEngine.mergeSyncPayload(
            existing: cards,
            localTombstones: tombstones,
            incomingCards: incoming,
            incomingTombstones: incomingTombstones
        )
        cards = outcome.cards
        tombstones = outcome.tombstones
        return (outcome.added, outcome.updated, outcome.ignored, outcome.deleted)
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

/// 最小回环对端：直连 SyncServer 监听端口收发原始 HTTP 字节。
/// 不走 URLSession——这里要控制「发完立即 close」「读满到对端关连接」这类传输层行为。
private struct RawLoopbackPeer {
    let fd: Int32

    init(port: UInt16) throws {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else {
            throw NSError(domain: "RawLoopbackPeer", code: -1, userInfo: [NSLocalizedDescriptionKey: "socket 创建失败"])
        }
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        let connected = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                Darwin.connect(fd, sockPtr, socklen_t(MemoryLayout<sockaddr_in>.stride))
            }
        }
        guard connected == 0 else {
            Darwin.close(fd)
            throw NSError(domain: "RawLoopbackPeer", code: -2, userInfo: [NSLocalizedDescriptionKey: "连接 SyncServer 失败"])
        }
        // 读超时保护：服务端异常时测试挂死不如直接失败
        var tv = timeval(tv_sec: 10, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        self.fd = fd
    }

    /// 发送请求并读满响应直到对端关连接（服务端响应固定带 Connection: close）
    func request(_ text: String) throws -> Data {
        try send(text)
        defer { Darwin.close(fd) }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            let n = buffer.withUnsafeMutableBytes { raw in
                Darwin.read(fd, raw.baseAddress, raw.count)
            }
            guard n > 0 else { break }
            data.append(buffer, count: n)
        }
        return data
    }

    /// 发完请求立即断开（一个字节的响应都不读）：复现「对端提前断开」
    func sendAndClose(_ text: String) throws {
        try send(text)
        Darwin.close(fd)
    }

    private func send(_ text: String) throws {
        let bytes = [UInt8](text.utf8)
        var offset = 0
        while offset < bytes.count {
            let written = bytes.withUnsafeBytes { raw in
                Darwin.write(fd, raw.baseAddress!.advanced(by: offset), bytes.count - offset)
            }
            guard written > 0 else {
                throw NSError(domain: "RawLoopbackPeer", code: -3, userInfo: [NSLocalizedDescriptionKey: "请求发送失败"])
            }
            offset += written
        }
    }
}
