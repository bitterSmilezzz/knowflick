import Foundation
import Testing
@testable import KnowFlickCore

/// Wave C2 主线程减负（a）的证据：全量重排（O(n²) 防重排布）在输入超过阈值时下沉后台，
/// 结果回主线程一次性赋值；阈值以内（含 216 张用户库现状）保持同步、耗时不变。
///
/// 判定为什么可信：`apply` 在 MainActor 上执行，测试在 `store.cards = pool` 之后不挂起，
/// 后台结果不可能抢先把 deck 换掉——因此「赋值后同步可读旧值 / 等待后读到新值」是确定性断言，
/// 不依赖任何 sleep 或机器快慢。
@MainActor
struct BackgroundRearrangeTests {
    /// 阈值取自生产常量，避免测试与实现各写一个数
    private let threshold = CardLibraryStore.backgroundRearrangeThreshold

    private func card(_ headline: String) -> KnowledgeCard {
        KnowledgeCard(category: "冷知识", headline: headline, summary: "摘要-\(headline)", details: "详情-\(headline)", source: .imported)
    }

    private func makeStore() -> (AppStore, URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        return (AppStore(storage: Storage(baseDir: directory)), directory)
    }

    private func withStore(_ body: (AppStore) async throws -> Void) async throws {
        let (store, directory) = makeStore()
        defer {
            store.closeChat()
            store.flushPersistence()
            try? FileManager.default.removeItem(at: directory)
        }
        try await body(store)
    }

    /// 超过阈值：赋值返回时 deck 还没换（主线程没有跑 O(n²)），等待后台结果后
    /// deck 与同步路径的排布结果逐位相同。
    @Test func largeWholesaleReplacementRearrangesOffMainAndLandsOnMain() async throws {
        try await withStore { store in
            let pool = (0..<(threshold + 44)).map { card("大批量卡片\($0)") }
            store.cards = pool
            #expect(store.deck.isEmpty, "超过阈值的全量重排不得在赋值调用内同步跑完（主线程减负的判据）")

            await store.awaitPendingRearrange()
            let expected = CardThemeResolver.arrangeWithMinDistance(pool, minDistance: 5, avoidingTopKey: nil)
            #expect(store.deck.map(\.id) == expected.map(\.id), "后台排布结果必须与同步路径完全一致")
            #expect(Set(store.deck.map(\.id)) == Set(pool.map(\.id)))
        }
    }

    /// 阈值以内（含 216 张用户库现状）：赋值后同步即可读到排布结果——既有性质测试依赖的语义不变。
    @Test func poolWithinThresholdStaysSynchronous() async throws {
        try await withStore { store in
            let pool = (0..<216).map { card("现状规模卡片\($0)") }
            store.cards = pool
            let expected = CardThemeResolver.arrangeWithMinDistance(pool, minDistance: 5, avoidingTopKey: nil)
            #expect(!store.deck.isEmpty, "≤阈值必须保持同步派生（216 张现状不得变慢/变异步）")
            #expect(store.deck.map(\.id) == expected.map(\.id))
        }
    }

    /// 晚到的后台结果不得覆盖更新的状态：连续两次整库替换，最终 deck 必须是后一次的排布。
    @Test func staleBackgroundResultNeverOverwritesNewerState() async throws {
        try await withStore { store in
            let poolA = (0..<(threshold + 20)).map { card("旧池卡片\($0)") }
            let poolB = (0..<(threshold + 20)).map { card("新池卡片\($0)") }

            store.cards = poolA
            store.cards = poolB          // 第二次替换作废在途的第一次结果
            await store.awaitPendingRearrange()

            let idsA = Set(poolA.map(\.id))
            #expect(store.deck.allSatisfy { !idsA.contains($0.id) }, "旧池的排布结果不得晚到覆盖新池")
            let expected = CardThemeResolver.arrangeWithMinDistance(poolB, minDistance: 5, avoidingTopKey: nil)
            #expect(store.deck.map(\.id) == expected.map(\.id))
        }
    }

    /// 大库上的「出队保序」快分支仍同步：后台重排落地后划卡，deck 必须当场出队——
    /// 阈值只影响 O(n²) 的全量重排，不把日常划卡也变成异步。
    @Test func swipeOnLargePoolStillUpdatesDeckSynchronously() async throws {
        try await withStore { store in
            let pool = (0..<(threshold + 10)).map { card("大库卡片\($0)") }
            store.cards = pool
            await store.awaitPendingRearrange()
            let before = store.deck.map(\.id)
            #expect(before.count == pool.count)

            let top = try #require(store.topCard)
            store.swipe(top, direction: .skip)

            #expect(store.deck.map(\.id) == Array(before.dropFirst()), "日常划卡必须同步出队，不等后台")
            #expect(store.history.first?.id == top.id)
        }
    }

    /// 卡片池缩回阈值以内后行为回到同步：后台代号不得把后续同步派生误判为过期。
    @Test func shrinkingBackBelowThresholdReturnsToSynchronousDerivation() async throws {
        try await withStore { store in
            let large = (0..<(threshold + 5)).map { card("收缩前卡片\($0)") }
            store.cards = large
            await store.awaitPendingRearrange()

            let small = (0..<8).map { card("收缩后卡片\($0)") }
            store.cards = small
            let expected = CardThemeResolver.arrangeWithMinDistance(small, minDistance: 5, avoidingTopKey: nil)
            #expect(store.deck.map(\.id) == expected.map(\.id), "缩回阈值内的整库替换必须同步生效")
        }
    }
}
