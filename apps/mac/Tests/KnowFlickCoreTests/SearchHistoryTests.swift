import Foundation
import Testing
@testable import KnowFlickCore

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
}
