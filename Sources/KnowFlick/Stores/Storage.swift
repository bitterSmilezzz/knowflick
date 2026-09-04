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
        let url = fileURL("cards.json")
        guard let data = try? Data(contentsOf: url) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        if let cards = try? decoder.decode([KnowledgeCard].self, from: data), !cards.isEmpty {
            return cards
        }
        // 主文件损坏 → 尝试上一次备份
        let backup = fileURL("cards.backup.json")
        if let bdata = try? Data(contentsOf: backup),
           let cards = try? decoder.decode([KnowledgeCard].self, from: bdata), !cards.isEmpty {
            NSLog("KnowFlick: cards.json 损坏，已从备份恢复 %d 张卡片", cards.count)
            saveCards(cards)
            return cards
        }
        // 备份也没有 → 把损坏文件挪开，首启重新播种
        NSLog("KnowFlick: 卡片数据不可恢复，将重新初始化")
        try? FileManager.default.removeItem(at: url)
        try? FileManager.default.removeItem(at: backup)
        return []
    }

    static func saveCards(_ cards: [KnowledgeCard]) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(cards) else { return }
        let url = fileURL("cards.json")
        // 原子写主文件，并把旧版本轮转进备份
        if FileManager.default.fileExists(atPath: url.path) {
            try? FileManager.default.copyItem(at: url, to: fileURL("cards.backup.json"))
        }
        try? data.write(to: url, options: .atomic)
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
