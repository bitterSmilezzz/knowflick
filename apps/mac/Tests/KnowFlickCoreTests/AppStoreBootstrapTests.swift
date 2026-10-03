import Foundation
import Testing
@testable import KnowFlickCore

/// bootstrap 启动路径的 Wave A 护栏：
/// ① 全库重排只发生一次——卡片加载时的派生就是唯一一次，settings 迁移赋值（只补密钥）
///    不得把刚派生好的卡堆再白排一遍；
/// ② 自动补卡 24h 节流——卡片不足 + AI 已配置时不再每次启动都自动生成、固定消耗用户 API 额度。
@MainActor
struct AppStoreBootstrapTests {

    // MARK: - ① 启动只排一遍

    /// 按卡池规模记录的重排轨迹必须恰好含**一次**全库派生。修复前是两次：cards 赋值
    /// 先按 .default 全库派生一遍，结尾 `settings = migratedSettings` 触发 didSet 再排一遍。
    /// 随后的只补密钥赋值（bootstrap 迁移的同款路径）不得再触发重排；派生输入真变了必须重排。
    @Test func bootstrapRecomputesFullDeckExactlyOnce() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let storage = Storage(baseDir: directory)
        defer { try? FileManager.default.removeItem(at: directory) }
        let storedCards = (0..<6).map { i in
            KnowledgeCard(category: "冷知识", headline: "存量卡\(i)", summary: "摘要", details: "详情",
                          source: .imported, createdAt: Date(timeIntervalSince1970: 1_000_000))
        }
        storage.saveCards(storedCards)
        var settings = AISettings.default
        settings.autoGenerate = false   // 生成路径与本护栏无关，整个关掉
        try storage.saveSettingsThrowing(settings)

        let store = AppStore(storage: storage)
        defer { store.flushPersistence() }
        await store.bootstrap()

        let fullDerives = store.deckRecomputeTrace.filter { $0 > 0 }
        #expect(fullDerives.count == 1, "启动全库重排应只发生一次，实际轨迹 \(store.deckRecomputeTrace)")
        #expect(fullDerives.first == store.cards.count)
        #expect(store.deck.count == store.cards.count)

        // 只补密钥的设置赋值不得触发全库重排（轨迹保持不变）
        store.settings.apiKey = "anything"
        #expect(store.deckRecomputeTrace.filter { $0 > 0 } == fullDerives)

        // 反向：派生输入（来源开关）真变了必须重排——守卫不得把语义吞掉
        store.settings.enableAI = false
        #expect(store.deckRecomputeTrace.filter { $0 > 0 }.count == 2)
    }

    // MARK: - ② 自动补卡 24h 节流

    /// 计数替身：bootstrap 的自动补卡走 AIService → URLSession，在 URLProtocol 层计数最可靠。
    private final class CountingGenerationStub: URLProtocol, @unchecked Sendable {
        private static let lock = NSLock()
        nonisolated(unsafe) private static var count = 0
        static func reset() { lock.lock(); count = 0; lock.unlock() }
        static var requestCount: Int {
            lock.lock(); defer { lock.unlock() }
            return count
        }

        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
        override func startLoading() {
            Self.lock.lock(); Self.count += 1; Self.lock.unlock()
            let payload: [String: Any] = [
                "category": "冷知识",
                "headline": "自动补的卡",
                "summary": "摘要",
                "details": String(repeating: "自动补卡内容的深入说明。", count: 12)
            ]
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

    /// 隔离钥匙串：bootstrap 的密钥迁移不得碰真实钥匙串
    private final class MemoryCredentials: CredentialStore {
        var values: [String: String] = [:]
        func read(account: String) -> String? { values[account] }
        func save(_ value: String, account: String) throws { values[account] = value }
        func delete(account: String) throws { values.removeValue(forKey: account) }
    }

    /// 合法空库（cards.json = "[]"）+ AI 已配置：bootstrap 后 deck.count < 5，命中自动补卡条件。
    /// 用空库而不是少量存量卡：存量卡会触发种子增量合并，卡堆立刻 ≥5，补卡条件永不成立。
    private func makeAutoTopUpStore(lastAutoTopUpAt: Date?) throws -> (AppStore, Storage, URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let storage = Storage(baseDir: directory)
        try "[]".write(to: directory.appendingPathComponent("cards.json"), atomically: true, encoding: .utf8)
        var settings = AISettings.default
        settings.baseURL = "http://localhost:11434/v1"   // 本机服务：无需密钥即 isAIConfigured
        settings.autoGenerate = true
        settings.enableAI = true
        settings.lastAutoTopUpAt = lastAutoTopUpAt
        try storage.saveSettingsThrowing(settings)

        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [CountingGenerationStub.self]
        let store = AppStore(
            storage: storage,
            credentials: MemoryCredentials(),
            aiService: AIService(session: URLSession(configuration: config), retryBaseDelay: 0.01)
        )
        return (store, storage, directory)
    }

    /// 首次（从未自动补卡）触发生成，且补卡时间落盘——节流窗口的判据就是它
    @Test func bootstrapGeneratesWhenNeverToppedUp() async throws {
        CountingGenerationStub.reset()
        let (store, storage, directory) = try makeAutoTopUpStore(lastAutoTopUpAt: nil)
        defer { store.flushPersistence(); try? FileManager.default.removeItem(at: directory) }

        await store.bootstrap()

        #expect(CountingGenerationStub.requestCount >= 1, "从未自动补卡时应触发生成")
        #expect(store.settings.lastAutoTopUpAt != nil)
        #expect(store.cards.contains { $0.headline == "自动补的卡" })
        store.flushPersistence()
        #expect(Storage(baseDir: directory).loadSettings().lastAutoTopUpAt != nil, "补卡时间应落盘")
        _ = storage
    }

    /// 24h 内已自动补过卡：二次启动不再生成（时间以落盘的补卡时间回推，等效时钟注入）
    @Test func bootstrapSkipsGenerationWithin24Hours() async throws {
        CountingGenerationStub.reset()
        let (store, _, directory) = try makeAutoTopUpStore(lastAutoTopUpAt: Date().addingTimeInterval(-3600))
        defer { store.flushPersistence(); try? FileManager.default.removeItem(at: directory) }

        await store.bootstrap()

        #expect(CountingGenerationStub.requestCount == 0, "距上次自动补卡不足 24h 不应再生成")
        #expect(store.lastError == nil)
        #expect(store.cards.isEmpty)
    }

    /// 超过 24h：再次启动重新允许自动补卡
    @Test func bootstrapGeneratesAgainAfter24Hours() async throws {
        CountingGenerationStub.reset()
        let (store, _, directory) = try makeAutoTopUpStore(lastAutoTopUpAt: Date().addingTimeInterval(-25 * 3600))
        defer { store.flushPersistence(); try? FileManager.default.removeItem(at: directory) }

        await store.bootstrap()

        #expect(CountingGenerationStub.requestCount >= 1, "距上次自动补卡超过 24h 应重新生成")
    }

    /// 节流边界（纯函数，时间显式注入）：nil 放行、≥24h 放行、不足 24h 跳过、未来时间戳跳过
    @Test func autoTopUpThrottleBoundary() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        #expect(AppStore.autoTopUpAllowed(lastAutoTopUpAt: nil, now: now))
        #expect(AppStore.autoTopUpAllowed(lastAutoTopUpAt: now.addingTimeInterval(-24 * 3600), now: now))
        #expect(!AppStore.autoTopUpAllowed(lastAutoTopUpAt: now.addingTimeInterval(-24 * 3600 + 1), now: now))
        #expect(!AppStore.autoTopUpAllowed(lastAutoTopUpAt: now.addingTimeInterval(60), now: now))
    }
}
