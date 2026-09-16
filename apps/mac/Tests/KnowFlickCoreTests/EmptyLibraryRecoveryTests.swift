import Foundation
import Testing
@testable import KnowFlickCore

/// P2-2 回归：合法空卡片库 vs「bootstrap 未完成即退出写出的 `[]`」——两处联动的行为契约。
///
/// 背景（审计 §2.1）：`Storage.loadCards` 原用 `!cards.isEmpty` 当有效性判据，于是
/// ① 用户真实的空库被隔离 + bootstrap 重播种（看到「自己的卡没了，还多出一堆预置卡」）；
/// ② 同一条守卫又是「启动未完成即退出」场景下唯一的救命绳（真正的卡片只在备份里）。
/// 修法必须两处联动：落盘侧不再写不可信的卡片快照，载入侧把「能解码的空数组」当合法状态，
/// 同时保留「空主文件 + 非空备份 → 从备份挽救」这条既有挽救路径。
@MainActor
struct EmptyLibraryRecoveryTests {
    private func card(_ name: String) -> KnowledgeCard {
        KnowledgeCard(category: "冷知识", headline: name, summary: "摘要-\(name)", details: "详情-\(name)", source: .imported)
    }

    private func withDirectory(_ body: (URL) throws -> Void) throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try body(directory)
    }

    private func withDirectoryAsync(_ body: (URL) async throws -> Void) async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try await body(directory)
    }

    private func quarantinedFiles(in directory: URL) -> [String] {
        ((try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? [])
            .filter { $0.contains("corrupt-") }
    }

    /// 注入内存凭据库：`bootstrap` 会读 apiKey，用真实钥匙串会让本机测试变慢、
    /// 且在并行套件里可能阻塞主线程（实测会让无关套件的 3 秒轮询超时）。
    private func makeStore(storage: Storage) -> AppStore {
        AppStore(storage: storage, credentials: MemoryCredentialStub())
    }

    // MARK: - 载入侧：合法的空数组不是损坏

    /// 合法空库：`saveCards([])` 之后 `loadCards()` 如实返回空库，不隔离、不留损坏副本。
    @Test func legitimateEmptyLibraryIsLoadedAsIsWithoutQuarantine() throws {
        try withDirectory { directory in
            let storage = Storage(baseDir: directory)
            storage.saveCards([])

            #expect(storage.loadCards().isEmpty)
            #expect(quarantinedFiles(in: directory).isEmpty, "合法空数组不应被隔离")
            #expect(storage.libraryWasUsable, "空数组是一次可用的卡片库加载，而不是无库")
        }
    }

    /// 首次启动（没有任何卡片文件）与「合法空库」必须可区分：前者才允许重新播种。
    @Test func missingLibraryIsReportedAsUnusable() throws {
        try withDirectory { directory in
            let storage = Storage(baseDir: directory)
            #expect(storage.loadCards().isEmpty)
            #expect(!storage.libraryWasUsable)
        }
    }

    /// 真损坏（主文件与备份都解不出来）仍是损坏：隔离两个文件并报告「无库」。
    @Test func unreadableFilesAreStillReportedAsUnusable() throws {
        try withDirectory { directory in
            let storage = Storage(baseDir: directory)
            try Data("{ bad".utf8).write(to: directory.appendingPathComponent("cards.json"))
            try Data("{ also bad".utf8).write(to: directory.appendingPathComponent("cards.backup.json"))

            #expect(storage.loadCards().isEmpty)
            #expect(!storage.libraryWasUsable)
            #expect(quarantinedFiles(in: directory).count == 2)
        }
    }

    // MARK: - bootstrap：空库不重播种

    /// 合法空库启动：卡片池保持为空，**不得**被预置库覆盖。
    @Test func bootstrapKeepsALegitimatelyEmptyLibraryEmpty() async throws {
        try await withDirectoryAsync { directory in
            let storage = Storage(baseDir: directory)
            storage.saveCards([])
            let store = makeStore(storage: storage)
            defer { store.closeChat(); store.flushPersistence() }

            await store.bootstrap()

            #expect(store.cards.isEmpty, "合法空库不得被预置库覆盖")
            #expect(store.deck.isEmpty)
            #expect(store.history.isEmpty)
            #expect(!store.isLoadingSeed)
        }
    }

    /// 首次启动（无任何卡片文件）仍然照旧灌入预置库——修法不能误伤新用户。
    @Test func bootstrapSeedsWhenNoLibraryExists() async throws {
        try await withDirectoryAsync { directory in
            let storage = Storage(baseDir: directory)
            let store = makeStore(storage: storage)
            defer { store.closeChat(); store.flushPersistence() }

            await store.bootstrap()

            #expect(!store.cards.isEmpty, "首次启动应灌入预置库")
            #expect(store.cards.allSatisfy { $0.source == .seed })
            #expect(!store.deck.isEmpty)
        }
    }

    // MARK: - 落盘侧：bootstrap 未完成前不写卡片

    /// 「bootstrap 未完成即退出」：内存里还是 `[]`，退出前的 flush 绝不能把用户卡片文件改成 `[]`。
    @Test func flushBeforeBootstrapCompletesDoesNotOverwriteCardsOnDisk() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let storage = Storage(baseDir: directory)
        let existing = card("既有卡片")
        storage.saveCards([existing])
        let mainURL = directory.appendingPathComponent("cards.json")
        let before = try Data(contentsOf: mainURL)

        // 模拟启动后立刻退出：store 仍是默认态（isLoadingSeed == true，cards == []）
        let store = AppStore(storage: storage)
        #expect(store.isLoadingSeed)
        store.shutdown()

        #expect(try Data(contentsOf: mainURL) == before, "未完成 bootstrap 的 flush 不得改写卡片文件")
        #expect(storage.loadCards().map(\.id) == [existing.id])
    }

    /// persistImmediately 同样受守卫保护（切后台路径）。
    /// 末尾补一次 `flushPersistence`：它与异步写入共用同一条串行队列，充当同步屏障，
    /// 使「文件未被改写」这条断言不是「还没写完」造成的假通过。
    @Test func immediateFlushBeforeBootstrapDoesNotWriteEmptyLibrary() throws {
        try withDirectory { directory in
            let storage = Storage(baseDir: directory)
            let existing = card("既有卡片")
            storage.saveCards([existing])
            let mainURL = directory.appendingPathComponent("cards.json")
            let before = try Data(contentsOf: mainURL)

            let store = makeStore(storage: storage)
            store.persistImmediately()
            store.flushPersistence()

            #expect(try Data(contentsOf: mainURL) == before)
            #expect(storage.loadCards().map(\.id) == [existing.id])
        }
    }

    // MARK: - 两项联动的交汇点（既有挽救路径必须保留）

    /// 空主文件 + 非空备份 → 仍从备份挽救（`StorageTests.emptyMainArrayFallsBackToNonEmptyBackup`
    /// 的端到端版本）：这正是旧版本「启动未完成即退出」留下的现场，用户卡片必须能回来。
    @Test func legacyEmptyMainFileStillRecoversFromBackup() async throws {
        try await withDirectoryAsync { directory in
            let storage = Storage(baseDir: directory)
            let existing = card("遗留卡片")
            storage.saveCards([existing])
            storage.saveCards([])          // 旧版本行为：主文件被写成 []，真正的卡片留在备份

            #expect(storage.loadCards().map(\.id) == [existing.id])

            let store = makeStore(storage: storage)
            defer { store.closeChat(); store.flushPersistence() }
            await store.bootstrap()
            #expect(store.cards.contains { $0.id == existing.id }, "用户的卡片必须从备份回到卡片池")
            #expect(store.isLoadingSeed == false)
        }
    }

    /// 口径说明（保留现状，供产品决策参考）：因为「空主文件 + 非空备份」优先从备份挽救，
    /// 将来若新增「清空全部卡片」功能，落盘时必须同时清掉备份（或引入显式空库标记），
    /// 否则清空后的第一份空文件会被上一版备份「复活」。
    /// （「空数组 + 无可用备份 = 合法空库」这条路径见 `legitimateEmptyLibraryIsLoadedAsIsWithoutQuarantine`。）
    @Test func emptyMainFilePrefersNonEmptyBackupOverEmptyLibrary() throws {
        try withDirectory { directory in
            let storage = Storage(baseDir: directory)
            let existing = card("还会回来")
            storage.saveCards([existing])
            storage.saveCards([])

            #expect(storage.loadCards().map(\.id) == [existing.id], "空文件 + 非空备份 = 从备份挽救（既有口径）")
        }
    }
}

/// 内存凭据库：测试不触碰真实钥匙串（bootstrap 会读 apiKey）
private final class MemoryCredentialStub: CredentialStore, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: String] = [:]
    func read(account: String) -> String? {
        lock.lock(); defer { lock.unlock() }
        return values[account]
    }
    func save(_ value: String, account: String) throws {
        lock.lock(); values[account] = value; lock.unlock()
    }
    func delete(account: String) throws {
        lock.lock(); values.removeValue(forKey: account); lock.unlock()
    }
}
