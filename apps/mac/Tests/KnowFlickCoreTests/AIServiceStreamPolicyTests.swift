import Testing
import Foundation
@testable import KnowFlickCore

/// AI 生成流的中断裁定与多批聚合（Wave C：两条「部分保留」语义）。
/// 纯函数测试，不触网：`resolveInterruptedScan` 与 `aggregateBatches` 都是
/// 从 AIService 抽出的可测决策点。
struct AIServiceStreamPolicyTests: Sendable {
    private static func payload(_ headline: String) -> AIService.AICardPayload {
        AIService.AICardPayload(
            category: "冷知识",
            headline: headline,
            summary: "摘要",
            details: String(repeating: "详情", count: 40),
            searchKeywords: [],
            sources: []
        )
    }

    /// 线程安全的调用计数器：多批并发下区分「第几次调用」
    private final class CallCounter: @unchecked Sendable {
        private let lock = NSLock()
        private var count = 0
        func next() -> Int {
            lock.lock(); defer { lock.unlock() }
            count += 1
            return count
        }
    }

    // MARK: 流中断裁定

    @Test func userCancellationDiscardsPartiallyScannedObjects() {
        let objects = [Self.payload("已扫出的卡")]
        #expect(throws: (any Error).self) {
            try AIService.resolveInterruptedScan(objects: objects, interrupt: CancellationError())
        }
    }

    @Test func midStreamErrorKeepsCompletedObjects() throws {
        let objects = [Self.payload("第一批"), Self.payload("第二批")]
        let kept = try AIService.resolveInterruptedScan(objects: objects, interrupt: AIError.network("连接中断"))
        #expect(kept.map(\.headline) == ["第一批", "第二批"])
    }

    @Test func midStreamErrorWithNothingScannedRethrowsForRetry() {
        #expect(throws: (any Error).self) {
            try AIService.resolveInterruptedScan(objects: [], interrupt: AIError.network("连接中断"))
        }
    }

    // MARK: 多批聚合

    @Test func singleBatchRunsDirectlyAndPropagatesErrors() async {
        let out = try? await AIService.aggregateBatches([3]) { batch in
            (0..<batch).map { Self.payload("单批-\($0)") }
        }
        #expect(out?.count == 3)

        do {
            _ = try await AIService.aggregateBatches([3]) { _ in throw AIError.network("单批失败") }
            Issue.record("单批失败应向上抛出")
        } catch {
            #expect((error as? AIError)?.localizedDescription.contains("单批失败") == true)
        }
    }

    @Test func partialBatchFailureKeepsSuccessfulBatches() async throws {
        let counter = CallCounter()
        let out = try await AIService.aggregateBatches([4, 4, 4]) { batch in
            // 三批同值，用调用序号让第二批失败：第一、三批共 8 张应保留
            let call = counter.next()
            if call == 2 { throw AIError.network("中间批失败") }
            return (0..<batch).map { Self.payload("批\(call)-\($0)") }
        }
        #expect(out.count == 8)
    }

    @Test func allBatchesFailingThrowsLastError() async {
        do {
            _ = try await AIService.aggregateBatches([2, 2]) { batch in
                throw AIError.network("批 \(batch) 失败")
            }
            Issue.record("全批失败应抛错")
        } catch {
            #expect((error as? AIError)?.localizedDescription.contains("失败") == true)
        }
    }

    @Test func emptyBatchListYieldsEmptyOutput() async throws {
        let out = try await AIService.aggregateBatches([]) { _ in [Self.payload("不应被调用")] }
        #expect(out.isEmpty)
    }
}
