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
    // 加载期检测到损坏后置位：下次轮转备份前先解码校验旧主文件，避免坏字节污染备份。
    // 常态跳过全量解码（每次落盘省一整轮 JSON decode）；保存成功后复位。
    // 另记录「最近一次 loadCards 是否拿到了可用卡片库」，供 AppStore 区分「合法空库」与「无库」（见 loadCards）。
    private let state = StorageStateBox()

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

    /// 最近一次 `loadCards()` 是否拿到了**可用**的卡片库：非空恢复，或一个合法的空数组。
    /// `false` 只代表「主文件与备份都不可用」（首次启动 / 真损坏），此时才允许用预置库重新播种。
    var libraryWasUsable: Bool { state.libraryUsable }

    /// 线程安全状态盒（Storage 为值类型，用引用盒跨副本共享）
    private final class StorageStateBox: @unchecked Sendable {
        private let lock = NSLock()
        private var corruption = false
        private var usable = false

        var corruptionFlag: Bool {
            lock.lock(); defer { lock.unlock() }
            return corruption
        }

        func setCorruptionFlag(_ newValue: Bool) {
            lock.lock(); corruption = newValue; lock.unlock()
        }

        var libraryUsable: Bool {
            lock.lock(); defer { lock.unlock() }
            return usable
        }

        func setLibraryUsable(_ newValue: Bool) {
            lock.lock(); usable = newValue; lock.unlock()
        }
    }

    // MARK: - 卡片库

    /// 加载卡片：主文件 → 备份 → 重播种三级回退。
    ///
    /// 判据是「**解码成功即视为有效**」，合法的空数组 `[]` 是用户状态（用户清空过卡片库），不是损坏：
    /// 旧实现用 `!cards.isEmpty` 守卫把两者混为一谈，一个合法空库会被隔离，随后 `bootstrap` 用预置库覆盖，
    /// 用户看到的是「卡片全没了，还多出一堆预置卡」。
    /// 空数组仍会先尝试备份——旧版本曾在 bootstrap 未完成时把 `[]` 写进主文件，真正的卡片只留在备份里；
    /// 只有备份也不可用时才承认这是一次合法的空库加载，此时**不隔离任何文件**。
    public func loadCards() -> [KnowledgeCard] {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let url = fileURL("cards.json")
        let backup = fileURL("cards.backup.json")

        if let data = try? Data(contentsOf: url),
           let cards = try? decoder.decode([KnowledgeCard].self, from: data),
           !cards.isEmpty {
            state.setLibraryUsable(true)
            return cards
        }
        // 主文件缺失/损坏，或是一个空的合法数组 → 尝试备份
        if let restored = restoredFromBackup(decoder: decoder, backup: backup) {
            return restored
        }
        if let data = try? Data(contentsOf: url), (try? decoder.decode([KnowledgeCard].self, from: data)) != nil {
            // 主文件是合法的空数组，且备份里也没有可挽救的内容 → 这是一次合法的空卡片库：
            // 不隔离、不重播种，如实返回空库（落盘守卫已保证这种内容只在用户真正清空时才出现）
            state.setLibraryUsable(true)
            NSLog("KnowFlick: cards.json 是合法的空卡片库，按空库加载")
            return []
        }
        // 主文件与备份都不可用 → 保留损坏文件副本后再重新播种，避免静默抹掉用户最后的恢复线索。
        if (try? Data(contentsOf: url)) != nil || (try? Data(contentsOf: backup)) != nil {
            NSLog("KnowFlick: 卡片数据不可恢复，将重新初始化")
        }
        state.setLibraryUsable(false)
        state.setCorruptionFlag(true)
        quarantineIfPresent(url)
        quarantineIfPresent(backup)
        return []
    }

    /// 从备份恢复非空卡片库（并重建主文件）；备份不可用或为空时返回 nil。
    private func restoredFromBackup(decoder: JSONDecoder, backup: URL) -> [KnowledgeCard]? {
        guard let data = try? Data(contentsOf: backup),
              let cards = try? decoder.decode([KnowledgeCard].self, from: data),
              !cards.isEmpty else { return nil }
        NSLog("KnowFlick: cards.json 不可用，已从备份恢复 %d 张卡片", cards.count)
        state.setCorruptionFlag(true)
        state.setLibraryUsable(true)
        saveCards(cards)
        return cards
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
        // 备份内容 = 上一版主文件字节。常态直接轮转原始字节（零解码开销）；
        // 仅当加载期发现过损坏时才解码校验，避免把坏字节转进备份。
        let previous = try? Data(contentsOf: url)
        let backupData: Data
        if let previous {
            if state.corruptionFlag {
                let decoder = JSONDecoder()
                decoder.dateDecodingStrategy = .iso8601
                let previousCards = try? decoder.decode([KnowledgeCard].self, from: previous)
                backupData = (previousCards?.isEmpty == false) ? previous : data
            } else {
                backupData = previous
            }
        } else {
            backupData = data
        }
        var backupError: String?
        do {
            try backupData.write(to: backup, options: .atomic)
        } catch {
            backupError = error.localizedDescription
            NSLog("KnowFlick: 备份轮转失败: %@", error.localizedDescription)
        }
        do {
            try data.write(to: url, options: .atomic)
            state.setCorruptionFlag(false)   // 主文件已是本进程写出的健康内容
            state.setLibraryUsable(true)     // 本进程此后写出的都是可信的卡片库（含合法空数组）
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

    // MARK: - 搜索历史 (Search History)

    public func loadSearchHistory() -> [String] {
        let url = fileURL("search_history.json")
        guard fileManager.fileExists(atPath: url.path) else { return [] }
        do {
            let data = try Data(contentsOf: url)
            return try JSONDecoder().decode([String].self, from: data)
        } catch {
            return []
        }
    }

    public func saveSearchHistoryThrowing(_ history: [String]) throws {
        let data: Data
        do { data = try JSONEncoder().encode(history) }
        catch { throw StorageWriteError.encoding(error.localizedDescription) }
        do { try data.write(to: fileURL("search_history.json"), options: .atomic) }
        catch { throw StorageWriteError.writing(error.localizedDescription) }
    }
}
