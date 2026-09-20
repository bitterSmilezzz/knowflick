import Foundation
import Darwin

public struct RemoteDeviceInfo: Sendable, Equatable {
    public let deviceName: String
    public let cardCount: Int
    public let favoriteCount: Int
    public let timestamp: Int64

    public init(deviceName: String, cardCount: Int, favoriteCount: Int, timestamp: Int64) {
        self.deviceName = deviceName
        self.cardCount = cardCount
        self.favoriteCount = favoriteCount
        self.timestamp = timestamp
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
    private let onReceiveCards: @Sendable ([KnowledgeCard]) async -> (added: Int, restored: Int, ignored: Int)

    public init(
        accessCode: String,
        getCards: @escaping @Sendable () async -> [KnowledgeCard],
        onReceiveCards: @escaping @Sendable ([KnowledgeCard]) async -> (added: Int, restored: Int, ignored: Int)
    ) {
        self.accessCode = accessCode
        self.getCards = getCards
        self.onReceiveCards = onReceiveCards
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

        // 验证 6 位配对码
        let providedAuth = headers[Self.authHeader.lowercased()]
        if providedAuth != accessCode {
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
                    "timestamp": timestamp
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
                if let jsonString = try? CardExportEngine.exportToJSON(cards: cards) {
                    sendResponse(clientFd, code: 200, message: "OK", contentType: "application/json; charset=utf-8", body: jsonString)
                } else {
                    sendResponse(clientFd, code: 500, message: "Internal Server Error", contentType: "application/json", body: #"{"error":"Encode failed"}"#)
                }
            } else if method == "POST" {
                guard let incoming = try? CardImportEngine.parseJSON(data: bodyData) else {
                    sendResponse(clientFd, code: 400, message: "Bad Request", contentType: "application/json", body: #"{"error":"Invalid card JSON"}"#)
                    return
                }

                let mergeResult = await onReceiveCards(incoming)
                let totalCards = await getCards().count

                let respDict: [String: Any] = [
                    "status": "success",
                    "restored": mergeResult.restored,
                    "added": mergeResult.added,
                    "ignored": mergeResult.ignored,
                    "total": totalCards
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

    private func sendResponse(_ clientFd: Int32, code: Int, message: String, contentType: String, body: String) {
        let bodyBytes = [UInt8](body.utf8)
        let header = "HTTP/1.1 \(code) \(message)\r\n" +
            "Content-Type: \(contentType)\r\n" +
            "Content-Length: \(bodyBytes.count)\r\n" +
            "Connection: close\r\n\r\n"

        let headerBytes = [UInt8](header.utf8)
        Darwin.write(clientFd, headerBytes, headerBytes.count)
        if !bodyBytes.isEmpty {
            Darwin.write(clientFd, bodyBytes, bodyBytes.count)
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
