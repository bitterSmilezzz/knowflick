import Foundation
import Testing
@testable import KnowFlickCore

struct CardTransferServiceTests {
    private func cards(_ count: Int) -> [KnowledgeCard] {
        (0..<count).map { index in
            KnowledgeCard(category: "学习", headline: "笔记编号 \(index)", summary: "内容摘要", details: String(repeating: "完整正文", count: 500),
                          source: .imported, createdAt: Date(timeIntervalSince1970: 1_000_000))
        }
    }

    @Test func previewIsBoundedWhileFullCopyIncludesTheTail() async throws {
        let subjects = cards(12)
        for format in CardExportFormat.allCases {
            let preview = try await CardTransferService.preview(cards: subjects, format: format, totalCount: subjects.count)
            #expect(preview.count < 2000)
            #expect(preview.contains("共 12 张"))
            #expect(!preview.contains("笔记编号 11"))
            let full = try await CardTransferService.content(cards: subjects, format: format)
            #expect(full.contains("笔记编号 11"))
            #expect(full.count > preview.count)
        }
    }

    @Test func backgroundArchiveWriteAndReadPreserveAllCards() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: directory) }
        let subjects = cards(400)
        let destination = directory.appendingPathComponent("backup.json")
        _ = try await CardTransferService.save(cards: subjects, format: .jsonArchive, to: destination)
        let text = try await CardTransferService.readNote(at: destination)
        let restored = try await CardTransferService.parse(text, fileName: "backup.json")
        #expect(restored == subjects)
    }

    @Test func invalidJSONAndFileErrorsReachTheCaller() async {
        do {
            _ = try await CardTransferService.parse("{invalid", fileName: "note.json")
            Issue.record("Malformed JSON must not become Markdown cards")
        } catch { #expect(!(error is CancellationError)) }
        do {
            let missing = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("out.json")
            _ = try await CardTransferService.save(cards: cards(1), format: .jsonArchive, to: missing)
            Issue.record("A failed write must not report success")
        } catch { #expect(!(error is CancellationError)) }
    }

    @Test @MainActor func cancelledRequestDoesNotStartWriting() async {
        let destination = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).json")
        let subjects = cards(1)
        let task = Task { @MainActor in
            try await CardTransferService.save(cards: subjects, format: .jsonArchive, to: destination)
        }
        task.cancel()
        do {
            _ = try await task.value
            Issue.record("Cancelled request must throw")
        } catch { #expect(error is CancellationError) }
        #expect(!FileManager.default.fileExists(atPath: destination.path))
    }
}
