import Foundation
import Testing
@testable import KnowFlickCore

private final class AIStubProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        if request.url?.host == "opencode.ai" {
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer test-key")
        } else {
            #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        }
        #expect(request.httpMethod == "POST")
        if request.url?.host == "opencode.ai" {
            #expect(request.value(forHTTPHeaderField: "x-opencode-session")?.isEmpty == false)
            #expect(request.value(forHTTPHeaderField: "User-Agent") == "KnowFlick/" + AppVersion.current)
        }
        let isPing = request.url!.path.contains("ping") || request.url?.host == "opencode.ai"
        let body: Data
        if isPing {
            body = Data(#"{"choices":[{"message":{"content":"pong"}}]}"#.utf8)
        } else {
            let payload: [String: Any] = ["category": "AI", "headline": "超导材料的磁通排斥机制", "summary": "摘要", "details": String(repeating: "这是机制的深入说明。", count: 12)]
            let text = String(data: try! JSONSerialization.data(withJSONObject: [payload]), encoding: .utf8)!
            let event: [String: Any] = ["choices": [["delta": ["content": text]]]]
            body = Data("data: \(String(data: try! JSONSerialization.data(withJSONObject: event), encoding: .utf8)!)\n\ndata: [DONE]\n\n".utf8)
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
                                       headerFields: ["Content-Type": isPing ? "application/json" : "text/event-stream"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}


/// 429 后成功的重试替身：带锁计数器，验证 chat 流在首个 delta 前的重试行为
private final class RetryStubProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) static var count = 0

    static func reset() { lock.lock(); count = 0; lock.unlock() }
    static var requestCount: Int { lock.lock(); defer { lock.unlock() }; return count }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let attempt: Int = {
            Self.lock.lock(); defer { Self.lock.unlock() }
            Self.count += 1
            return Self.count
        }()
        let status = attempt == 1 ? 429 : 200
        let body: Data = status == 429
            ? Data("{\"error\":{\"message\":\"请稍后重试\"}}".utf8)
            : Data("data: {\"choices\":[{\"delta\":{\"content\":\"重试成功\"}}]}\n\ndata: [DONE]\n\n".utf8)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
                                       headerFields: ["Content-Type": status == 200 ? "text/event-stream" : "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}


/// 分批生成替身：每次请求只产出 1 张卡，验证 count 超过单请求上限时自动分批。
/// 标题彼此语义无关，避免被近重复过滤（bigram Jaccard > 0.35）拒绝。
private let batchHeadlines = ["碳纤维为何比铝轻", "冰箱制冷不是制造冷", "鲸鱼其实不是鱼", "蜂巢的六边形密码", "火焰温度的错觉", "香蕉是浆果草莓不是", "水在4度的密度反常"]

private final class BatchStubProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var counter = 0
    static func reset() { lock.lock(); counter = 0; lock.unlock() }
    static var requestCount: Int { lock.lock(); defer { lock.unlock() }; return counter }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let index: Int = {
            Self.lock.lock(); defer { Self.lock.unlock() }
            Self.counter += 1
            return Self.counter
        }()
        let details = String(repeating: "这是分批生成的深入说明内容。", count: 12)
        let payload: [String: Any] = [
            "category": "AI", "headline": batchHeadlines[(index - 1) % batchHeadlines.count], "summary": "摘要",
            "details": details, "searchKeywords": [String](), "sources": [String]()
        ]
        // 生成路径约定：delta.content 是「卡片 JSON 数组」的字符串形式
        let arrayText = String(data: try! JSONSerialization.data(withJSONObject: [payload]), encoding: .utf8)!
        let event: [String: Any] = ["choices": [["delta": ["content": arrayText]]]]
        let text = String(data: try! JSONSerialization.data(withJSONObject: event), encoding: .utf8)!
        let body = Data("data: \(text)\n\ndata: [DONE]\n\n".utf8)
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
                                       headerFields: ["Content-Type": "text/event-stream"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

struct AITransportTests {
    private func service() -> (AIService, URLSession) {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [AIStubProtocol.self]
        let session = URLSession(configuration: config)
        return (AIService(session: session), session)
    }
    private func settings(_ path: String = "stream") -> AISettings {
        var settings = AISettings.default
        settings.baseURL = "http://localhost/\(path)"
        return settings
    }

    @Test func localPingSendsNoAuthorizationHeader() async throws {
        let (service, session) = service()
        defer { session.invalidateAndCancel() }
        try await service.ping(settings: settings("ping"))
    }

    @Test func opencodeGoPingSendsStableSessionHeader() async throws {
        let (service, session) = service()
        defer { session.invalidateAndCancel() }
        var testSettings = settings()
        testSettings.baseURL = "https://opencode.ai/zen/go/v1"
        testSettings.apiKey = "test-key"
        try await service.ping(settings: testSettings)
    }

    @Test func streamingGenerationProducesUsableCards() async throws {
        let (service, session) = service()
        defer { session.invalidateAndCancel() }
        let cards = try await service.generateCards(settings: settings(), count: 1, excludeHeadlines: [])
        #expect(cards.count == 1)
        #expect(cards.first?.source == .ai)
        #expect(cards.first?.headline == "超导材料的磁通排斥机制")
    }

    @Test func deduplicationIncludesHeadlinesBeyondPromptLimit() async throws {
        let (service, session) = service()
        defer { session.invalidateAndCancel() }
        let existing = (0..<100).map { "标题\($0)" } + ["超导材料的磁通排斥机制"]
        do {
            _ = try await service.generateCards(settings: settings(), count: 1, excludeHeadlines: existing)
            Issue.record("Duplicate beyond the first 100 titles was accepted")
        } catch AIError.noUsableCards { }
    }

    @Test func invalidGenerationCountFailsBeforeTransport() async {
        let service = AIService()
        for count in [-1, 0, 21, Int.max] {
            do {
                _ = try await service.generateCards(settings: settings(), count: count, excludeHeadlines: [])
                Issue.record("Invalid count accepted")
            } catch AIError.badRequest { }
            catch { Issue.record("Unexpected error: \(error)") }
        }
    }

    @Test func chatStreamRetriesOn429BeforeFirstDelta() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RetryStubProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        RetryStubProtocol.reset()

        let service = AIService(session: session)
        var settings = AISettings.default
        settings.baseURL = "http://localhost/retry/v1"
        settings.apiKey = "k"
        settings.model = "test-model"
        let subject = KnowledgeCard(category: "AI", headline: "标题", summary: "摘要", details: "正文", source: .seed,
                                    createdAt: Date(timeIntervalSince1970: 0))
        var chunks: [String] = []
        for try await delta in service.streamCardChat(card: subject, history: [], userPrompt: "问", settings: settings) {
            chunks.append(delta)
        }
        #expect(chunks.joined() == "重试成功")
        #expect(RetryStubProtocol.requestCount == 2)
    }

    @Test func generateCardsBatchesCountsBeyondSingleRequestLimit() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [BatchStubProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        BatchStubProtocol.reset()

        let service = AIService(session: session)
        var settings = AISettings.default
        settings.baseURL = "http://localhost/batch/v1"
        settings.apiKey = "k"
        // 单请求上限 6 张：count=7 需要两批；每批替身只产出 1 张
        let cards = try await service.generateCards(settings: settings, count: 7, excludeHeadlines: [])
        #expect(cards.count == 2)
        #expect(Set(cards.map(\.headline)).count == 2)
        #expect(BatchStubProtocol.requestCount == 2)
    }
}
