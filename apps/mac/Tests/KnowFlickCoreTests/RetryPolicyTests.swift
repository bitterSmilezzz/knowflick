import Foundation
import Testing
@testable import KnowFlickCore

/// Wave C2 重试策略统一的测试：`RetryPolicy` 的判定/退避只有一份事实来源，
/// 两条流式路径（生成 / 追问）按同一类型的两个预设实例化，行为逐条等价——
/// 这里既钉策略本身，也在传输层复核「重试几次、何时放弃」。
struct RetryPolicyTests {

    // MARK: - 策略值本身

    /// 两处预设与历史参数逐值一致：最多 3 次尝试、退避 1s/2s（基数可注入）、
    /// 差异只有「已产出后是否允许重试」。
    @Test func presetsMatchHistoricalParameters() {
        let generation = RetryPolicy.cardGeneration(retryBaseDelay: 1.0)
        #expect(generation.maxAttempts == 3)
        #expect(generation.backoff == [1.0, 2.0])
        #expect(generation.allowsRetryAfterOutput, "生成路径重试时还没有任何产出")

        let chat = RetryPolicy.cardChat(retryBaseDelay: 0.01)
        #expect(chat.maxAttempts == 3)
        #expect(chat.backoff == [0.01, 0.02])
        #expect(!chat.allowsRetryAfterOutput, "追问路径一旦 yield 过内容就不能重放")
    }

    /// 可重试错误 = 429 与全部 5xx；其余（400/401/404/解析失败/网络错误/未配置）一律不重试。
    @Test func only429AndServerErrorsAreRetryable() {
        let policy = RetryPolicy.cardGeneration(retryBaseDelay: 1)
        for code in [429, 500, 502, 503, 599] {
            #expect(policy.shouldRetry(after: .httpStatus(code, "x"), attempt: 0), "HTTP \(code) 应可重试")
        }
        for code in [400, 401, 403, 404, 422, 600] {
            #expect(!policy.shouldRetry(after: .httpStatus(code, "x"), attempt: 0), "HTTP \(code) 不应重试")
        }
        #expect(!policy.shouldRetry(after: .network("断网"), attempt: 0))
        #expect(!policy.shouldRetry(after: .parse("坏输出"), attempt: 0))
        #expect(!policy.shouldRetry(after: .missingKey, attempt: 0))
    }

    /// 尝试预算：第 0、1 次失败后还有下一次；第 2 次（第 3 次尝试）失败即放弃。
    @Test func attemptBudgetStopsAfterTwoRetries() {
        let policy = RetryPolicy.cardGeneration(retryBaseDelay: 1)
        #expect(policy.shouldRetry(after: .httpStatus(429, "x"), attempt: 0))
        #expect(policy.shouldRetry(after: .httpStatus(429, "x"), attempt: 1))
        #expect(!policy.shouldRetry(after: .httpStatus(429, "x"), attempt: 2), "最多 3 次尝试（首次 + 2 次重试）")
    }

    /// 追问路径的差异点：已 yield 过内容后，即使 429/5xx 也不再重试；
    /// 生成路径（允许已产出后重试）不受该标记影响。
    @Test func chatNeverRetriesAfterFirstDelta() {
        let chat = RetryPolicy.cardChat(retryBaseDelay: 1)
        #expect(chat.shouldRetry(after: .httpStatus(429, "x"), attempt: 0, hasYielded: false))
        #expect(!chat.shouldRetry(after: .httpStatus(429, "x"), attempt: 0, hasYielded: true))
        #expect(!chat.shouldRetry(after: .httpStatus(503, "x"), attempt: 1, hasYielded: true))

        let generation = RetryPolicy.cardGeneration(retryBaseDelay: 1)
        #expect(generation.shouldRetry(after: .httpStatus(503, "x"), attempt: 1, hasYielded: true))
    }

    /// 退避序列：第 n 次重试取 backoff[n]，超出序列长度时取最后一档（不越界）。
    @Test func backoffUsesConfiguredStepsAndClamps() {
        let policy = RetryPolicy.cardGeneration(retryBaseDelay: 1)
        #expect(policy.delayBeforeRetry(attempt: 0) == 1)
        #expect(policy.delayBeforeRetry(attempt: 1) == 2)
        #expect(policy.delayBeforeRetry(attempt: 5) == 2)
    }

    // MARK: - 传输层复核：真的只发这几次请求

    private func service() -> (AIService, URLSession) {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StatusStubProtocol.self]
        let session = URLSession(configuration: config)
        return (AIService(session: session, retryBaseDelay: 0.01), session)
    }

    private func settings() -> AISettings {
        var settings = AISettings.default
        settings.baseURL = "http://localhost:9/v1"
        settings.apiKey = "test-key"
        settings.model = "test-model"
        return settings
    }

    /// 生成路径一直 429：恰好 3 次请求后把最后一次的 httpStatus 抛给上层。
    @Test func generationRetriesThreeAttemptsThenSurfaces429() async throws {
        StatusStubProtocol.reset(status: 429)
        let (service, session) = service()
        defer { session.invalidateAndCancel() }

        do {
            _ = try await service.generateCards(settings: settings(), count: 1, excludeHeadlines: [])
            Issue.record("持续 429 不应成功")
        } catch let error as AIError {
            guard case let .httpStatus(code, _) = error else {
                Issue.record("应上抛 httpStatus，实际 \(error)")
                return
            }
            #expect(code == 429)
        }
        #expect(StatusStubProtocol.requestCount == 3, "首次 + 2 次重试")
    }

    /// 非重试类状态（400）一次即弃：不得为客户端错误白打两次请求。
    @Test func nonRetryableStatusFailsOnFirstAttempt() async throws {
        StatusStubProtocol.reset(status: 400)
        let (service, session) = service()
        defer { session.invalidateAndCancel() }

        do {
            _ = try await service.generateCards(settings: settings(), count: 1, excludeHeadlines: [])
            Issue.record("400 不应成功")
        } catch let error as AIError {
            guard case let .httpStatus(code, _) = error else {
                Issue.record("应上抛 httpStatus，实际 \(error)")
                return
            }
            #expect(code == 400)
        }
        #expect(StatusStubProtocol.requestCount == 1)
    }

    /// 追问路径在首个 delta 之前与生成路径同预算：一直 429 时 3 次请求后把错误交给流。
    @Test func chatRetriesThreeAttemptsBeforeFirstDelta() async throws {
        StatusStubProtocol.reset(status: 429)
        let (service, session) = service()
        defer { session.invalidateAndCancel() }

        let card = KnowledgeCard(category: "AI", headline: "标题", summary: "摘要", details: "正文", source: .seed,
                                 createdAt: Date(timeIntervalSince1970: 0))
        var thrown: (any Error)?
        do {
            for try await _ in service.streamCardChat(card: card, history: [], userPrompt: "问", settings: settings()) {}
            Issue.record("持续 429 的追问流不应正常结束")
        } catch {
            thrown = error
        }
        guard case .httpStatus(let code, _)? = thrown as? AIError else {
            Issue.record("应上抛 httpStatus，实际 \(String(describing: thrown))")
            return
        }
        #expect(code == 429)
        #expect(StatusStubProtocol.requestCount == 3)
    }
}

/// 固定状态码替身：按 `reset(status:)` 返回同一状态码并计数请求。
private final class StatusStubProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var count = 0
    nonisolated(unsafe) private static var status = 500

    static func reset(status: Int) {
        lock.lock()
        Self.status = status
        count = 0
        lock.unlock()
    }

    static var requestCount: Int {
        lock.lock(); defer { lock.unlock() }
        return count
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lock.lock()
        Self.count += 1
        let status = Self.status
        Self.lock.unlock()
        let body = Data(#"{"error":{"message":"请稍后重试"}}"#.utf8)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
