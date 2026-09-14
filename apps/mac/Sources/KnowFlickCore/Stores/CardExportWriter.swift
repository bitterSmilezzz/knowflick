import Foundation

public enum CardExportWriter {
    /// Each export owns a new folder; existing user notes are never overwritten.
    public static func writeObsidian(cards: [KnowledgeCard], into parent: URL) throws -> URL {
        try Task.checkCancellation()
        let files = CardExportEngine.exportObsidianFiles(cards: cards)
        try Task.checkCancellation()
        let directory = parent.appendingPathComponent("KnowFlick-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        do {
            for file in files {
                try Task.checkCancellation()
                try Data(file.content.utf8).write(to: directory.appendingPathComponent(file.filename), options: .withoutOverwriting)
            }
            return directory
        } catch {
            // Only this newly created export folder is eligible for cleanup.
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
    }
}
