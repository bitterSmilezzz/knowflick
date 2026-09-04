import Foundation

/// 本地 JSON 存储：卡片池、历史记录、设置
struct Storage {
    private static var appDir: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = base.appendingPathComponent("KnowFlick", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private static func fileURL(_ name: String) -> URL {
        appDir.appendingPathComponent(name)
    }

    // MARK: - 卡片库

    static func loadCards() -> [KnowledgeCard] {
        guard let data = try? Data(contentsOf: fileURL("cards.json")) else { return [] }
        return (try? JSONDecoder().decode([KnowledgeCard].self, from: data)) ?? []
    }

    static func saveCards(_ cards: [KnowledgeCard]) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        if let data = try? encoder.encode(cards) {
            try? data.write(to: fileURL("cards.json"), options: .atomic)
        }
    }

    // MARK: - 设置（key 除外）

    static func loadSettings() -> AISettings {
        guard let data = try? Data(contentsOf: fileURL("settings.json")),
              let s = try? JSONDecoder().decode(AISettings.self, from: data) else {
            return .default
        }
        return s
    }

    static func saveSettings(_ settings: AISettings) {
        if let data = try? JSONEncoder().encode(settings) {
            try? data.write(to: fileURL("settings.json"), options: .atomic)
        }
    }

    // MARK: - 首启标记

    static func hasSeeded() -> Bool {
        FileManager.default.fileExists(atPath: fileURL("cards.json").path)
    }
}
