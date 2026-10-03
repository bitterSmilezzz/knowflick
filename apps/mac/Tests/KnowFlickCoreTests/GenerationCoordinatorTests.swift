import Foundation
import Testing
@testable import KnowFlickCore

/// Wave C2 生成编排下沉的表征测试：先把 `AppStore.generateNewCards` / `refreshDeck` /
/// bootstrap 自动补卡的现状钉死，再把这套编排搬进 `GenerationCoordinator`——搬迁后本文件
/// 必须零改动全绿（这是「行为等价」的可执行判据）。
///
/// 覆盖三条此前没有直接断言的契约：
/// ① 并发守卫：生成中重入直接返回，不产生第二次请求、不重复追加；
/// ② exclude 组装：排除列表是**整池**标题（不是前 100 条），池内已有标题不得被再次生成；
/// ③ 节流判定：24h 窗口内的边界（纯函数，时间显式注入）。
@MainActor
struct GenerationCoordinatorTests {
    private func card(_ headline: String) -> KnowledgeCard {
        KnowledgeCard(category: "冷知识", headline: headline, summary: "摘要-\(headline)", details: "详情-\(headline)", source: .imported)
    }

    private func waitUntil(_ condition: () -> Bool) async {
        let deadline = ContinuousClock.now.advanced(by: .seconds(10))
        while !condition() && ContinuousClock.now < deadline {
            try? await Task.sleep(for: .milliseconds(20))
        }
    }

    /// 构造一个接了替身的 store：设置已可用的 baseURL/apiKey，autoGenerate 关掉（本文件只测手动生成）
    private func makeStore(protocolClass: URLProtocol.Type) -> (AppStore, URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [protocolClass]
        let store = AppStore(
            storage: Storage(baseDir: directory),
            aiService: AIService(session: URLSession(configuration: config), retryBaseDelay: 0.01)
        )
        var settings = store.settings
        settings.baseURL = "http://localhost:9/v1"
        settings.apiKey = "test-key"
        settings.model = "test-model"
        settings.autoGenerate = false
        store.settings = settings
        return (store, directory)
    }

    // MARK: - ① 并发守卫

    /// 生成进行中（首个请求被替身闸住）时再次调用：守卫必须直接返回——
    /// 不产生第二次网络请求，也不把同一批卡重复追加进卡片池。
    @Test(.timeLimit(.minutes(1))) func generateRejectsReentryWhileInFlight() async throws {
        GatedGenerationStub.reset(headline: "闸门产出的卡", gateOpen: false)
        let (store, directory) = makeStore(protocolClass: GatedGenerationStub.self)
        defer {
            GatedGenerationStub.openGate()
            store.closeChat()
            store.flushPersistence()
            try? FileManager.default.removeItem(at: directory)
        }
        store.cards = [card("甲")]

        let first = Task { await store.generateNewCards(count: 1) }
        await waitUntil { store.isGenerating && GatedGenerationStub.requestCount == 1 }
        #expect(store.isGenerating, "生成开始后必须置位并发守卫标志")
        #expect(store.generationStartedAt != nil, "等待反馈需要开始时间戳")

        await store.generateNewCards(count: 1)
        #expect(GatedGenerationStub.requestCount == 1, "生成中重入不得发出第二次请求")

        GatedGenerationStub.openGate()
        await first.value

        #expect(!store.isGenerating, "生成结束必须复位守卫标志")
        #expect(store.generationStartedAt == nil, "生成结束必须清空开始时间戳")
        #expect(store.cards.map(\.headline) == ["甲", "闸门产出的卡"], "成功路径只追加一次")
    }

    // MARK: - ② exclude 组装

    /// 排除列表必须是**整池**标题：池内第 101 张之后的标题同样参与去重
    /// （AIService 只把前 100 条写进提示词，但去重集合取全量参数）。
    /// 若调用方把列表截断到 100 再传，本用例的替身产出会被当成新卡追加 → 变红。
    @Test func generationExcludesHeadlinesFromTheWholePool() async throws {
        GatedGenerationStub.reset(headline: "量子章鱼有三颗心脏", gateOpen: true)
        let (store, directory) = makeStore(protocolClass: GatedGenerationStub.self)
        defer {
            store.closeChat()
            store.flushPersistence()
            try? FileManager.default.removeItem(at: directory)
        }
        // 第 101 张之后的标题（题面第 106 张）与替身产出完全同名
        let pool = (0..<105).map { card("存量卡\($0)") } + [card("量子章鱼有三颗心脏")]
        store.cards = pool

        await store.generateNewCards(count: 1)

        #expect(store.cards.count == pool.count, "池内已有同标题时不得追加重复卡")
        #expect(store.lastError != nil, "全部产出被排除后应报「无可用新卡」")
    }

    /// 成功路径清空早前的失败文案（视图依赖 `lastError` 判断是否弹错误提示）。
    @Test func successfulGenerationClearsPreviousError() async throws {
        GatedGenerationStub.reset(headline: "章鱼有三颗心脏", gateOpen: true)
        let (store, directory) = makeStore(protocolClass: GatedGenerationStub.self)
        defer {
            store.closeChat()
            store.flushPersistence()
            try? FileManager.default.removeItem(at: directory)
        }
        store.cards = [card("甲")]
        store.lastError = "上一次失败的旧文案"

        await store.generateNewCards(count: 1)

        #expect(store.lastError == nil)
        #expect(store.cards.map(\.headline) == ["甲", "章鱼有三颗心脏"])
    }

    // MARK: - ③ 24h 节流判定

    /// 节流边界（纯函数，时间显式注入）：nil 放行、恰好 24h 放行、差 1 秒跳过、未来时间戳跳过。
    /// Wave A 的「失败也记入窗口」不会改变本判定，只影响 lastAutoTopUpAt 何时被写。
    @Test func autoTopUpThrottleBoundary() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        #expect(GenerationCoordinator.autoTopUpAllowed(lastAutoTopUpAt: nil, now: now))
        #expect(GenerationCoordinator.autoTopUpAllowed(lastAutoTopUpAt: now.addingTimeInterval(-24 * 3600), now: now))
        #expect(!GenerationCoordinator.autoTopUpAllowed(lastAutoTopUpAt: now.addingTimeInterval(-24 * 3600 + 1), now: now))
        #expect(!GenerationCoordinator.autoTopUpAllowed(lastAutoTopUpAt: now.addingTimeInterval(60), now: now))
    }
}

/// 可闸住的生成替身：`reset(gateOpen: false)` 后首个请求会阻塞在 `startLoading`，
/// 用来构造「生成仍在进行中」的真实窗口；`openGate()` 放行。
/// 产出标题可配置（验证 exclude 组装）。
private final class GatedGenerationStub: URLProtocol, @unchecked Sendable {
    private static let condition = NSCondition()
    nonisolated(unsafe) private static var gateOpen = true
    nonisolated(unsafe) private static var count = 0
    nonisolated(unsafe) private static var headline = "替身产出的卡"

    static func reset(headline: String, gateOpen: Bool) {
        condition.lock()
        Self.headline = headline
        Self.gateOpen = gateOpen
        count = 0
        condition.broadcast()
        condition.unlock()
    }

    static func openGate() {
        condition.lock()
        gateOpen = true
        condition.broadcast()
        condition.unlock()
    }

    static var requestCount: Int {
        condition.lock(); defer { condition.unlock() }
        return count
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.condition.lock()
        Self.count += 1
        while !Self.gateOpen { Self.condition.wait() }
        let headline = Self.headline
        Self.condition.unlock()

        let payload: [String: Any] = [
            "category": "冷知识",
            "headline": headline,
            "summary": "摘要",
            "details": String(repeating: "这是替身生成内容的深入说明。", count: 12),
            "searchKeywords": ["替身"],
            "sources": []
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
