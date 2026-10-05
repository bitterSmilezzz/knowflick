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
    /// 追问会话内存表（Wave C2）：值类型 Storage 的各副本共享同一张表（引用盒），
    /// 每个 init 一份——不同 baseDir 的实例互不串缓存。见 `ChatSessionTable`。
    private let chatTable = ChatSessionTable()

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

    /// 追问会话内存表（Wave C2）：读一次、之后每次落盘只做全量 encode。
    ///
    /// 为什么用引用盒：`Storage` 是值类型，`AppStore` / `ChatSessionStore` 与测试各自持有副本，
    /// 只有盒能让所有副本看到同一张表；每个 `Storage.init` 生成独立盒子，不同 baseDir 不串缓存。
    private final class ChatSessionTable: @unchecked Sendable {
        /// 磁盘指纹：存在性 + 修改时间 + 大小。用来感知「文件刚出现 / 别的实例刚写过」，
        /// 每次访问只做 stat、不解码；指纹未变就完全复用内存表（这是「读一次」的判据）。
        struct FileStamp: Equatable {
            let exists: Bool
            let modified: Date?
            let size: Int?
        }

        struct State {
            var loaded = false
            var sessions: [UUID: CardChatSession] = [:]
            var stamp: FileStamp?
            /// 全量读盘次数（测试护栏：每条消息的落盘不得再触发 decode）
            var decodeCount = 0
        }

        private let lock = NSLock()
        private var state = State()

        func withLock<T>(_ body: (inout State) throws -> T) rethrows -> T {
            lock.lock()
            defer { lock.unlock() }
            return try body(&state)
        }
    }

    // MARK: - 卡片库

    /// 加载卡片：主文件 → 备份（三代）→ 重播种四级回退。
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
        let backup2 = fileURL("cards.backup.2.json")

        if let data = try? Data(contentsOf: url),
           let cards = try? decoder.decode([KnowledgeCard].self, from: data),
           !cards.isEmpty {
            state.setLibraryUsable(true)
            return cards
        }
        // 主文件缺失/损坏，或是一个空的合法数组 → 依次尝试两代备份
        if let restored = restoredFromBackup(decoder: decoder, backups: [backup, backup2]) {
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
        if (try? Data(contentsOf: url)) != nil || (try? Data(contentsOf: backup)) != nil || (try? Data(contentsOf: backup2)) != nil {
            NSLog("KnowFlick: 卡片数据不可恢复，将重新初始化")
        }
        state.setLibraryUsable(false)
        state.setCorruptionFlag(true)
        quarantineIfPresent(url)
        quarantineIfPresent(backup)
        quarantineIfPresent(backup2)
        return []
    }

    /// 从备份恢复非空卡片库（并重建主文件）；两代备份都不可用或为空时返回 nil。
    private func restoredFromBackup(decoder: JSONDecoder, backups: [URL]) -> [KnowledgeCard]? {
        for backup in backups {
            guard let data = try? Data(contentsOf: backup),
                  let cards = try? decoder.decode([KnowledgeCard].self, from: data),
                  !cards.isEmpty else { continue }
            NSLog("KnowFlick: cards.json 不可用，已从备份恢复 %d 张卡片", cards.count)
            state.setCorruptionFlag(true)
            state.setLibraryUsable(true)
            saveCards(cards)
            return cards
        }
        return nil
    }

    private func quarantineIfPresent(_ url: URL) {
        guard fileManager.fileExists(atPath: url.path) else { return }
        // 目录/特殊节点可能是写入冲突模拟或权限问题，不能移动它们来掩盖真正的写入失败。
        guard (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else { return }
        let stamp = Int(Date().timeIntervalSince1970)
        let target = url.deletingPathExtension()
            .appendingPathExtension("corrupt-\(stamp)-\(UUID().uuidString.prefix(8))")
        do {
            try fileManager.moveItem(at: url, to: target)
            pruneQuarantineCopies()
        } catch {
            NSLog("KnowFlick: 无法保留损坏文件 %@: %@", url.path, error.localizedDescription)
        }
    }

    /// 隔离副本上限（B7）：`*.corrupt-*` 超过 10 个删最老（按修改时间），
    /// 防止长期损坏循环把 store 目录塞满。刚隔离的副本时间最新，不会被本轮裁掉。
    static let quarantineCopyLimit = 10

    private func pruneQuarantineCopies() {
        let contents = (try? fileManager.contentsOfDirectory(
            at: baseDir, includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey]
        )) ?? []
        let copies = contents.filter { $0.lastPathComponent.contains(".corrupt-") }
        guard copies.count > Self.quarantineCopyLimit else { return }
        let sorted = copies.sorted { lhs, rhs in
            let lhsDate = (try? lhs.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            let rhsDate = (try? rhs.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            return lhsDate < rhsDate
        }
        for stale in sorted.prefix(copies.count - Self.quarantineCopyLimit) {
            try? fileManager.removeItem(at: stale)
        }
    }

    /// 保存卡片：原子写主文件，并把旧主文件轮转进备份（B7：三代——cards.json → backup → backup.2）。
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
        let backup2 = fileURL("cards.backup.2.json")
        // 三代轮转（B7）：每次保存依次把上一版主文件转进 backup、上上版转进 backup.2。
        // 备份内容 = 上一版主文件字节。常态直接轮转原始字节（零解码开销）；
        // 仅当加载期发现过损坏时才解码校验，避免把坏字节转进备份。
        let previous = try? Data(contentsOf: url)
        let previousBackup = try? Data(contentsOf: backup)
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
        if let previousBackup {
            do { try previousBackup.write(to: backup2, options: .atomic) }
            catch {
                // 第三代失败不阻断主流程：它只是恢复链的最末位
                NSLog("KnowFlick: 第三代备份轮转失败: %@", error.localizedDescription)
            }
        }
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

    // MARK: - 同步墓碑表（协议 v2 §3/§4）

    /// 加载本地墓碑表（tombstones.json，与卡片库同目录的独立小文件）。
    /// 文件缺失 → 空表；损坏 → 保留隔离副本并返回空表（删除记忆丢失是可接受的退化：
    /// 已删卡片最多在下一次同步中被对端墓碑再次删除）。
    public func loadTombstones() -> [SyncTombstone] {
        let url = fileURL("tombstones.json")
        guard fileManager.fileExists(atPath: url.path) else { return [] }
        do {
            let data = try Data(contentsOf: url)
            return try JSONDecoder().decode([SyncTombstone].self, from: data)
        } catch {
            NSLog("KnowFlick: tombstones.json 损坏，将保留隔离副本: %@", error.localizedDescription)
            quarantineIfPresent(url)
            return []
        }
    }

    /// 原子写本地墓碑表；超出协议容量上限（1000）时裁最老（deletedAt 最小的先淘汰）。
    public func saveTombstones(_ tombstones: [SyncTombstone]) {
        var trimmed = tombstones
        if trimmed.count > SyncProtocol.maxTombstoneCount {
            trimmed = Array(trimmed.sorted { $0.deletedAt < $1.deletedAt }.suffix(SyncProtocol.maxTombstoneCount))
        }
        do {
            let data = try JSONEncoder().encode(trimmed)
            try data.write(to: fileURL("tombstones.json"), options: .atomic)
        } catch {
            NSLog("KnowFlick: 墓碑表落盘失败: %@", error.localizedDescription)
        }
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
            NSLog("KnowFlick: settings.json 损坏，尝试从备份恢复: %@", error.localizedDescription)
            quarantineIfPresent(url)
            // 备份回退链（与 cards.json 同纪律）：backup → backup.2，取第一个可解码的。
            // 恢复后回写主文件让状态收敛，下一次保存会重建整条备份链。
            for backupName in ["settings.backup.json", "settings.backup.2.json"] {
                let backupURL = fileURL(backupName)
                guard fileManager.fileExists(atPath: backupURL.path),
                      let data = try? Data(contentsOf: backupURL),
                      let restored = try? JSONDecoder().decode(AISettings.self, from: data) else { continue }
                if (try? data.write(to: url, options: .atomic)) != nil {
                    NSLog("KnowFlick: settings.json 已从 %@ 恢复", backupName)
                }
                return restored
            }
            NSLog("KnowFlick: settings.json 无可用备份，重置默认设置")
            return .default
        }
    }

    public func saveSettingsThrowing(_ settings: AISettings) throws {
        let data: Data
        do { data = try JSONEncoder().encode(settings) }
        catch { throw StorageWriteError.encoding(error.localizedDescription) }
        let url = fileURL("settings.json")
        let backup = fileURL("settings.backup.json")
        let backup2 = fileURL("settings.backup.2.json")
        // 两代备份轮转（Wave D4：settings.json 此前完全没有备份，损坏即重置）。
        // 纪律与 cards.json 三代链一致：上一版字节数据轮进 backup、上上版进 backup.2；
        // 上一版解不开（损坏中）时备份位改放本次健康数据，坏字节绝不混进备份链。
        // 第三代失败不阻断主流程——它只是恢复链的最末位。
        let previous = try? Data(contentsOf: url)
        let backupData: Data
        if let previous, (try? JSONDecoder().decode(AISettings.self, from: previous)) != nil {
            backupData = previous
        } else {
            backupData = data
        }
        if let previousBackup = try? Data(contentsOf: backup) {
            do { try previousBackup.write(to: backup2, options: .atomic) }
            catch { NSLog("KnowFlick: settings 第三代备份轮转失败: %@", error.localizedDescription) }
        }
        do { try backupData.write(to: backup, options: .atomic) }
        catch { NSLog("KnowFlick: settings 备份轮转失败: %@", error.localizedDescription) }
        do { try data.write(to: url, options: .atomic) }
        catch { throw StorageWriteError.writing(error.localizedDescription) }
    }

    // MARK: - 卡片追问会话 (Card Chat Sessions)
    //
    // Wave C2 主线程减负（c）：旧实现每条消息落盘都要 load+decode 整个 chat_sessions.json，
    // 会话一长就是每次一整轮全量解码。现在会话表常驻内存（每个 Storage 实例一份）：
    // 磁盘指纹未变时读只走内存、写只做全量 encode；指纹变化（文件刚出现 / 别的实例刚写过）
    // 或上一次写失败时才重新读盘。取舍与口径：文件仍是唯一真源，只是不再每条消息重解一遍。

    /// 追问会话表全量读盘次数（测试护栏，同 `deckRecomputeTrace` 口径）：
    /// 验证「读一次、写只 encode」——每条消息的落盘不得再触发 decode。
    var chatSessionDecodeCount: Int {
        chatTable.withLock { $0.decodeCount }
    }

    public func loadChatSessions() -> [UUID: CardChatSession] {
        chatTable.withLock { table in
            refreshChatSessions(&table)
            return table.sessions
        }
    }

    public func loadChatSession(for cardId: UUID) -> CardChatSession? {
        loadChatSessions()[cardId]
    }

    public func saveChatSessionThrowing(_ session: CardChatSession) throws {
        try chatTable.withLock { table in
            refreshChatSessions(&table)
            table.sessions[session.cardId] = session
            try writeChatSessions(&table)
        }
    }

    public func clearChatSessionThrowing(for cardId: UUID) throws {
        try chatTable.withLock { table in
            refreshChatSessions(&table)
            table.sessions.removeValue(forKey: cardId)
            try writeChatSessions(&table)
        }
    }

    /// 锁内刷新（调用方已持锁）：首次访问，或磁盘指纹已变（文件刚出现 / 别的实例刚写过）
    /// 时全量读一次；否则直接复用内存表。
    private func refreshChatSessions(_ table: inout ChatSessionTable.State) {
        let stamp = chatSessionsStamp()
        guard !table.loaded || table.stamp != stamp else { return }
        table.sessions = readChatSessionsFromDisk()
        table.stamp = stamp
        table.loaded = true
        table.decodeCount += 1
    }

    /// 锁内全量落盘（调用方已持锁）：只 encode 内存表，不再 load+decode 一遍。
    /// 写失败作废内存表——下次访问回到磁盘真源，与旧实现「失败即磁盘不变」一致。
    private func writeChatSessions(_ table: inout ChatSessionTable.State) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data: Data
        do { data = try encoder.encode(Array(table.sessions.values)) }
        catch {
            table.loaded = false
            throw StorageWriteError.encoding(error.localizedDescription)
        }
        do { try data.write(to: fileURL("chat_sessions.json"), options: .atomic) }
        catch {
            table.loaded = false
            throw StorageWriteError.writing(error.localizedDescription)
        }
        table.stamp = chatSessionsStamp()
    }

    /// 读盘（锁内）：文件缺失按空表；损坏则保留隔离副本并按空表处理（口径与旧实现一致）
    private func readChatSessionsFromDisk() -> [UUID: CardChatSession] {
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

    /// 磁盘指纹（锁内 stat，不解码）：存在性 + 修改时间 + 大小。
    /// 只要文件被任何一方改过（包括本进程的另一个 Storage 副本），指纹就会变化。
    private func chatSessionsStamp() -> ChatSessionTable.FileStamp {
        let url = fileURL("chat_sessions.json")
        guard fileManager.fileExists(atPath: url.path) else {
            return ChatSessionTable.FileStamp(exists: false, modified: nil, size: nil)
        }
        let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
        return ChatSessionTable.FileStamp(
            exists: true,
            modified: values?.contentModificationDate,
            size: values?.fileSize
        )
    }

    // MARK: - 搜索历史 (Search History)

    public func loadSearchHistory() -> [String] {
        let url = fileURL("search_history.json")
        guard fileManager.fileExists(atPath: url.path) else { return [] }
        do {
            let data = try Data(contentsOf: url)
            return try JSONDecoder().decode([String].self, from: data)
        } catch {
            // 与卡片/设置/追问会话同一口径：损坏文件保留隔离副本，而不是静默当空
            NSLog("KnowFlick: search_history.json 损坏，将保留隔离副本: %@", error.localizedDescription)
            quarantineIfPresent(url)
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
