import Foundation
import Testing
@testable import KnowFlickCore

struct PersistenceFeedbackTests {
    private func card() -> KnowledgeCard {
        KnowledgeCard(category: "学习", headline: "保存验证", summary: "摘要", details: "正文", source: .imported,
                      createdAt: Date(timeIntervalSince1970: 1_000_000))
    }

    @Test func backupFailureDoesNotHideSuccessfulPrimarySave() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let storage = Storage(baseDir: directory)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory.appendingPathComponent("cards.backup.json"), withIntermediateDirectories: false)
        let subject = card()
        guard case .savedWithoutBackup = storage.saveCards([subject]) else {
            Issue.record("Expected a separate backup warning")
            return
        }
        #expect(storage.loadCards() == [subject])
    }

    @Test @MainActor func failedSaveKeepsMemoryAndRetryClearsWarning() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let storage = Storage(baseDir: directory)
        let store = AppStore(storage: storage)
        defer { store.flushPersistence(); try? FileManager.default.removeItem(at: directory) }
        let obstruction = directory.appendingPathComponent("cards.json")
        try FileManager.default.createDirectory(at: obstruction, withIntermediateDirectories: false)
        let subject = card()
        store.cards = [subject]
        store.flushPersistence()
        #expect(store.persistenceWarning?.contains("尚未保存") == true)
        #expect(store.cards == [subject])

        // Remove only the empty obstruction created by this test.
        try FileManager.default.removeItem(at: obstruction)
        store.retryPersistence()
        let deadline = ContinuousClock.now.advanced(by: .seconds(3))
        while store.persistenceWarning != nil && ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(25))
        }
        #expect(store.persistenceWarning == nil)
        #expect(storage.loadCards() == [subject])
    }
}
