import XCTest
@testable import KnowFlickCore

final class StorageTests: XCTestCase {
    private var tempDir: URL!
    private var storage: Storage!

    override func setUp() {
        super.setUp()
        tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("KnowFlickTests-\(UUID().uuidString)", isDirectory: true)
        storage = Storage(baseDir: tempDir)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: tempDir)
        super.tearDown()
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

    func testSaveLoadRoundTrip() {
        let cards = [makeCard("往返测试")]
        storage.saveCards(cards)
        XCTAssertEqual(storage.loadCards().map(\.headline), ["往返测试"])
    }

    func testLoadMissingReturnsEmpty() {
        XCTAssertTrue(storage.loadCards().isEmpty)
        XCTAssertFalse(storage.hasSeeded())
    }

    // MARK: - 备份轮转（C1 核心回归）

    func testBackupRotationKeepsPreviousVersion() {
        storage.saveCards([makeCard("第一版")])
        storage.saveCards([makeCard("第二版")])
        storage.saveCards([makeCard("第三版")])

        let backupURL = tempDir.appendingPathComponent("cards.backup.json")
        XCTAssertTrue(FileManager.default.fileExists(atPath: backupURL.path), "备份文件应存在")

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let backup = try! decoder.decode([KnowledgeCard].self, from: Data(contentsOf: backupURL))
        // 关键断言：备份必须是「上一版」（第二版），而不是停在第一次保存的残影
        XCTAssertEqual(backup.map(\.headline), ["第二版"])
    }

    func testLoadFromBackupWhenMainCorrupted() {
        storage.saveCards([makeCard("健康版")])
        // 主文件写坏
        try! writeMain(Data("{ not valid json".utf8))

        let loaded = storage.loadCards()
        XCTAssertEqual(loaded.map(\.headline), ["健康版"])
        // 恢复后主文件应被重建为健康内容
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let main = try! decoder.decode([KnowledgeCard].self, from: Data(contentsOf: tempDir.appendingPathComponent("cards.json")))
        XCTAssertEqual(main.map(\.headline), ["健康版"])
    }

    func testLoadFromBackupWhenMainEmptyArray() {
        storage.saveCards([makeCard("内容卡")])
        try! writeMain(encodeCards([]))   // 空数组视为损坏
        XCTAssertEqual(storage.loadCards().map(\.headline), ["内容卡"])
    }

    func testReseedWhenBothCorrupted() {
        try! writeMain(Data("{ bad".utf8))
        try! Data("{ also bad".utf8).write(to: tempDir.appendingPathComponent("cards.backup.json"))
        XCTAssertTrue(storage.loadCards().isEmpty)
        // 损坏文件被清走，下次可重新播种
        XCTAssertFalse(FileManager.default.fileExists(atPath: tempDir.appendingPathComponent("cards.json").path))
    }

    // MARK: - 设置

    func testSettingsRoundTrip() {
        var settings = AISettings.default
        settings.model = "deepseek-reasoner"
        settings.categoryFilter = "物理, 天文"
        storage.saveSettings(settings)
        XCTAssertEqual(storage.loadSettings(), settings)
    }
}
