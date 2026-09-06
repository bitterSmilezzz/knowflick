import Foundation

/// 本地 JSON 存储：卡片池、历史记录、设置
/// 可注入目录以便测试；默认落在 ~/Library/Application Support/KnowFlick/
public struct Storage {
    private let baseDir: URL
    private let fileManager = FileManager.default

    /// 默认存储目录（Application Support/KnowFlick）
    public init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        self.init(baseDir: base.appendingPathComponent("KnowFlick", isDirectory: true))
    }

    /// 测试用：指定目录
    public init(baseDir: URL) {
        self.baseDir = baseDir
        try? FileManager.default.createDirectory(at: baseDir, withIntermediateDirectories: true)
    }

    private func fileURL(_ name: String) -> URL {
        baseDir.appendingPathComponent(name)
    }

    // MARK: - 卡片库

    /// 加载卡片：主文件 → 备份 → 重播种三级回退
    public func loadCards() -> [KnowledgeCard] {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let url = fileURL("cards.json")
        if let data = try? Data(contentsOf: url),
           let cards = try? decoder.decode([KnowledgeCard].self, from: data),
           !cards.isEmpty {
            return cards
        }
        // 主文件缺失/损坏 → 尝试备份
        let backup = fileURL("cards.backup.json")
        if let bdata = try? Data(contentsOf: backup),
           let cards = try? decoder.decode([KnowledgeCard].self, from: bdata),
           !cards.isEmpty {
            NSLog("KnowFlick: cards.json 损坏，已从备份恢复 %d 张卡片", cards.count)
            saveCards(cards)
            return cards
        }
        // 备份也没有 → 把损坏文件挪开，首启重新播种
        if (try? Data(contentsOf: url)) != nil || (try? Data(contentsOf: backup)) != nil {
            NSLog("KnowFlick: 卡片数据不可恢复，将重新初始化")
        }
        try? fileManager.removeItem(at: url)
        try? fileManager.removeItem(at: backup)
        return []
    }

    /// 保存卡片：原子写主文件，并把旧主文件轮转进备份（先删旧备份，保证轮转真正生效）
    public func saveCards(_ cards: [KnowledgeCard]) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(cards) else {
            NSLog("KnowFlick: 卡片编码失败，未落盘")
            return
        }
        let url = fileURL("cards.json")
        let backup = fileURL("cards.backup.json")
        if fileManager.fileExists(atPath: url.path) {
            // copyItem 在目标已存在时会直接失败（实测 NSFileWriteFileExistsError）——先移除旧备份再复制
            try? fileManager.removeItem(at: backup)
            do {
                try fileManager.copyItem(at: url, to: backup)
            } catch {
                NSLog("KnowFlick: 备份轮转失败: %@", error.localizedDescription)
            }
        }
        do {
            try data.write(to: url, options: .atomic)
        } catch {
            NSLog("KnowFlick: 卡片落盘失败: %@", error.localizedDescription)
        }
    }

    // MARK: - 设置（key 除外）

    public func loadSettings() -> AISettings {
        guard let data = try? Data(contentsOf: fileURL("settings.json")),
              let s = try? JSONDecoder().decode(AISettings.self, from: data) else {
            return .default
        }
        return s
    }

    public func saveSettings(_ settings: AISettings) {
        if let data = try? JSONEncoder().encode(settings) {
            try? data.write(to: fileURL("settings.json"), options: .atomic)
        }
    }

    // MARK: - 首启标记

    public func hasSeeded() -> Bool {
        fileManager.fileExists(atPath: fileURL("cards.json").path)
    }
}
