import Foundation
import Testing
@testable import KnowFlickCore

final class StorageTests {
    private var tempDir: URL!
    private var storage: Storage!

    init() {
        tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("KnowFlickTests-\(UUID().uuidString)", isDirectory: true)
        storage = Storage(baseDir: tempDir)
    }

    deinit {
        try? FileManager.default.removeItem(at: tempDir)
    }

    private func makeCard(_ headline: String) -> KnowledgeCard {
        KnowledgeCard(
            category: "物理",
            headline: headline,
            summary: "摘要",
            details: "详情详情详情详情详情详情详情详情",
            source: .seed,
            createdAt: Date(timeIntervalSince1970: 1_000_000)
        )
    }

    private func encodeCards(_ cards: [KnowledgeCard]) -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return try! encoder.encode(cards)
    }

    private func writeMain(_ data: Data) throws {
        try data.write(to: tempDir.appendingPathComponent("cards.json"))
    }

    // MARK: - 保存/加载往返

    @Test func saveThenLoadReturnsTheSameCards() {
        let cards = [makeCard("往返测试")]
        storage.saveCards(cards)
        #expect(storage.loadCards().map(\.headline) == ["往返测试"])
    }

    @Test func loadingBeforeFirstSaveReturnsEmpty() {
        #expect(storage.loadCards().isEmpty)
    }

    // MARK: - 备份轮转（C1 核心回归）

    @Test func savingThreeVersionsLeavesTheSecondVersionAsBackup() {
        storage.saveCards([makeCard("第一版")])
        storage.saveCards([makeCard("第二版")])
        storage.saveCards([makeCard("第三版")])

        let backupURL = tempDir.appendingPathComponent("cards.backup.json")
        #expect(FileManager.default.fileExists(atPath: backupURL.path), "备份文件应存在")

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let backup = try! decoder.decode([KnowledgeCard].self, from: Data(contentsOf: backupURL))
        // 关键断言：备份必须是「上一版」（第二版），而不是停在第一次保存的残影
        #expect(backup.map(\.headline) == ["第二版"])
    }

    // MARK: - 三代备份轮转与隔离副本上限（B7）

    /// 协议 §8：备份轮转扩为 3 代——cards.json → backup → backup.2，每次保存依次轮转。
    /// 稳态不变量：N≥2 次保存后 main=vN、backup=v(N-1)、backup.2=v(N-2)。
    @Test("B7 备份三代轮转：main/backup/backup.2 覆盖最近三个版本")
    func savingFourVersionsRotatesThreeGenerations() throws {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let backup2URL = tempDir.appendingPathComponent("cards.backup.2.json")

        storage.saveCards([makeCard("第一版")])
        #expect(!FileManager.default.fileExists(atPath: backup2URL.path), "首次保存还没有上一代备份可轮转")
        storage.saveCards([makeCard("第二版")])
        storage.saveCards([makeCard("第三版")])
        storage.saveCards([makeCard("第四版")])

        let main = try decoder.decode([KnowledgeCard].self, from: Data(contentsOf: tempDir.appendingPathComponent("cards.json")))
        #expect(main.map(\.headline) == ["第四版"])
        let backup = try decoder.decode([KnowledgeCard].self, from: Data(contentsOf: tempDir.appendingPathComponent("cards.backup.json")))
        #expect(backup.map(\.headline) == ["第三版"], "第一代备份必须是上一版")
        let backup2 = try decoder.decode([KnowledgeCard].self, from: Data(contentsOf: backup2URL))
        #expect(backup2.map(\.headline) == ["第二版"], "第二代备份必须是上上版")
    }

    /// 第三代备份参与恢复链：主文件与第一代备份都坏时，从 backup.2 恢复。
    @Test("B7 主文件与第一代备份均损坏时从 backup.2 恢复")
    func recoveryFallsThroughToThirdGenerationBackup() throws {
        storage.saveCards([makeCard("第一版")])
        storage.saveCards([makeCard("第二版")])
        storage.saveCards([makeCard("第三版")])
        // 此刻 main=第三版、backup=第二版、backup.2=第一版（三代轮转不变量）
        // 主文件 + 第一代备份全部写坏（bypass 轮转），只剩 backup.2 可救
        try writeMain(Data("{ broken main".utf8))
        try Data("{ broken backup".utf8).write(to: tempDir.appendingPathComponent("cards.backup.json"))

        let loaded = storage.loadCards()
        #expect(loaded.map(\.headline) == ["第一版"], "第三代备份必须兜底恢复")
    }

    /// 协议 §8：`*.corrupt-*` 隔离副本超过 10 个删最老。
    @Test("B7 隔离副本超过 10 个删最老")
    func quarantineCopiesPrunedToLimitOldestFirst() throws {
        let fileManager = FileManager.default
        // 预置 11 个隔离副本，修改时间依次变新（index 越大越新）
        for index in 0...10 {
            let url = tempDir.appendingPathComponent("cards.corrupt-\(index)-FAKE")
            try Data("corrupt \(index)".utf8).write(to: url)
            try fileManager.setAttributes(
                [.modificationDate: Date(timeIntervalSince1970: 1_727_900_000 + Double(index))],
                ofItemAtPath: url.path
            )
        }
        // 再触发一次隔离（settings.json 写坏）：目录达到 12 个 → 裁掉最老的 2 个
        try Data("{bad".utf8).write(to: tempDir.appendingPathComponent("settings.json"))
        _ = storage.loadSettings()

        let remaining = try fileManager.contentsOfDirectory(atPath: tempDir.path)
            .filter { $0.contains(".corrupt-") }
        #expect(remaining.count == Storage.quarantineCopyLimit, "隔离副本数必须收敛到上限")
        #expect(!remaining.contains(where: { $0.hasPrefix("cards.corrupt-0-") }), "最老副本（index 0）被删")
        #expect(!remaining.contains(where: { $0.hasPrefix("cards.corrupt-1-") }), "次老副本（index 1）被删")
        #expect(remaining.contains("cards.corrupt-10-FAKE"), "最新副本保留")
        #expect(remaining.contains(where: { $0.hasPrefix("settings.corrupt-") }), "刚隔离的副本保留")
    }

    @Test func corruptedMainFileFallsBackToBackupAndRepairsMain() {
        storage.saveCards([makeCard("健康版")])
        // 主文件写坏
        try! writeMain(Data("{ not valid json".utf8))

        let loaded = storage.loadCards()
        #expect(loaded.map(\.headline) == ["健康版"])
        // 恢复后主文件应被重建为健康内容
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let main = try! decoder.decode([KnowledgeCard].self, from: Data(contentsOf: tempDir.appendingPathComponent("cards.json")))
        #expect(main.map(\.headline) == ["健康版"])
    }

    @Test func emptyMainArrayFallsBackToNonEmptyBackup() {
        storage.saveCards([makeCard("内容卡")])
        try! writeMain(encodeCards([]))   // 空数组视为损坏
        #expect(storage.loadCards().map(\.headline) == ["内容卡"])
    }

    @Test func corruptedMainAndBackupAreQuarantinedBeforeReseeding() {
        try! writeMain(Data("{ bad".utf8))
        try! Data("{ also bad".utf8).write(to: tempDir.appendingPathComponent("cards.backup.json"))
        #expect(storage.loadCards().isEmpty)
        // 损坏文件被隔离保留，下次可重新播种
        #expect(!(FileManager.default.fileExists(atPath: tempDir.appendingPathComponent("cards.json").path)))
        let quarantined = try! FileManager.default.contentsOfDirectory(atPath: tempDir.path)
            .filter { $0.contains("corrupt-") }
        #expect(quarantined.count == 2)
    }

    // MARK: - 设置

    @Test func testSettingsRoundTrip() throws {
        var settings = AISettings.default
        settings.model = "deepseek-reasoner"
        settings.categoryFilter = "物理, 天文"
        try storage.saveSettingsThrowing(settings)
        #expect(storage.loadSettings() == settings)
    }

    @Test func corruptedSettingsAndChatSessionsAreQuarantined() throws {
        try Data("{bad".utf8).write(to: tempDir.appendingPathComponent("settings.json"))
        try Data("{bad".utf8).write(to: tempDir.appendingPathComponent("chat_sessions.json"))
        try Data("{bad".utf8).write(to: tempDir.appendingPathComponent("search_history.json"))

        #expect(storage.loadSettings() == .default)
        #expect(storage.loadChatSessions().isEmpty)
        // 搜索历史与卡片/设置/追问会话同一口径：损坏时保留隔离副本，而不是静默当空
        #expect(storage.loadSearchHistory().isEmpty)
        let quarantined = try FileManager.default.contentsOfDirectory(atPath: tempDir.path)
            .filter { $0.contains("corrupt-") }
        #expect(quarantined.count == 3)
    }

    // MARK: - 同步墓碑表（协议 v2 §3/§4）

    @Test func tombstonesRoundTripAndMissingFileReturnsEmpty() {
        #expect(storage.loadTombstones().isEmpty, "无墓碑文件按空表处理")

        let tombstones = [
            SyncTombstone(id: "ABCDEF01-2222-3333-4444-555555555555", deletedAt: 1_727_900_001_000),
            SyncTombstone(id: "dead", deletedAt: 1_727_900_002_000)
        ]
        storage.saveTombstones(tombstones)
        #expect(storage.loadTombstones() == tombstones)
    }

    @Test func corruptedTombstoneFileIsQuarantinedAndReturnsEmpty() throws {
        storage.saveTombstones([SyncTombstone(id: "x", deletedAt: 1)])
        try Data("{bad".utf8).write(to: tempDir.appendingPathComponent("tombstones.json"))

        #expect(storage.loadTombstones().isEmpty)
        let quarantined = try FileManager.default.contentsOfDirectory(atPath: tempDir.path)
            .filter { $0.contains(".corrupt-") }
        #expect(quarantined.count == 1, "损坏的墓碑文件保留隔离副本")
    }

    @Test func tombstoneTablePrunesOldestBeyondProtocolCapacity() {
        // 协议 §4：容量上限 1000，超出裁最老（deletedAt 最小的先淘汰）
        let oversized = (0..<(SyncProtocol.maxTombstoneCount + 5)).map {
            SyncTombstone(id: "id-\($0)", deletedAt: Int64(1_727_900_000_000 + $0))
        }
        storage.saveTombstones(oversized)

        let loaded = storage.loadTombstones()
        #expect(loaded.count == SyncProtocol.maxTombstoneCount)
        #expect(loaded.map(\.deletedAt).min() == Int64(1_727_900_000_000 + 5), "最老（deletedAt 最小）的 5 条被裁掉")
        #expect(loaded.map(\.deletedAt).max() == Int64(1_727_900_000_000 + SyncProtocol.maxTombstoneCount + 4))
    }
}

extension StorageTests {
    @Test func settingsEncodingNeverContainsAPIKey() throws {
        var settings = AISettings.default
        settings.apiKey = "test-secret-do-not-persist"
        let encoded = try JSONEncoder().encode(settings)
        let object = try #require(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        #expect(object["apiKey"] == nil)
        try storage.saveSettingsThrowing(settings)
        let disk = try String(contentsOf: tempDir.appendingPathComponent("settings.json"), encoding: .utf8)
        #expect(!disk.contains(settings.apiKey))
        #expect(storage.loadSettings().apiKey.isEmpty)
        #expect(storage.loadSettings().model == settings.model)
    }

    @Test func recoveryDoesNotReplaceHealthyBackupWithCorruption() throws {
        storage.saveCards([makeCard("旧版")])
        storage.saveCards([makeCard("新版")])
        try writeMain(Data("broken".utf8))
        #expect(storage.loadCards().map(\.headline) == ["旧版"])
        try writeMain(Data("broken again".utf8))
        #expect(storage.loadCards().map(\.headline) == ["旧版"])
    }

    @Test func missingMainStillRecoversBackup() throws {
        storage.saveCards([makeCard("备份")])
        try FileManager.default.removeItem(at: tempDir.appendingPathComponent("cards.json"))
        #expect(storage.loadCards().map(\.headline) == ["备份"])
    }
}
