import Foundation

public struct SyncResult: Sendable, Equatable {
    public let pushedCount: Int
    public let pulledCount: Int
    public let addedCount: Int
    public let restoredCount: Int

    public init(pushedCount: Int, pulledCount: Int, addedCount: Int, restoredCount: Int) {
        self.pushedCount = pushedCount
        self.pulledCount = pulledCount
        self.addedCount = addedCount
        self.restoredCount = restoredCount
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

    public static func fetchRemoteInfo(target: String) async throws -> RemoteDeviceInfo {
        let parsed = try parseTarget(target)
        guard let url = URL(string: "http://\(parsed.host):\(parsed.port)/api/info") else {
            throw NSError(domain: "SyncClient", code: -4, userInfo: [NSLocalizedDescriptionKey: "无法构建对端 URL"])
        }

        var request = URLRequest(url: url, timeoutInterval: connectTimeout)
        request.httpMethod = "GET"
        request.setValue(parsed.accessCode, forHTTPHeaderField: SyncServer.authHeader)
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            let code = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw NSError(domain: "SyncClient", code: code, userInfo: [NSLocalizedDescriptionKey: "对端设备响应错误 HTTP \(code)"])
        }

        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw NSError(domain: "SyncClient", code: -5, userInfo: [NSLocalizedDescriptionKey: "对端返回了无法解析的 JSON 数据"])
        }

        let name = json["deviceName"] as? String ?? "未知设备"
        let count = json["cardCount"] as? Int ?? 0
        let fav = json["favoriteCount"] as? Int ?? 0
        let ts = json["timestamp"] as? Int64 ?? (json["timestamp"] as? NSNumber)?.int64Value ?? 0

        return RemoteDeviceInfo(deviceName: name, cardCount: count, favoriteCount: fav, timestamp: ts)
    }

    public static func executeBidirectionalSync(
        target: String,
        localCards: [KnowledgeCard],
        onApplyRemoteCards: @Sendable ([KnowledgeCard]) async -> (added: Int, restored: Int, ignored: Int)
    ) async throws -> SyncResult {
        let parsed = try parseTarget(target)

        // 1. 拉取对端卡片
        guard let getUrl = URL(string: "http://\(parsed.host):\(parsed.port)/api/cards") else {
            throw NSError(domain: "SyncClient", code: -4, userInfo: [NSLocalizedDescriptionKey: "无法构建拉取 URL"])
        }

        var getReq = URLRequest(url: getUrl, timeoutInterval: readTimeout)
        getReq.httpMethod = "GET"
        getReq.setValue(parsed.accessCode, forHTTPHeaderField: SyncServer.authHeader)
        getReq.setValue("application/json", forHTTPHeaderField: "Accept")

        let (pulledData, getResp) = try await URLSession.shared.data(for: getReq)
        guard let httpGetResp = getResp as? HTTPURLResponse, (200...299).contains(httpGetResp.statusCode) else {
            let code = (getResp as? HTTPURLResponse)?.statusCode ?? -1
            throw NSError(domain: "SyncClient", code: code, userInfo: [NSLocalizedDescriptionKey: "拉取对端卡片失败 HTTP \(code)"])
        }

        let pulledCards = try CardImportEngine.parseJSON(data: pulledData)

        // 2. 本地应用并合并拉取到的卡片
        let mergeResult = await onApplyRemoteCards(pulledCards)

        // 3. 推送本地卡片到对端
        let localData = try CardExportEngine.exportJSONArchive(cards: localCards)
        guard localData.count <= SyncServer.maxRequestBodyBytes else {
            throw NSError(domain: "SyncClient", code: -6, userInfo: [NSLocalizedDescriptionKey: "本机卡片数据超过 25 MiB 同步上限"])
        }

        var postReq = URLRequest(url: getUrl, timeoutInterval: readTimeout)
        postReq.httpMethod = "POST"
        postReq.setValue(parsed.accessCode, forHTTPHeaderField: SyncServer.authHeader)
        postReq.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        postReq.httpBody = localData

        let (_, postResp) = try await URLSession.shared.data(for: postReq)
        guard let httpPostResp = postResp as? HTTPURLResponse, (200...299).contains(httpPostResp.statusCode) else {
            let code = (postResp as? HTTPURLResponse)?.statusCode ?? -1
            throw NSError(domain: "SyncClient", code: code, userInfo: [NSLocalizedDescriptionKey: "推送卡片至对端失败 HTTP \(code)"])
        }

        return SyncResult(
            pushedCount: localCards.count,
            pulledCount: pulledCards.count,
            addedCount: mergeResult.added,
            restoredCount: mergeResult.restored
        )
    }
}
