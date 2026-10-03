import Foundation

public struct SyncResult: Sendable, Equatable {
    public let pushedCount: Int
    public let pulledCount: Int
    public let addedCount: Int
    public let restoredCount: Int
    /// 对端载荷协议版本（协议 v2 §3）：取自拉取载荷的 `protocolVersion`；nil = v1 旧端。
    public let peerProtocolVersion: Int?

    public init(pushedCount: Int, pulledCount: Int, addedCount: Int, restoredCount: Int, peerProtocolVersion: Int? = nil) {
        self.pushedCount = pushedCount
        self.pulledCount = pulledCount
        self.addedCount = addedCount
        self.restoredCount = restoredCount
        self.peerProtocolVersion = peerProtocolVersion
    }
}

/// 局域网同步客户端 (macOS)。仅允许回环、链路本地和 RFC1918 私有 IPv4 地址。
public enum SyncClient {
    public static let connectTimeout: TimeInterval = 6.0
    public static let readTimeout: TimeInterval = 20.0

    private struct Target: Sendable {
        let host: String
        let port: Int
        let accessCode: String
    }

    private static func parseTarget(_ raw: String) throws -> Target {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.hasPrefix("http://") { value = String(value.dropFirst(7)) }
        if value.hasPrefix("https://") { value = String(value.dropFirst(8)) }
        if value.hasSuffix("/") { value = String(value.dropLast(1)) }

        let parts = value.components(separatedBy: "#")
        let endpoint = parts[0].components(separatedBy: "/")[0]
        let accessCode = parts.count > 1 ? parts[1].trimmingCharacters(in: .whitespaces) : ""

        guard accessCode.range(of: #"^\d{6}$"#, options: .regularExpression) != nil else {
            throw NSError(domain: "SyncClient", code: -1, userInfo: [NSLocalizedDescriptionKey: "同步地址缺少有效的 6 位配对码"])
        }

        let hostParts = endpoint.components(separatedBy: ":")
        let host = hostParts[0].trimmingCharacters(in: .whitespaces)
        let port = hostParts.count > 1 ? (Int(hostParts[1]) ?? 8998) : 8998

        guard !host.isEmpty, (1...65535).contains(port) else {
            throw NSError(domain: "SyncClient", code: -2, userInfo: [NSLocalizedDescriptionKey: "同步地址或端口无效"])
        }

        // 安全检查：仅允许私有局域网 IPv4 地址或 localhost
        guard isPrivateLanAddress(host) else {
            throw NSError(domain: "SyncClient", code: -3, userInfo: [NSLocalizedDescriptionKey: "只允许连接本机或私有局域网 IPv4 地址"])
        }

        return Target(host: host, port: port, accessCode: accessCode)
    }

    private static func isPrivateLanAddress(_ host: String) -> Bool {
        if host == "localhost" || host == "127.0.0.1" || host == "::1" { return true }
        if host.hasPrefix("192.168.") || host.hasPrefix("10.") { return true }
        if host.hasPrefix("172.") {
            let parts = host.split(separator: ".")
            if parts.count >= 2, let second = Int(parts[1]), (16...31).contains(second) {
                return true
            }
        }
        return false
    }

    /// 带抖动的指数退避网络请求（最多 3 次尝试：初始 + 2 次重试）
    private static func performRequestWithRetry(
        _ request: URLRequest,
        maxAttempts: Int = 3
    ) async throws -> (Data, HTTPURLResponse) {
        var lastError: Error?
        for attempt in 1...maxAttempts {
            // 取消优先于重试：被取消后直接结束，不再走满剩余尝试。退避里的 `Task.sleep` 已经会抛
            // CancellationError，这里再查一次是为了覆盖「两次尝试之间被取消」的空隙。
            try Task.checkCancellation()
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                guard let httpResponse = response as? HTTPURLResponse else {
                    throw NSError(domain: "SyncClient", code: -7, userInfo: [NSLocalizedDescriptionKey: "对端响应格式异常"])
                }
                if httpResponse.statusCode == 401 {
                    throw NSError(domain: "SyncClient", code: 401, userInfo: [NSLocalizedDescriptionKey: "配对码错误，请核对 6 位数字配对码是否与对端一致"])
                }
                if httpResponse.statusCode == 413 {
                    throw NSError(domain: "SyncClient", code: 413, userInfo: [NSLocalizedDescriptionKey: "卡片数据超过 25 MiB 同步上限"])
                }
                if (200...299).contains(httpResponse.statusCode) {
                    return (data, httpResponse)
                }
                if httpResponse.statusCode == 503 || httpResponse.statusCode == 502 {
                    throw NSError(domain: "SyncClient", code: httpResponse.statusCode, userInfo: [NSLocalizedDescriptionKey: "对端设备暂时繁忙 (HTTP \(httpResponse.statusCode))"])
                }
                throw NSError(domain: "SyncClient", code: httpResponse.statusCode, userInfo: [NSLocalizedDescriptionKey: "对端设备响应错误 HTTP \(httpResponse.statusCode)"])
            } catch is CancellationError {
                // 取消不是「可重试的失败」。落进下面的通用 catch 时，循环会空转剩余尝试
                // （各带一次退避 sleep），最后把 `URLError.cancelled` 包成一条
                // 「局域网通信失败: cancelled」抛给用户——用户看到的是网络故障，而实际是他自己取消的。
                throw CancellationError()
            } catch {
                if let nsErr = error as NSError?, nsErr.domain == "SyncClient" && (nsErr.code == 401 || nsErr.code == 413 || nsErr.code == -1 || nsErr.code == -2 || nsErr.code == -3) {
                    throw error
                }
                lastError = error
                if attempt < maxAttempts {
                    let baseDelay = 0.5 * Double(1 << (attempt - 1))
                    let jitter = Double.random(in: 0...0.1)
                    // 不加 `try?`：Task.sleep 在取消时抛 CancellationError，必须让它向上传播
                    // （同仓库 AIService.swift / SpeechSynthesizerService.swift 已是这个写法）
                    try await Task.sleep(nanoseconds: UInt64((baseDelay + jitter) * 1_000_000_000))
                }
            }
        }

        if let err = lastError as? URLError {
            switch err.code {
            case .timedOut:
                throw NSError(domain: "SyncClient", code: -1001, userInfo: [NSLocalizedDescriptionKey: "连接对端超时，请检查两端是否在同一 Wi-Fi 或检查局域网防火墙配置"])
            case .cannotConnectToHost, .networkConnectionLost, .notConnectedToInternet:
                throw NSError(domain: "SyncClient", code: -1004, userInfo: [NSLocalizedDescriptionKey: "无法连接到对端设备，请确认对端已开启「接收服务」且两端连接至同一 Wi-Fi"])
            default:
                throw NSError(domain: "SyncClient", code: err.errorCode, userInfo: [NSLocalizedDescriptionKey: "局域网通信失败: \(err.localizedDescription)"])
            }
        }
        throw lastError ?? NSError(domain: "SyncClient", code: -1, userInfo: [NSLocalizedDescriptionKey: "同步请求失败"])
    }

    public static func fetchRemoteInfo(target: String) async throws -> RemoteDeviceInfo {
        let parsed = try parseTarget(target)
        guard let url = URL(string: "http://\(parsed.host):\(parsed.port)/api/info") else {
            throw NSError(domain: "SyncClient", code: -4, userInfo: [NSLocalizedDescriptionKey: "无法构建对端 URL"])
        }

        var request = URLRequest(url: url, timeoutInterval: connectTimeout)
        request.httpMethod = "GET"
        request.setValue(parsed.accessCode, forHTTPHeaderField: SyncServer.authHeader)
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, _) = try await performRequestWithRetry(request)

        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw NSError(domain: "SyncClient", code: -5, userInfo: [NSLocalizedDescriptionKey: "对端返回了无法解析的 JSON 数据"])
        }

        // 协议 v2 §2：解析对端版本；缺字段（v1 旧端）→ nil，由 UI 提示且不阻断
        return RemoteDeviceInfo.parseInfo(json)
    }

    /// 双向增量同步：拉取对端载荷 → 本地合并 → **取合并后的最新快照**推送对端（协议 §3/§4）。
    ///
    /// - `currentCards` / `currentTombstones`：合并回调完成后再取值——合并可能新增/更新/删除
    ///   本地卡片（对端墓碑），推送合并前的旧快照会把刚拉到的卡片重复推回，也会漏掉本地墓碑表。
    /// - 推送载荷 = 合并后卡片 + 本地墓碑表（信封，协议 §3）。
    public static func executeBidirectionalSync(
        target: String,
        currentCards: @Sendable () async -> [KnowledgeCard],
        currentTombstones: @Sendable () async -> [SyncTombstone],
        onApplyRemoteCards: @Sendable ([KnowledgeCard], [SyncTombstone]) async -> (added: Int, restored: Int, ignored: Int, deleted: Int)
    ) async throws -> SyncResult {
        let parsed = try parseTarget(target)

        // 1. 拉取对端卡片（带重试与退避）
        guard let getUrl = URL(string: "http://\(parsed.host):\(parsed.port)/api/cards") else {
            throw NSError(domain: "SyncClient", code: -4, userInfo: [NSLocalizedDescriptionKey: "无法构建拉取 URL"])
        }

        var getReq = URLRequest(url: getUrl, timeoutInterval: readTimeout)
        getReq.httpMethod = "GET"
        getReq.setValue(parsed.accessCode, forHTTPHeaderField: SyncServer.authHeader)
        getReq.setValue("application/json", forHTTPHeaderField: "Accept")

        let (pulledData, _) = try await performRequestWithRetry(getReq)
        let pulled = try CardImportEngine.parseJSON(data: pulledData)

        // 2. 本地应用对端载荷（卡片 + 墓碑，协议 §4 对称合并）
        let mergeResult = await onApplyRemoteCards(pulled.cards, pulled.tombstones)

        // 3. 合并完成后再取最新状态推送（带重试与退避）
        let snapshot = await currentCards()
        let localTombstones = await currentTombstones()
        let localData = try CardExportEngine.exportJSONArchive(cards: snapshot, tombstones: localTombstones)
        guard localData.count <= SyncServer.maxRequestBodyBytes else {
            throw NSError(domain: "SyncClient", code: -6, userInfo: [NSLocalizedDescriptionKey: "本机卡片数据超过 25 MiB 同步上限"])
        }

        var postReq = URLRequest(url: getUrl, timeoutInterval: readTimeout)
        postReq.httpMethod = "POST"
        postReq.setValue(parsed.accessCode, forHTTPHeaderField: SyncServer.authHeader)
        postReq.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        postReq.httpBody = localData

        _ = try await performRequestWithRetry(postReq)

        return SyncResult(
            pushedCount: snapshot.count,
            pulledCount: pulled.cards.count,
            addedCount: mergeResult.added,
            restoredCount: mergeResult.restored,
            peerProtocolVersion: pulled.protocolVersion
        )
    }
}
