import Foundation

public enum CardSaveResult: Sendable {
    case saved
    case failed(String)
    case savedWithoutBackup(String)
}

public enum StorageWriteError: LocalizedError, Sendable {
    case encoding(String)
    case writing(String)

    public var errorDescription: String? {
        switch self {
        case .encoding(let message): return "数据编码失败：\(message)"
        case .writing(let message): return "本地文件写入失败：\(message)"
        }
    }
}

/// 本地 JSON 存储：卡片池、历史记录、设置
/// 可注入目录以便测试；默认落在 ~/Library/Application Support/KnowFlick/
public struct Storage: Sendable {
    private let baseDir: URL
    private var fileManager: FileManager { .default }

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
        // 备份也没有 → 保留损坏文件副本后再重新播种，避免静默抹掉用户最后的恢复线索。
        if (try? Data(contentsOf: url)) != nil || (try? Data(contentsOf: backup)) != nil {
            NSLog("KnowFlick: 卡片数据不可恢复，将重新初始化")
        }
        quarantineIfPresent(url)
        quarantineIfPresent(backup)
        return []
    }

    private func quarantineIfPresent(_ url: URL) {
        guard fileManager.fileExists(atPath: url.path) else { return }
        // 目录/特殊节点可能是写入冲突模拟或权限问题，不能移动它们来掩盖真正的写入失败。
        guard (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else { return }
        let stamp = Int(Date().timeIntervalSince1970)
        let target = url.deletingPathExtension()
            .appendingPathExtension("corrupt-\(stamp)-\(UUID().uuidString.prefix(8))")
        do { try fileManager.moveItem(at: url, to: target) }
        catch { NSLog("KnowFlick: 无法保留损坏文件 %@: %@", url.path, error.localizedDescription) }
    }

    /// 保存卡片：原子写主文件，并把旧主文件轮转进备份（先删旧备份，保证轮转真正生效）
    @discardableResult
    public func saveCards(_ cards: [KnowledgeCard]) -> CardSaveResult {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(cards) else {
            NSLog("KnowFlick: 卡片编码失败，未落盘")
            return .failed("卡片编码失败")
        }
        let url = fileURL("cards.json")
        let backup = fileURL("cards.backup.json")
        // 只轮转可解码的健康主文件；恢复备份时不能用损坏内容覆盖它。
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let previous = try? Data(contentsOf: url)
        let previousCards = previous.flatMap { try? decoder.decode([KnowledgeCard].self, from: $0) }
        let backupData = (previousCards?.isEmpty == false) ? (previous ?? data) : data
        var backupError: String?
        do {
            try backupData.write(to: backup, options: .atomic)
        } catch {
            backupError = error.localizedDescription
            NSLog("KnowFlick: 备份轮转失败: %@", error.localizedDescription)
        }
        do {
            try data.write(to: url, options: .atomic)
        } catch {
            NSLog("KnowFlick: 卡片落盘失败: %@", error.localizedDescription)
            return .failed(error.localizedDescription)
        }
        if let backupError { return .savedWithoutBackup(backupError) }
        return .saved
    }

    // MARK: - 设置（key 除外）

    public func loadSettings() -> AISettings {
        let url = fileURL("settings.json")
        guard fileManager.fileExists(atPath: url.path) else {
            return .default
        }
        do {
            let data = try Data(contentsOf: url)
            return try JSONDecoder().decode(AISettings.self, from: data)
        } catch {
            NSLog("KnowFlick: settings.json 损坏，将保留隔离副本: %@", error.localizedDescription)
            quarantineIfPresent(url)
            return .default
        }
    }

    public func saveSettings(_ settings: AISettings) {
        try? saveSettingsThrowing(settings)
    }

    public func saveSettingsThrowing(_ settings: AISettings) throws {
        let data: Data
        do { data = try JSONEncoder().encode(settings) }
        catch { throw StorageWriteError.encoding(error.localizedDescription) }
        do { try data.write(to: fileURL("settings.json"), options: .atomic) }
        catch { throw StorageWriteError.writing(error.localizedDescription) }
    }

    // MARK: - 首启标记

    public func hasSeeded() -> Bool {
        fileManager.fileExists(atPath: fileURL("cards.json").path)
    }

    // MARK: - 卡片追问会话 (Card Chat Sessions)

    public func loadChatSessions() -> [UUID: CardChatSession] {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let url = fileURL("chat_sessions.json")
        guard fileManager.fileExists(atPath: url.path) else {
            return [:]
        }
        let list: [CardChatSession]
        do {
            let data = try Data(contentsOf: url)
            list = try decoder.decode([CardChatSession].self, from: data)
        } catch {
            NSLog("KnowFlick: chat_sessions.json 损坏，将保留隔离副本: %@", error.localizedDescription)
            quarantineIfPresent(url)
            return [:]
        }
        var dict: [UUID: CardChatSession] = [:]
        for session in list {
            dict[session.cardId] = session
        }
        return dict
    }

    public func loadChatSession(for cardId: UUID) -> CardChatSession? {
        loadChatSessions()[cardId]
    }

    public func saveChatSession(_ session: CardChatSession) {
        try? saveChatSessionThrowing(session)
    }

    public func saveChatSessionThrowing(_ session: CardChatSession) throws {
        var sessions = loadChatSessions()
        sessions[session.cardId] = session
        let list = Array(sessions.values)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data: Data
        do { data = try encoder.encode(list) }
        catch { throw StorageWriteError.encoding(error.localizedDescription) }
        do { try data.write(to: fileURL("chat_sessions.json"), options: .atomic) }
        catch { throw StorageWriteError.writing(error.localizedDescription) }
    }

    public func clearChatSession(for cardId: UUID) {
        try? clearChatSessionThrowing(for: cardId)
    }

    public func clearChatSessionThrowing(for cardId: UUID) throws {
        var sessions = loadChatSessions()
        sessions.removeValue(forKey: cardId)
        let list = Array(sessions.values)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data: Data
        do { data = try encoder.encode(list) }
        catch { throw StorageWriteError.encoding(error.localizedDescription) }
        do { try data.write(to: fileURL("chat_sessions.json"), options: .atomic) }
        catch { throw StorageWriteError.writing(error.localizedDescription) }
    }
}
