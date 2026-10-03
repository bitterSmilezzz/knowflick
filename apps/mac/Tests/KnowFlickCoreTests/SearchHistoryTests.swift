import Foundation
import Testing
@testable import KnowFlickCore

@MainActor
final class SearchHistoryTests {
    private var tempDir: URL!
    private var storage: Storage!

    init() {
        tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("KnowFlickSearchTests-\(UUID().uuidString)", isDirectory: true)
        storage = Storage(baseDir: tempDir)
    }

    deinit {
        try? FileManager.default.removeItem(at: tempDir)
    }

    @Test func storageSaveAndLoadSearchHistoryRoundtrip() throws {
        let history = ["量子纠缠", "黑洞", "相对论"]
        try storage.saveSearchHistoryThrowing(history)

        let loaded = storage.loadSearchHistory()
        #expect(loaded == history)
    }

    @Test func appStoreAddSearchHistoryDeduplicatesAndCapsAtEight() {
        let store = AppStore(storage: storage)
        #expect(store.searchHistory.isEmpty)

        store.addSearchHistory("一")
        store.addSearchHistory("二")
        store.addSearchHistory("三")
        store.addSearchHistory("一") // 重复搜索，提到首位

        #expect(store.searchHistory == ["一", "三", "二"])

        // 插入超过 8 条
        for i in 4...12 {
            store.addSearchHistory("词\(i)")
        }
        #expect(store.searchHistory.count == 8)
        #expect(store.searchHistory.first == "词12")

        // 空串被忽略
        store.addSearchHistory("   ")
        #expect(store.searchHistory.count == 8)

        // 移除单条
        store.removeSearchHistory("词12")
        #expect(store.searchHistory.count == 7)
        #expect(!store.searchHistory.contains("词12"))

        // 清空
        store.clearSearchHistory()
        #expect(store.searchHistory.isEmpty)
    }

    /// Wave A：搜索历史写失败必须上浮 `persistenceWarning` 横幅，与卡片/设置同一告警口径。
    /// 修复前 AppStore 绕过 PersistenceCoordinator 直写后台队列，失败只进 NSLog，用户无从得知。
    @Test(.timeLimit(.minutes(1))) func searchHistoryWriteFailureSurfacesPersistenceWarning() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("KnowFlickSearchFail-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        // 用目录占住 search_history.json 的位置：写入必然失败（PersistenceFeedbackTests 同款手法）
        try FileManager.default.createDirectory(at: directory.appendingPathComponent("search_history.json"), withIntermediateDirectories: false)
        let store = AppStore(storage: Storage(baseDir: directory))
        defer { store.flushPersistence() }

        store.addSearchHistory("量子纠缠")

        // 告警在后台队列落盘失败后跳回主线程设置，轮询等待（超时保护避免慢机误报）
        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        while store.persistenceWarning == nil && ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(25))
        }
        #expect(store.persistenceWarning?.contains("搜索历史保存失败") == true)
    }
}
