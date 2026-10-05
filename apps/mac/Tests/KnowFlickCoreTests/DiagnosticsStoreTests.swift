import XCTest
@testable import KnowFlickCore

/// 本地诊断日志仓（Wave D1）的纯逻辑测试：
/// 文件命名 / JSONL 追加 / 清点 / 清理与清空。MetricKit 侧只消费编码后的 JSON，
/// 因此全部用合成数据驱动，不依赖系统框架。
final class DiagnosticsStoreTests: XCTestCase {
    private var root: URL!
    private var store: DiagnosticsStore!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("kf-diagnostics-tests-\(UUID().uuidString)", isDirectory: true)
        store = DiagnosticsStore(directory: root)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    private func fixedDate(_ year: Int, _ month: Int, _ day: Int = 15) -> Date {
        var comps = DateComponents()
        comps.year = year; comps.month = month; comps.day = day; comps.hour = 8
        return Calendar(identifier: .gregorian).date(from: comps)!
    }

    private func readLines(_ name: String) throws -> [[String: Any]] {
        let url = root.appendingPathComponent(name)
        let raw = try String(contentsOf: url, encoding: .utf8)
        return try raw.split(separator: "\n").map {
            try JSONSerialization.jsonObject(with: Data($0.utf8)) as! [String: Any]
        }
    }

    // MARK: 文件命名

    func testFileNameUsesMonthBucketWithPOSIXFormat() {
        XCTAssertEqual(DiagnosticsStore.fileName(kind: "metrics", for: fixedDate(2026, 10)), "metrics-2026-10.jsonl")
        XCTAssertEqual(DiagnosticsStore.fileName(kind: "diagnostics", for: fixedDate(2026, 1)), "diagnostics-2026-01.jsonl")
    }

    // MARK: 追加

    func testAppendCreatesMonthlyFileAndAppendsOneLinePerPayload() throws {
        let oct15 = fixedDate(2026, 10)
        let oct20 = fixedDate(2026, 10, 20)
        try store.append(payloadJSON: Data(#"{"hangDuration":1.5}"#.utf8), kind: "diagnostics", receivedAt: oct15)
        try store.append(payloadJSON: Data(#"{"hangDuration":2.0}"#.utf8), kind: "diagnostics", receivedAt: oct20)

        let lines = try readLines("diagnostics-2026-10.jsonl")
        XCTAssertEqual(lines.count, 2)
        XCTAssertEqual(lines[0]["hangDuration"] as? Double, 1.5)
        XCTAssertEqual(lines[0]["kind"] as? String, "diagnostics")
        XCTAssertNotNil(lines[0]["receivedAt"] as? String)
    }

    func testAppendSeparatesKindsIntoDifferentFiles() throws {
        try store.append(payloadJSON: Data(#"{"a":1}"#.utf8), kind: "metrics", receivedAt: fixedDate(2026, 10))
        try store.append(payloadJSON: Data(#"{"b":2}"#.utf8), kind: "diagnostics", receivedAt: fixedDate(2026, 10))
        XCTAssertEqual(try readLines("metrics-2026-10.jsonl").count, 1)
        XCTAssertEqual(try readLines("diagnostics-2026-10.jsonl").count, 1)
    }

    func testJSONLineWrapsNonObjectPayload() throws {
        let line = try DiagnosticsStore.jsonLine(kind: "metrics", receivedAt: fixedDate(2026, 10), payload: Data("42".utf8))
        let object = try JSONSerialization.jsonObject(with: line) as! [String: Any]
        XCTAssertEqual(object["payload"] as? Int, 42)
        XCTAssertEqual(object["kind"] as? String, "metrics")
    }

    // MARK: 清点

    func testSummaryCountsFilesBytesAndLastModified() throws {
        XCTAssertEqual(store.summary().fileCount, 0)
        try store.append(payloadJSON: Data(#"{"a":1}"#.utf8), kind: "metrics", receivedAt: fixedDate(2026, 9))
        try store.append(payloadJSON: Data(#"{"b":2}"#.utf8), kind: "metrics", receivedAt: fixedDate(2026, 10))
        let summary = store.summary()
        XCTAssertEqual(summary.fileCount, 2)
        XCTAssertGreaterThan(summary.totalBytes, 0)
        XCTAssertNotNil(summary.lastModified)
    }

    // MARK: 超期清理

    func testPruneStaleFilesRemovesOnlyExpiredMonths() throws {
        let now = fixedDate(2026, 10)
        try store.append(payloadJSON: Data(#"{"old":true}"#.utf8), kind: "diagnostics", receivedAt: fixedDate(2026, 5))
        try store.append(payloadJSON: Data(#"{"fresh":true}"#.utf8), kind: "diagnostics", receivedAt: fixedDate(2026, 10))
        // 5 月文件的真实修改时间就是现在，需把修改时间拨回 90 天前才会被判定超期
        let oldURL = root.appendingPathComponent("diagnostics-2026-05.jsonl")
        try FileManager.default.setAttributes(
            [.modificationDate: now.addingTimeInterval(-Double(DiagnosticsStore.retentionDays + 1) * 24 * 3600)],
            ofItemAtPath: oldURL.path
        )

        store.pruneStaleFiles(now: now)
        XCTAssertFalse(FileManager.default.fileExists(atPath: oldURL.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("diagnostics-2026-10.jsonl").path))
    }

    // MARK: 清空

    func testClearRemovesAllDiagnosticsFiles() throws {
        try store.append(payloadJSON: Data(#"{"a":1}"#.utf8), kind: "metrics", receivedAt: fixedDate(2026, 9))
        try store.append(payloadJSON: Data(#"{"b":2}"#.utf8), kind: "diagnostics", receivedAt: fixedDate(2026, 10))
        try store.clear()
        XCTAssertEqual(store.summary().fileCount, 0)
    }
}
