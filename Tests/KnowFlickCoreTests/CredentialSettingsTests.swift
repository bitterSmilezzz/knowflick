import Foundation
import Testing
@testable import KnowFlickCore

@MainActor
private final class MemoryCredentials: CredentialStore {
    var values: [String: String] = [:]
    var rejectDeletion = false
    func read(account: String) -> String? { values[account] }
    func save(_ value: String, account: String) throws { values[account] = value }
    func delete(account: String) throws {
        if rejectDeletion { throw KeychainHelper.KeychainError.deleteFailed(-1) }
        values.removeValue(forKey: account)
    }
}

@MainActor
struct CredentialSettingsTests {
    @Test func clearedAndRemovedSpeechKeysStayDeletedAfterRestart() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let storage = Storage(baseDir: directory)
        let credentials = MemoryCredentials()
        let store = AppStore(storage: storage, credentials: credentials)
        defer { store.flushPersistence() }
        var settings = store.settings
        settings.autoGenerate = false
        settings.apiKey = "chat-secret"
        settings.speech.profiles[0].apiKey = "  cloud-secret  "
        settings.speech.profiles[1].apiKey = "local-secret"
        try store.saveSettings(settings)
        #expect(credentials.values["tts.siliconflow"] == "cloud-secret")
        settings = store.settings
        settings.speech.profiles[0].apiKey = " \n "
        settings.speech.profiles.removeLast()
        try store.saveSettings(settings)
        #expect(credentials.values["tts.siliconflow"] == nil)
        #expect(credentials.values["tts.kokoro"] == nil)
        #expect(credentials.values["apiKey"] == "chat-secret")
        let restarted = AppStore(storage: storage, credentials: credentials)
        await restarted.bootstrap()
        defer { restarted.flushPersistence() }
        #expect(restarted.settings.speech.profiles.count == 1)
        #expect(restarted.settings.speech.profiles[0].apiKey.isEmpty)
        #expect(restarted.settings.apiKey == "chat-secret")
    }

    @Test func failedKeyDeletionDoesNotCommitSettings() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let storage = Storage(baseDir: directory)
        let credentials = MemoryCredentials()
        let store = AppStore(storage: storage, credentials: credentials)
        var settings = store.settings
        settings.speech.profiles[0].apiKey = "keep-me"
        try store.saveSettings(settings)
        credentials.rejectDeletion = true
        settings.speech.profiles[0].apiKey = ""
        #expect(throws: (any Error).self) { try store.saveSettings(settings) }
        #expect(store.settings.speech.profiles[0].apiKey == "keep-me")
        #expect(credentials.values["tts.siliconflow"] == "keep-me")
    }
}
