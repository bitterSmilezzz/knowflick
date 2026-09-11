import Foundation
import Testing
@testable import KnowFlickCore

struct PersistenceFeedbackTests {
    private func card() -> KnowledgeCard {
        KnowledgeCard(category: "学习", headline: "保存验证", summary: "摘要", details: "正文", source: .imported,
                      createdAt: Date(timeIntervalSince1970: 1_000_000))
    }

    @Test func settingsAndChatWritesExposeFailures() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let storage = Storage(baseDir: directory)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory.appendingPathComponent("settings.json"), withIntermediateDirectories: false)
        do {
            try storage.saveSettingsThrowing(.default)
            Issue.record("Settings write should expose a filesystem error")
        } catch { #expect(error is StorageWriteError) }

        let chat = CardChatSession(cardId: UUID(), cardHeadline: "保存验证")
        try? FileManager.default.removeItem(at: directory.appendingPathComponent("settings.json"))
        try FileManager.default.createDirectory(at: directory.appendingPathComponent("chat_sessions.json"), withIntermediateDirectories: false)
        do {
            try storage.saveChatSessionThrowing(chat)
            Issue.record("Chat write should expose a filesystem error")
        } catch { #expect(error is StorageWriteError) }
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
        // 等待防抖写入完成；超时保护避免慢机器上的误报，同时不阻塞主线程。
        let deadline = ContinuousClock.now.advanced(by: .seconds(3))
        while store.persistenceWarning != nil && ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(25))
        }
        #expect(store.persistenceWarning == nil)
        #expect(storage.loadCards() == [subject])
    }
}
