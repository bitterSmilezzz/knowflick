import Foundation
import Testing
@testable import KnowFlickCore

/// AppStore 追问聊天全链路传输测试：经 URLProtocol 替身驱动真实流式解析与落盘。
/// 替身按 URL 路径区分行为（含 /fail 返回 500），无共享可变状态，可安全并发。
private final class ChatStubProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let failing = request.url?.path.contains("fail") == true
        let status = failing ? 500 : 200
        let body: Data = failing
            ? Data("{\"error\":{\"message\":\"模拟服务端故障\"}}".utf8)
            : Data("data: {\"choices\":[{\"delta\":{\"content\":\"碳纤维\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"比铝还轻\"}}]}\n\ndata: [DONE]\n\n".utf8)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
                                       headerFields: ["Content-Type": "text/event-stream"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

@MainActor
struct ChatStreamTests {
    private func card() -> KnowledgeCard {
        KnowledgeCard(category: "AI", headline: "碳纤维为何又轻又硬", summary: "材料结构决定性能", details: "正文", source: .seed,
                      createdAt: Date(timeIntervalSince1970: 1_000_000))
    }

    private func makeStore(directory: URL, failing: Bool = false) -> AppStore {
        let storage = Storage(baseDir: directory)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ChatStubProtocol.self]
        let session = URLSession(configuration: config)
        let store = AppStore(storage: storage, aiService: AIService(session: session))
        var settings = store.settings
        settings.autoGenerate = false
        settings.baseURL = failing ? "http://localhost:9/fail/v1" : "http://localhost:9/v1"
        settings.apiKey = "test-key"
        settings.model = "test-model"
        store.settings = settings
        return store
    }

    @Test func sendChatMessageStreamsReplyAndPersistsSession() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = makeStore(directory: directory)
        defer { store.flushPersistence() }

        let subject = card()
        store.activeChatCard = subject
        store.sendChatMessage(prompt: "  为什么这么轻？  ")
        #expect(store.isChatStreaming)
        #expect(store.currentChatSession?.messages.first?.content == "为什么这么轻？")

        // 等待流结束（超时保护避免慢机误报）
        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        while store.isChatStreaming && ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(25))
        }
        #expect(!store.isChatStreaming)
        #expect(store.chatErrorMessage == nil)
        let messages = store.currentChatSession?.messages ?? []
        #expect(messages.count == 2)
        #expect(messages.last?.content == "碳纤维比铝还轻")
        #expect(messages.last?.isStreaming == false)

        // 会话已落盘（写入走后台串行队列，轮询等待）
        let persistedStorage = Storage(baseDir: directory)
        let persistDeadline = ContinuousClock.now.advanced(by: .seconds(3))
        var persisted = persistedStorage.loadChatSession(for: subject.id)
        while persisted?.messages.last?.content != "碳纤维比铝还轻" && ContinuousClock.now < persistDeadline {
            try await Task.sleep(for: .milliseconds(25))
            persisted = persistedStorage.loadChatSession(for: subject.id)
        }
        #expect(persisted?.messages.last?.content == "碳纤维比铝还轻")
    }

    @Test func serverErrorSurfacesAndDropsEmptyPlaceholder() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = makeStore(directory: directory, failing: true)
        defer { store.flushPersistence() }

        let subject = card()
        store.activeChatCard = subject
        store.sendChatMessage(prompt: "讲讲机理")

        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        while store.isChatStreaming && ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(25))
        }
        #expect(!store.isChatStreaming)
        // 非 2xx 时应透出服务端错误 message（而非空串）
        #expect(store.chatErrorMessage?.contains("模拟服务端故障") == true)
        // 空占位助手消息应被移除，只保留用户消息
        let messages = store.currentChatSession?.messages ?? []
        #expect(messages.count == 1)
        #expect(messages.first?.sender == .user)
    }
}

struct SSEParserTests {
    @Test func incrementalScannerMatchesWholeStringScanAcrossSplits() {
        let text = "前言 {\"category\":\"AI\",\"headline\":\"增量扫描\",\"summary\":\"s\",\"details\":\"d\"} 中间 {\"category\":\"物理\",\"headline\":\"量子 \\\" 引号\",\"summary\":\"s\",\"details\":\"dd\"} 尾部"
        let whole = AIService.scanObjects(in: text)
        #expect(whole.count == 2)
        let scanner = AIService.IncrementalObjectScanner()
        var index = text.startIndex
        while index < text.endIndex {
            let end = text.index(index, offsetBy: 7, limitedBy: text.endIndex) ?? text.endIndex
            scanner.append(String(text[index..<end]))
            index = end
        }
        #expect(scanner.objects.map(\.headline) == whole.map(\.headline))
    }

    @Test func parserHandlesDeltaAndMessagePayloads() {
        let delta = "data: " + "{\"choices\":[{\"delta\":{\"content\":\"碳纤维\"}}]}"
        #expect(AIService.sseContentDelta(delta) == "碳纤维")
        let message = "data: " + "{\"choices\":[{\"message\":{\"content\":\"完整回复\"}}]}"
        #expect(AIService.sseContentDelta(message) == "完整回复")
        #expect(AIService.sseContentDelta("data: [DONE]") == nil)
        #expect(AIService.sseContentDelta(": keep-alive") == nil)
    }
}
