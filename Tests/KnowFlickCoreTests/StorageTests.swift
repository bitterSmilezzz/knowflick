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

    @Test func testSaveLoadRoundTrip() {
        let cards = [makeCard("往返测试")]
        storage.saveCards(cards)
        #expect(storage.loadCards().map(\.headline) == ["往返测试"])
    }

    @Test func testLoadMissingReturnsEmpty() {
        #expect(storage.loadCards().isEmpty)
        #expect(!(storage.hasSeeded()))
    }

    // MARK: - 备份轮转（C1 核心回归）

    @Test func testBackupRotationKeepsPreviousVersion() {
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

    @Test func testLoadFromBackupWhenMainCorrupted() {
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

    @Test func testLoadFromBackupWhenMainEmptyArray() {
        storage.saveCards([makeCard("内容卡")])
        try! writeMain(encodeCards([]))   // 空数组视为损坏
        #expect(storage.loadCards().map(\.headline) == ["内容卡"])
    }

    @Test func testReseedWhenBothCorrupted() {
        try! writeMain(Data("{ bad".utf8))
        try! Data("{ also bad".utf8).write(to: tempDir.appendingPathComponent("cards.backup.json"))
        #expect(storage.loadCards().isEmpty)
        // 损坏文件被清走，下次可重新播种
        #expect(!(FileManager.default.fileExists(atPath: tempDir.appendingPathComponent("cards.json").path)))
    }

    // MARK: - 设置

    @Test func testSettingsRoundTrip() {
        var settings = AISettings.default
        settings.model = "deepseek-reasoner"
        settings.categoryFilter = "物理, 天文"
        storage.saveSettings(settings)
        #expect(storage.loadSettings() == settings)
    }
}

extension StorageTests {
    @Test func settingsEncodingNeverContainsAPIKey() throws {
        var settings = AISettings.default
        settings.apiKey = "test-secret-do-not-persist"
        let encoded = try JSONEncoder().encode(settings)
        let object = try #require(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        #expect(object["apiKey"] == nil)
        storage.saveSettings(settings)
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
