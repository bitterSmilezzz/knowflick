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
            #expect(request.value(forHTTPHeaderField: "User-Agent") == "KnowFlick/3.2")
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
}
