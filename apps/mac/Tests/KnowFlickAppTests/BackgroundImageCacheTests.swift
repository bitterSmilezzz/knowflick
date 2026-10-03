import AppKit
import Foundation
import KnowFlickCore
import Testing
@testable import KnowFlick

/// Wave C2 主线程减负（b）的证据：`BackgroundImageCache` 未命中不再在调用线程（视图 body =
/// 主线程）同步解码，而是后台解码 + 主线程回填；同步 API、命中路径与 NSCache 双限保持不变。
///
/// 为什么注入解码替身：真实底图是 900px WebP，逐张真解码又慢又依赖图片内容。注入后
/// 能确定性地断言「解码发生在后台线程」「同 key 在途只排一次」「回填后命中」「失败不写缓存」；
/// 像素正确性由 Core 的 `BackgroundImageDecodeTests` 守护，这里不重复。
@MainActor
struct BackgroundImageCacheTests {

    /// 线程安全记录盒：解码替身在后台线程写，测试在主线程读
    private final class Recorder: @unchecked Sendable {
        private let lock = NSLock()
        private var calls = 0
        private var allOffMain = true

        var count: Int {
            lock.lock(); defer { lock.unlock() }
            return calls
        }
        /// 尚无调用时为 false（「没调用过」不等于「都在后台跑过」）
        var decodedOffMain: Bool {
            lock.lock(); defer { lock.unlock() }
            return calls > 0 && allOffMain
        }
        func record(offMain: Bool) {
            lock.lock(); calls += 1; allOffMain = allOffMain && offMain; lock.unlock()
        }
    }

    private func syntheticImage() -> NSImage {
        NSImage(size: NSSize(width: 4, height: 4))
    }

    /// 取一张资源 bundle 里真实存在的底图 key（只用于解析 URL；解码被替身接管）
    private func availableKey() throws -> String {
        let urls = CoreResources.bundle.urls(forResourcesWithExtension: "webp", subdirectory: nil) ?? []
        let url = try #require(urls.first, "资源 bundle 内找不到任何 webp 底图")
        return url.deletingPathExtension().lastPathComponent
    }

    /// 未命中：调用内同步返回 nil（没有在主线程解码），后台解码完成后回填、下一次调用命中。
    @Test func coldMissReturnsNilThenBackfillsFromBackgroundDecode() async throws {
        let cache = BackgroundImageCache()
        let recorder = Recorder()
        let image = syntheticImage()
        cache.decode = { _, _ in
            recorder.record(offMain: !Thread.isMainThread)
            return image
        }
        let key = try availableKey()

        #expect(cache.image(named: key) == nil, "未命中必须返回 nil（同步解码已移除）")

        await cache.awaitPendingDecodes()
        #expect(recorder.count == 1, "一次未命中只排一次解码")
        #expect(recorder.decodedOffMain, "解码必须在后台线程执行，不能占主线程")
        #expect(cache.image(named: key) != nil, "回填后必须命中缓存")
    }

    /// 命中路径：重复取值不再触发解码。
    @Test func hitPathNeverDecodesAgain() async throws {
        let cache = BackgroundImageCache()
        let recorder = Recorder()
        let image = syntheticImage()
        cache.decode = { _, _ in
            recorder.record(offMain: !Thread.isMainThread)
            return image
        }
        let key = try availableKey()

        _ = cache.image(named: key)
        await cache.awaitPendingDecodes()
        #expect(cache.image(named: key) != nil)

        let afterFirstFill = recorder.count
        for _ in 0..<5 { #expect(cache.image(named: key) != nil) }
        await cache.awaitPendingDecodes()
        #expect(recorder.count == afterFirstFill, "命中不得再排解码")
    }

    /// 在途去重：同一 key 解码未完成时再次未命中，不得排第二个解码任务。
    @Test(.timeLimit(.minutes(1))) func inFlightMissesForSameKeyShareOneDecode() async throws {
        let cache = BackgroundImageCache()
        let recorder = Recorder()
        let gate = DispatchSemaphore(value: 0)
        cache.decode = { _, _ in
            _ = gate.wait(timeout: .now() + 10)
            recorder.record(offMain: !Thread.isMainThread)
            return NSImage(size: NSSize(width: 4, height: 4))
        }
        let key = try availableKey()

        #expect(cache.image(named: key) == nil)
        #expect(cache.image(named: key) == nil, "解码在途：第二次未命中同样同步返回 nil")

        gate.signal()
        await cache.awaitPendingDecodes()
        #expect(recorder.count == 1, "同一 key 在途未命中只能排一次解码")
    }

    /// 底图文件不存在：返回 nil，且不排解码（与旧实现 guard 掉解码一致）。
    @Test func unknownKeyReturnsNilWithoutSchedulingDecode() async throws {
        let cache = BackgroundImageCache()
        let recorder = Recorder()
        cache.decode = { _, _ in
            recorder.record(offMain: !Thread.isMainThread)
            return nil
        }

        #expect(cache.image(named: "knowflick-no-such-background") == nil)
        await cache.awaitPendingDecodes()
        #expect(recorder.count == 0, "解析不到文件时不得排解码")
    }

    /// 解码失败（替身返回 nil）：不写缓存、不递增回填计数，下一次未命中仍会重试——
    /// 与旧同步实现的「解不出就不写缓存」逐条一致。
    @Test func failedDecodeIsNotCachedAndNextMissRetries() async throws {
        let cache = BackgroundImageCache()
        let recorder = Recorder()
        cache.decode = { _, _ in
            recorder.record(offMain: !Thread.isMainThread)
            return nil
        }
        let key = try availableKey()

        #expect(cache.image(named: key) == nil)
        await cache.awaitPendingDecodes()
        #expect(cache.image(named: key) == nil, "失败结果不得进缓存")

        await cache.awaitPendingDecodes()
        #expect(recorder.count == 2, "下一次未命中必须重试解码")
    }
}
