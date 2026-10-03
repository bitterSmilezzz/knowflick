import Foundation
import Darwin

public struct RemoteDeviceInfo: Sendable, Equatable {
    public let deviceName: String
    public let cardCount: Int
    public let favoriteCount: Int
    public let timestamp: Int64
    /// 对端协议版本（/api/info 的 `protocolVersion`）。
    /// `nil` = 缺字段 = v1 旧端（协议 §2：提示「建议两端升级」，不阻断同步）。
    public let protocolVersion: Int?

    public init(deviceName: String, cardCount: Int, favoriteCount: Int, timestamp: Int64, protocolVersion: Int? = nil) {
        self.deviceName = deviceName
        self.cardCount = cardCount
        self.favoriteCount = favoriteCount
        self.timestamp = timestamp
        self.protocolVersion = protocolVersion
    }

    /// /api/info 响应解析：缺 `protocolVersion` 字段的旧端解析为 nil。
    /// 单独成函数以便对「缺字段=旧端」的契约做无网络单测。
    static func parseInfo(_ json: [String: Any]) -> RemoteDeviceInfo {
        RemoteDeviceInfo(
            deviceName: json["deviceName"] as? String ?? "未知设备",
            cardCount: json["cardCount"] as? Int ?? 0,
            favoriteCount: json["favoriteCount"] as? Int ?? 0,
            timestamp: (json["timestamp"] as? NSNumber)?.int64Value ?? 0,
            protocolVersion: json["protocolVersion"] as? Int
        )
    }
}

/// 局域网轻量极速同步服务端 (LAN P2P Sync Server - macOS)
///
/// 基于原生 BSD Socket 构建，0 外部网络依赖，
/// 提供局域网端对端卡片数据拉取、推送与增量双向合并，与 Android 端 100% 互通。
public final class SyncServer: @unchecked Sendable {
    public static let authHeader = "X-KnowFlick-Token"
    public static let maxRequestBodyBytes = 25 * 1024 * 1024
    private static let maxHeaderLineBytes = 8 * 1024
    private static let maxHeaderCount = 64

    private let lock = NSLock()
    private var serverFd: Int32 = -1
    private var acceptThread: Thread?

    public private(set) var isRunning: Bool = false
    public private(set) var boundPort: Int = 8998

    private let accessCode: String
    private let getCards: @Sendable () async -> [KnowledgeCard]
    /// 本地墓碑表来源（协议 v2 §3）：GET 载荷的 tombstones 字段由此取值
    private let getTombstones: @Sendable () async -> [SyncTombstone]
    /// 合并入口（协议 v2 §4）：对端卡片 + 墓碑一并交给合并方；
    /// `deleted` 仅统计「收到墓碑 → 实际删除本地卡片」的数量，随 POST 响应 `"deleted":n` 上报
    private let onReceiveCards: @Sendable ([KnowledgeCard], [SyncTombstone]) async -> (added: Int, restored: Int, ignored: Int, deleted: Int)
    /// 401 失败滑动窗口（B6 配对码防枚举）；状态随 server 生命周期，start() 重置
    private let authWindow: AuthFailureWindow

    // MARK: - B6 配对码防枚举

    /// 401 失败滑动窗口：60s 内第 5 次鉴权失败起，后续 30s 内所有请求直接 429
    /// （配对码仅 6 位数字，不设防可被局域网攻击者在握手超时内穷举）。
    /// 锁保护：handleClient 跑在并发的 Task 上。
    private final class AuthFailureWindow: @unchecked Sendable {
        static let windowMs: Int64 = 60_000
        static let threshold = 5
        static let throttleMs: Int64 = 30_000

        enum Verdict { case allow, throttled }

        private let lock = NSLock()
        private var failureTimestamps: [Int64] = []
        private var throttledUntil: Int64 = 0
        private let now: @Sendable () -> Int64

        init(now: @escaping @Sendable () -> Int64) {
            self.now = now
        }

        /// 鉴权前判定：限速激活期间直接 429——**不再比对配对码**，
        /// 否则攻击者可用正确码在限速期探测出「码已猜中」。
        func verdict() -> Verdict {
            lock.lock(); defer { lock.unlock() }
            return now() < throttledUntil ? .throttled : .allow
        }

        /// 记录一次鉴权失败；窗口内失败数达到阈值即武装 30s 限速。
        func recordFailure() {
            lock.lock(); defer { lock.unlock() }
            let current = now()
            failureTimestamps.append(current)
            failureTimestamps = failureTimestamps.filter { current - $0 < Self.windowMs }
            if failureTimestamps.count >= Self.threshold {
                throttledUntil = current + Self.throttleMs
            }
        }

        /// 状态随 server 生命周期：重新 start 时清空（换配对码后旧窗口不应残留）
        func reset() {
            lock.lock(); defer { lock.unlock() }
            failureTimestamps = []
            throttledUntil = 0
        }
    }

    /// 常量时间字符串比较（B6）：比较耗时只取决于输入长度，与是否相等无关，
    /// 不给「逐位逼近配对码」的时序侧信道。长度差异也参与累积，不提前返回。
    static func constantTimeEquals(_ lhs: String, _ rhs: String) -> Bool {
        let left = Array(lhs.utf8)
        let right = Array(rhs.utf8)
        var difference = UInt8(left.count == right.count ? 0 : 1)
        for index in 0..<max(left.count, right.count) {
            let leftByte = index < left.count ? left[index] : 0
            let rightByte = index < right.count ? right[index] : 0
            difference |= leftByte ^ rightByte
        }
        return difference == 0
    }

    public init(
        accessCode: String,
        getCards: @escaping @Sendable () async -> [KnowledgeCard],
        getTombstones: @escaping @Sendable () async -> [SyncTombstone],
        onReceiveCards: @escaping @Sendable ([KnowledgeCard], [SyncTombstone]) async -> (added: Int, restored: Int, ignored: Int, deleted: Int),
        now: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.accessCode = accessCode
        self.getCards = getCards
        self.getTombstones = getTombstones
        self.onReceiveCards = onReceiveCards
        self.authWindow = AuthFailureWindow(now: now)
    }

    public func start(preferredPort: Int = 8998) -> Result<Int, Error> {
        lock.lock()
        defer { lock.unlock() }

        if isRunning { return .success(boundPort) }

        var port = preferredPort
        var boundFd: Int32 = -1
        var attempts = 0

        while attempts < 5 && boundFd < 0 {
            let fd = socket(AF_INET, SOCK_STREAM, 0)
            if fd >= 0 {
                var yes: Int32 = 1
                setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))

                var addr = sockaddr_in()
                addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.stride)
                addr.sin_family = sa_family_t(AF_INET)
                addr.sin_port = in_port_t(UInt16(port).bigEndian)
                addr.sin_addr.s_addr = in_addr_t(0) // INADDR_ANY

                let bindResult = withUnsafePointer(to: &addr) { ptr in
                    ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                        Darwin.bind(fd, sockPtr, socklen_t(MemoryLayout<sockaddr_in>.stride))
                    }
                }

                if bindResult == 0 && Darwin.listen(fd, 8) == 0 {
                    boundFd = fd
                } else {
                    Darwin.close(fd)
                    port += 1
                    attempts += 1
                }
            } else {
                port += 1
                attempts += 1
            }
        }

        guard boundFd >= 0 else {
            return .failure(NSError(domain: "SyncServer", code: -1, userInfo: [NSLocalizedDescriptionKey: "无法在可用端口绑定局域网同步服务"]))
        }

        self.serverFd = boundFd
        self.boundPort = port
        self.isRunning = true
        // B6：限速窗口随 server 生命周期重置
        authWindow.reset()

        let listenFd = boundFd
        let thread = Thread { [weak self] in
            guard let self = self else { return }
            while true {
                var clientAddr = sockaddr_in()
                var clientLen = socklen_t(MemoryLayout<sockaddr_in>.stride)
                let clientFd = withUnsafeMutablePointer(to: &clientAddr) { ptr in
                    ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                        Darwin.accept(listenFd, sockPtr, &clientLen)
                    }
                }

                guard clientFd >= 0 else {
                    break
                }

                Task.detached(priority: .userInitiated) {
                    await self.handleClient(clientFd)
                }
            }
        }
        thread.name = "KnowFlickSyncServerAcceptor"
        self.acceptThread = thread
        thread.start()

        return .success(port)
    }

    public func stop() {
        lock.lock()
        defer { lock.unlock() }

        guard isRunning else { return }
        isRunning = false

        if serverFd >= 0 {
            Darwin.shutdown(serverFd, SHUT_RDWR)
            Darwin.close(serverFd)
            serverFd = -1
        }
        acceptThread = nil
    }

    private func handleClient(_ clientFd: Int32) async {
        defer {
            Darwin.close(clientFd)
        }

        // 本地 socket 默认在向已断开的对端写入时投递 SIGPIPE（默认动作：杀进程）。
        // 对端「发完请求就断开」是网络常态，进程不能因此整个退出——每个连接关掉它，
        // 写失败改由 writeAll 的返回值上报。
        var noSigPipe: Int32 = 1
        setsockopt(clientFd, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe, socklen_t(MemoryLayout<Int32>.size))

        // 设置 10 秒超时
        var tv = timeval(tv_sec: 10, tv_usec: 0)
        setsockopt(clientFd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(clientFd, SOL_SOCKET, SO_SNDTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))

        var readBuffer = Data()
        var headerData = Data()
        var bodyData = Data()

        // 读取 HTTP 头部
        let bufferSize = 4096
        var temp = [UInt8](repeating: 0, count: bufferSize)
        var foundHeaderEnd = false

        while !foundHeaderEnd {
            let n = Darwin.read(clientFd, &temp, bufferSize)
            guard n > 0 else { return }
            readBuffer.append(temp, count: n)

            if let range = readBuffer.range(of: Data("\r\n\r\n".utf8)) {
                headerData = readBuffer.subdata(in: 0..<range.lowerBound)
                bodyData = readBuffer.subdata(in: range.upperBound..<readBuffer.count)
                foundHeaderEnd = true
            } else if readBuffer.count > 16 * 1024 {
                sendResponse(clientFd, code: 431, message: "Request Header Fields Too Large", contentType: "application/json", body: #"{"error":"Header too large"}"#)
                return
            }
        }

        guard let headerString = String(data: headerData, encoding: .utf8) else { return }
        let lines = headerString.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else { return }

        let requestParts = requestLine.split(separator: " ")
        guard requestParts.count >= 2 else { return }
        let method = String(requestParts[0]).uppercased()
        let path = String(requestParts[1].prefix(while: { $0 != "?" }))

        var headers: [String: String] = [:]
        var contentLength = 0
        for line in lines.dropFirst() {
            guard let idx = line.firstIndex(of: ":") else { continue }
            let key = String(line[..<idx]).trimmingCharacters(in: .whitespaces).lowercased()
            let val = String(line[line.index(after: idx)...]).trimmingCharacters(in: .whitespaces)
            headers[key] = val
            if key == "content-length", let len = Int(val) {
                contentLength = len
            }
        }

        // B6 配对码防枚举：限速激活期间直接 429（明确文案），不再比对配对码，
        // 避免攻击者借「正确码在限速期也返回 401→200 突变」探测出码已猜中
        if authWindow.verdict() == .throttled {
            sendResponse(clientFd, code: 429, message: "Too Many Requests", contentType: "application/json", body: #"{"error":"配对码尝试过于频繁，请 30 秒后再试"}"#)
            return
        }

        // 验证 6 位配对码（常量时间比较，防时序侧信道枚举）
        let providedAuth = headers[Self.authHeader.lowercased()]
        if !Self.constantTimeEquals(providedAuth ?? "", accessCode) {
            authWindow.recordFailure()
            sendResponse(clientFd, code: 401, message: "Unauthorized", contentType: "application/json", body: #"{"error":"Invalid pairing code"}"#)
            return
        }

        if contentLength > Self.maxRequestBodyBytes {
            sendResponse(clientFd, code: 413, message: "Payload Too Large", contentType: "application/json", body: #"{"error":"Payload Too Large"}"#)
            return
        }

        // 补充读取剩余 Body
        while bodyData.count < contentLength {
            let needed = min(bufferSize, contentLength - bodyData.count)
            let n = Darwin.read(clientFd, &temp, needed)
            guard n > 0 else { break }
            bodyData.append(temp, count: n)
        }

        switch path {
        case "/api/info":
            if method == "GET" {
                let cards = await getCards()
                let favCount = cards.filter(\.isFavorite).count
                let hostName = Host.current().localizedName ?? "Mac"
                let timestamp = Int64(Date().timeIntervalSince1970 * 1000)

                let jsonDict: [String: Any] = [
                    "deviceName": hostName,
                    "cardCount": cards.count,
                    "favoriteCount": favCount,
                    "timestamp": timestamp,
                    // 协议 v2 §2：版本握手。旧端缺此字段按「建议两端升级」提示，不阻断同步。
                    "protocolVersion": SyncProtocol.currentVersion
                ]
                if let jsonData = try? JSONSerialization.data(withJSONObject: jsonDict),
                   let jsonString = String(data: jsonData, encoding: .utf8) {
                    sendResponse(clientFd, code: 200, message: "OK", contentType: "application/json; charset=utf-8", body: jsonString)
                }
            } else {
                sendResponse(clientFd, code: 405, message: "Method Not Allowed", contentType: "application/json", body: #"{"error":"Method Not Allowed"}"#)
            }

        case "/api/cards":
            if method == "GET" {
                let cards = await getCards()
                let tombstones = await getTombstones()
                // 协议 v2 §3：GET 响应为信封，携带本地墓碑表
                if let jsonString = try? CardExportEngine.exportToJSON(cards: cards, tombstones: tombstones) {
                    sendResponse(clientFd, code: 200, message: "OK", contentType: "application/json; charset=utf-8", body: jsonString)
                } else {
                    sendResponse(clientFd, code: 500, message: "Internal Server Error", contentType: "application/json", body: #"{"error":"Encode failed"}"#)
                }
            } else if method == "POST" {
                guard let incoming = try? CardImportEngine.parseJSON(data: bodyData) else {
                    sendResponse(clientFd, code: 400, message: "Bad Request", contentType: "application/json", body: #"{"error":"Invalid card JSON"}"#)
                    return
                }
                // 协议 v2 §4：信封里的墓碑一并交给合并方按对称语义应用
                let mergeResult = await onReceiveCards(incoming.cards, incoming.tombstones)
                let totalCards = await getCards().count

                let respDict: [String: Any] = [
                    "status": "success",
                    "restored": mergeResult.restored,
                    "added": mergeResult.added,
                    "ignored": mergeResult.ignored,
                    "total": totalCards,
                    // 协议 v2 §1：本次被对端墓碑删除的本地卡数（旧端不认识则忽略）
                    "deleted": mergeResult.deleted
                ]
                if let respData = try? JSONSerialization.data(withJSONObject: respDict),
                   let respString = String(data: respData, encoding: .utf8) {
                    sendResponse(clientFd, code: 200, message: "OK", contentType: "application/json; charset=utf-8", body: respString)
                }
            } else {
                sendResponse(clientFd, code: 405, message: "Method Not Allowed", contentType: "application/json", body: #"{"error":"Method Not Allowed"}"#)
            }

        default:
            sendResponse(clientFd, code: 404, message: "Not Found", contentType: "application/json", body: #"{"error":"Not Found"}"#)
        }
    }

    /// 循环写满整个缓冲。流式 socket 的单次 write 只保证「把能放进发送缓冲的写出去」：
    /// 大响应（全库导出上限 25MiB）远超 socket 发送缓冲、对端读得慢触发 SO_SNDTIMEO、
    /// 或被信号打断（EINTR）时都会返回部分写/错误——单次 write + 忽略返回值会让对端
    /// 拿到 Content-Length 对不上的静默截断 JSON。返回 false 表示连接已不可用
    /// （对端断开 / 超时 / 出错），调用方应放弃本次响应。
    private func writeAll(_ fd: Int32, _ bytes: [UInt8]) -> Bool {
        var offset = 0
        while offset < bytes.count {
            let written = bytes.withUnsafeBytes { raw -> Int in
                Darwin.write(fd, raw.baseAddress!.advanced(by: offset), bytes.count - offset)
            }
            if written > 0 {
                offset += written
            } else if written < 0 && errno == EINTR {
                continue   // 被信号打断：重试本次写入
            } else {
                return false
            }
        }
        return true
    }

    private func sendResponse(_ clientFd: Int32, code: Int, message: String, contentType: String, body: String) {
        let bodyBytes = [UInt8](body.utf8)
        let header = "HTTP/1.1 \(code) \(message)\r\n" +
            "Content-Type: \(contentType)\r\n" +
            "Content-Length: \(bodyBytes.count)\r\n" +
            "Connection: close\r\n\r\n"

        // header 与 body 都必须写满：Content-Length 是对端读取的依据，任何一段提前放弃
        // 都是对端侧的截断 JSON。写失败后连接由 handleClient 的 defer 关闭，无可恢复手段。
        guard writeAll(clientFd, [UInt8](header.utf8)) else { return }
        if !bodyBytes.isEmpty {
            _ = writeAll(clientFd, bodyBytes)
        }
    }

    /// 获取本机局域网 IPv4 地址
    public static func getLocalIPAddress() -> String? {
        var address: String?
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let firstAddr = ifaddr else { return nil }
        defer { freeifaddrs(ifaddr) }

        for ptr in sequence(first: firstAddr, next: { $0.pointee.ifa_next }) {
            let flags = Int32(ptr.pointee.ifa_flags)
            let addr = ptr.pointee.ifa_addr.pointee

            if (flags & (IFF_UP | IFF_RUNNING | IFF_LOOPBACK)) == (IFF_UP | IFF_RUNNING) {
                if addr.sa_family == UInt8(AF_INET) {
                    var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                    if getnameinfo(ptr.pointee.ifa_addr, socklen_t(addr.sa_len),
                                   &hostname, socklen_t(hostname.count),
                                   nil, socklen_t(0), NI_NUMERICHOST) == 0 {
                        let ip = String(decoding: hostname.prefix(while: { $0 != 0 }).map { UInt8(bitPattern: $0) }, as: UTF8.self)
                        if ip.hasPrefix("192.168.") || ip.hasPrefix("10.") || ip.hasPrefix("172.") {
                            return ip
                        }
                        if address == nil { address = ip }
                    }
                }
            }
        }
        return address
    }
}
