import Foundation

/// 卡片导入与解析结果
public struct CardImportResult: Sendable {
    public let parsedCards: [KnowledgeCard]
    public let duplicateCount: Int
    public let sourceDescription: String

    public init(parsedCards: [KnowledgeCard], duplicateCount: Int, sourceDescription: String) {
        self.parsedCards = parsedCards
        self.duplicateCount = duplicateCount
        self.sourceDescription = sourceDescription
    }
}

/// JSON 载荷解析结果：卡片 + 墓碑 + 载荷版本（协议 v2 §3）。
///
/// - v2 信封：`protocolVersion` = 信封值，`tombstones` = 信封值；
/// - v1 裸列表 / 单卡对象：`protocolVersion` = nil（旧端），墓碑为空。
public struct ParsedCardPayload: Sendable, Equatable {
    public let cards: [KnowledgeCard]
    public let tombstones: [SyncTombstone]
    public let protocolVersion: Int?

    public init(cards: [KnowledgeCard], tombstones: [SyncTombstone] = [], protocolVersion: Int? = nil) {
        self.cards = cards
        self.tombstones = tombstones
        self.protocolVersion = protocolVersion
    }
}

/// 卡片导入与笔记提炼引擎
public enum CardImportEngine {

    // MARK: - 1. JSON 备份解析（协议 v2 §3 兼容规则）

    /// 三种输入的兼容解析：
    /// ① 顶层 JSON 数组 → v1 裸列表（墓碑为空、版本 nil）；
    /// ② 顶层对象且有 `cards` → v2 信封（cards + tombstones + protocolVersion）；
    /// ③ 其他 → throw（同步服务端据此回 400）。
    /// 单卡对象仍被接受：文件导入路径的历史行为（协议载荷不会发单卡对象）。
    public static func parseJSON(data: Data) throws -> ParsedCardPayload {
        let decoder = makeTolerantJSONDecoder()

        // ① v1 裸列表（顶层 JSON 数组）。空数组是「合法但内容为空」，不是解析失败
        //（与卡片库本身的口径一致，见 Storage.loadCards）：旧实现在这里静默跳过空数组，
        // 最后抛「无法解析 JSON 文件」，把「没有卡片」误报成格式错误。
        if let list = try? decoder.decode([KnowledgeCard].self, from: data) {
            return ParsedCardPayload(cards: list)
        }

        // ② 顶层对象
        if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let rawCards = object["cards"] {
                // v2 信封（协议 §3 判据：顶层对象、有 cards）
                return try parseEnvelope(
                    rawCards: rawCards,
                    rawTombstones: object["tombstones"],
                    protocolVersion: object["protocolVersion"] as? Int,
                    decoder: decoder
                )
            }
            if let single = try? decoder.decode(KnowledgeCard.self, from: data) {
                return ParsedCardPayload(cards: [single])
            }
        }

        // ③ 顶层是数组但存在坏卡：逐卡挽救，一张坏卡不再拖垮整个文件（校验必填字段仍是单卡硬门槛）
        if let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            let salvaged = salvageCards(from: array, decoder: decoder)
            if !salvaged.isEmpty {
                return ParsedCardPayload(cards: salvaged)
            }
        }
        throw AIError.parse("无法解析 JSON 文件，格式与 KnowFlick 卡片结构不匹配")
    }

    public static func parseJSON(_ text: String) -> ParsedCardPayload? {
        guard let data = text.data(using: .utf8) else { return nil }
        return try? parseJSON(data: data)
    }

    /// v2 信封解析：cards 与 tombstones 分开取；tombstones 缺省为空表，
    /// 存在但格式非法则抛错（400）——**绝不静默丢弃删除信息**。
    private static func parseEnvelope(
        rawCards: Any,
        rawTombstones: Any?,
        protocolVersion: Int?,
        decoder: JSONDecoder
    ) throws -> ParsedCardPayload {
        guard let cardsArray = rawCards as? [Any] else {
            throw AIError.parse("信封 cards 字段必须是数组")
        }
        let tombstones = try parseTombstones(rawTombstones)

        let cardsData: Data
        do { cardsData = try JSONSerialization.data(withJSONObject: cardsArray) }
        catch { throw AIError.parse("信封 cards 字段编码无效") }
        if let cards = try? decoder.decode([KnowledgeCard].self, from: cardsData) {
            return ParsedCardPayload(cards: cards, tombstones: tombstones, protocolVersion: protocolVersion)
        }
        // 逐卡挽救：一张坏卡不再拖垮整个载荷
        let salvaged = cardsArray.compactMap { item -> KnowledgeCard? in
            guard let item = item as? [String: Any],
                  let itemData = try? JSONSerialization.data(withJSONObject: item) else { return nil }
            return try? decoder.decode(KnowledgeCard.self, from: itemData)
        }
        guard !salvaged.isEmpty else {
            throw AIError.parse("无法解析信封 cards 字段，格式与 KnowFlick 卡片结构不匹配")
        }
        return ParsedCardPayload(cards: salvaged, tombstones: tombstones, protocolVersion: protocolVersion)
    }

    /// 墓碑数组解析（协议 §3 线格式 `[{"id":"…","deletedAt":毫秒}]`）。
    /// `id` 按字符串解析（对端 id 格式不一定是 UUID，如规格夹具 "dead"）。
    private static func parseTombstones(_ raw: Any?) throws -> [SyncTombstone] {
        guard let raw else { return [] }
        guard let array = raw as? [[String: Any]] else {
            throw AIError.parse("信封 tombstones 字段必须是数组")
        }
        return try array.map { entry in
            guard let id = entry["id"] as? String else {
                throw AIError.parse("墓碑缺少 id 字段")
            }
            guard let timestamp = entry["deletedAt"] as? NSNumber else {
                throw AIError.parse("墓碑缺少 deletedAt 时间戳")
            }
            return SyncTombstone(id: id, deletedAt: timestamp.int64Value)
        }
    }

    private static func salvageCards(from array: [[String: Any]], decoder: JSONDecoder) -> [KnowledgeCard] {
        array.compactMap { item -> KnowledgeCard? in
            guard let itemData = try? JSONSerialization.data(withJSONObject: item) else { return nil }
            return try? decoder.decode(KnowledgeCard.self, from: itemData)
        }
    }

    /// 卡片/备份解析共用的宽容日期解码器：兼容 ISO8601（含毫秒）与秒级数字。
    private static func makeTolerantJSONDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            if let raw = try? container.decode(String.self) {
                // 兼容毫秒级（外部工具常见）与秒级 ISO8601
                let fractional = ISO8601DateFormatter()
                fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                let plain = ISO8601DateFormatter()
                if let date = fractional.date(from: raw) ?? plain.date(from: raw) {
                    return date
                }
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "无法识别的日期格式：\(raw)")
            }
            if let seconds = try? container.decode(Double.self) {
                return Date(timeIntervalSince1970: seconds)
            }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "日期字段类型无效")
        }
        return decoder
    }

    // MARK: - 2. Markdown / 纯文本规则解析

    public static func parseMarkdown(text: String, defaultCategory: String = "随手笔记") -> [KnowledgeCard] {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }

        let rawLines = trimmed.components(separatedBy: .newlines)
        var cardSections: [String] = []
        var currentLines: [String] = []
        var inFrontmatter = false
        var fence: String?

        for (index, line) in rawLines.enumerated() {
            let t = line.trimmingCharacters(in: .whitespaces)
            if let marker = fenceMarker(t) {
                if fence == nil { fence = marker } else if fence == marker { fence = nil }
                currentLines.append(line)
                continue
            }
            if fence != nil {
                currentLines.append(line)
                continue
            }
            if t == "---" || t == "***" || t == "___" {
                let nextLine = rawLines.dropFirst(index + 1).first { !$0.trimmingCharacters(in: .whitespaces).isEmpty } ?? ""
                let metadataStartsHere = t == "---" && currentLines.allSatisfy { $0.trimmingCharacters(in: .whitespaces).isEmpty }
                    && nextLine.range(of: #"^\s*[A-Za-z_][A-Za-z_0-9-]*\s*:"#, options: .regularExpression) != nil
                if inFrontmatter {
                    inFrontmatter = false
                    currentLines.append(line)
                } else if metadataStartsHere {
                    inFrontmatter = true
                    currentLines.append(line)
                } else {
                    if currentLines.contains(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) {
                        cardSections.append(currentLines.joined(separator: "\n"))
                    }
                    currentLines.removeAll()
                }
            } else {
                currentLines.append(line)
            }
        }
        if !currentLines.isEmpty {
            cardSections.append(currentLines.joined(separator: "\n"))
        }

        // 若没有多段分隔，尝试按标题划分
        if cardSections.count <= 1 {
            let byHeadings = splitByHeadings(trimmed)
            if byHeadings.count > 1 {
                cardSections = byHeadings
            }
        }

        var cards: [KnowledgeCard] = []
        for sec in cardSections {
            if let card = parseSingleSection(sec, defaultCategory: defaultCategory) {
                cards.append(card)
            }
        }

        return cards
    }

    private static func splitByHeadings(_ text: String) -> [String] {
        let lines = text.components(separatedBy: .newlines)
        var headings: [(index: Int, depth: Int)] = []
        var fence: String?
        var frontmatter = false
        for (index, line) in lines.enumerated() {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed == "---" && (index == 0 || frontmatter) { frontmatter.toggle(); continue }
            if frontmatter { continue }
            if let marker = fenceMarker(trimmed) {
                if fence == nil { fence = marker } else if fence == marker { fence = nil }
                continue
            }
            if fence != nil { continue }
            let depth = trimmed.prefix(while: { $0 == "#" }).count
            if (1...6).contains(depth), trimmed.dropFirst(depth).hasPrefix(" ") {
                headings.append((index, depth))
            }
        }
        guard let depth = headings.map(\.depth).min() else { return [text] }
        let boundaries = headings.filter { $0.depth == depth }.dropFirst().map(\.index)
        var sections: [String] = []
        var start = 0
        for boundary in boundaries {
            sections.append(lines[start..<boundary].joined(separator: "\n"))
            start = boundary
        }
        sections.append(lines[start...].joined(separator: "\n"))
        return sections
    }

    private static func fenceMarker(_ line: String) -> String? {
        if line.hasPrefix("```") { return "```" }
        if line.hasPrefix("~~~") { return "~~~" }
        return nil
    }

    private static func parseSingleSection(_ sectionText: String, defaultCategory: String) -> KnowledgeCard? {
        let lines = sectionText.components(separatedBy: .newlines)

        guard !lines.isEmpty else { return nil }

        var category = defaultCategory
        var headline = ""
        var summary = ""
        var detailLines: [String] = []
        var links: [ScienceLink] = []

        var inFrontmatter = false
        var frontmatterChecked = false
        var fence: String?

        for rawLine in lines {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if let marker = fenceMarker(line) {
                if fence == nil { fence = marker } else if fence == marker { fence = nil }
                detailLines.append(rawLine)
                continue
            }
            if fence != nil { detailLines.append(rawLine); continue }
            if line.isEmpty { continue }
            // Frontmatter 处理
            if line == "---" && !frontmatterChecked {
                inFrontmatter.toggle()
                if !inFrontmatter { frontmatterChecked = true }
                continue
            }
            if inFrontmatter {
                if line.hasPrefix("category:") {
                    category = extractMetadataValue(line, key: "category:")
                } else if line.hasPrefix("title:") {
                    headline = extractMetadataValue(line, key: "title:")
                } else if line.hasPrefix("headline:") {
                    headline = extractMetadataValue(line, key: "headline:")
                }
                continue
            }

            // 识别分类标记，如 **领域**：[[物理]] 或 - **领域分类**：`计算机`
            if line.contains("领域") || line.contains("分类") {
                if let extracted = extractCategoryFromLine(line) {
                    category = extracted
                    continue
                }
            }

            // 识别标题：# 标题 或 ### 1. 标题；冒号行需排除列表项（如「- **收藏时间**：…」）
            if headline.isEmpty && (line.hasPrefix("#") || line.hasPrefix("【") || (line.contains("：") && !isBulletLine(line))) {
                let cleaned = cleanHeadline(line)
                if !cleaned.isEmpty {
                    headline = cleaned
                    continue
                }
            }

            // 识别引用句为 Summary：> 核心观点
            if line.hasPrefix(">") {
                let quote = line.dropFirst().trimmingCharacters(in: .whitespacesAndNewlines)
                if quote.hasPrefix("**核心观点**") {
                    continue
                }
                if summary.isEmpty {
                    summary = quote
                } else {
                    summary += " " + quote
                }
                continue
            }

            // 识别链接：[标题](url)
            if let link = extractMarkdownLink(line) {
                links.append(link)
            }

            // 其它均计入详情行
            if line != "**深入剖析**" && line != "## 深入剖析" && line != "**延伸阅读**" {
                detailLines.append(line)
            }
        }

        // 兜底补齐：若未找到标题，取第一行真实文本（跳过 --- 分割线）
        if headline.isEmpty || headline == "---" {
            if let firstReal = lines.first(where: { $0 != "---" && !cleanHeadline($0).isEmpty }) {
                headline = cleanHeadline(firstReal)
                if let idx = detailLines.firstIndex(of: firstReal) {
                    detailLines.remove(at: idx)
                }
            }
        }

        // 兜底补齐摘要
        if summary.isEmpty {
            if let firstDetail = detailLines.first {
                summary = firstDetail
                detailLines.removeFirst()
            } else {
                summary = headline
            }
        }

        let details = detailLines.joined(separator: "\n")

        guard !headline.isEmpty else { return nil }

        return KnowledgeCard(
            category: category,
            headline: headline,
            summary: summary,
            details: details.isEmpty ? summary : details,
            links: links,
            source: .imported,
            createdAt: Date(),
            seenAt: nil
        )
    }

    /// 列表行（- / * / • 开头）不作为标题候选，避免把「- **收藏时间**：…」这类元数据抓成标题
    private static func isBulletLine(_ line: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        return trimmed.hasPrefix("-") || trimmed.hasPrefix("*") || trimmed.hasPrefix("•") || trimmed.hasPrefix("+")
    }

    private static func cleanHeadline(_ raw: String) -> String {
        var s = raw
        while s.hasPrefix("#") { s.removeFirst() }
        s = s.trimmingCharacters(in: .whitespacesAndNewlines)
        // 仅剥离真正的行首序号（如 "1. " / "12. "），保留「3.14 是圆周率」「2024. 年度总结」等内容：
        // 要求「数字 + . + 空白」且序号不超过 3 位（4 位数字按年份等内容处理）。
        if let range = s.range(of: #"^\d{1,3}\.\s+"#, options: .regularExpression) {
            s = String(s[range.upperBound...])
        }
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func extractMetadataValue(_ line: String, key: String) -> String {
        let val = line.dropFirst(key.count).trimmingCharacters(in: .whitespacesAndNewlines)
        return val.trimmingCharacters(in: CharacterSet(charactersIn: "\"\'`[]"))
    }

    private static func extractCategoryFromLine(_ line: String) -> String? {
        // 支持 [[分类]]
        if let openRange = line.range(of: "[["), let closeRange = line.range(of: "]]", range: openRange.upperBound..<line.endIndex) {
            let cat = line[openRange.upperBound..<closeRange.lowerBound].trimmingCharacters(in: .whitespaces)
            if !cat.isEmpty { return cat }
        }
        // 支持 `分类`
        if let firstTick = line.firstIndex(of: "`"), let lastTick = line.lastIndex(of: "`"), firstTick != lastTick {
            let cat = line[line.index(after: firstTick)..<lastTick].trimmingCharacters(in: .whitespaces)
            if !cat.isEmpty { return cat }
        }
        return nil
    }

    private static func extractMarkdownLink(_ line: String) -> ScienceLink? {
        guard let openBracket = line.firstIndex(of: "["),
              let closeBracket = line.firstIndex(of: "]"),
              let openParen = line.firstIndex(of: "("),
              let closeParen = line.firstIndex(of: ")"),
              openBracket < closeBracket, closeBracket < openParen, openParen < closeParen else {
            return nil
        }
        let title = String(line[line.index(after: openBracket)..<closeBracket])
        let url = String(line[line.index(after: openParen)..<closeParen])
        if !title.isEmpty && (url.hasPrefix("http://") || url.hasPrefix("https://")) {
            return ScienceLink(title: title, url: url)
        }
        return nil
    }

    // MARK: - 3. 去重与合并

    /// 对称式字段级无损合并单张卡片：`mergeCard(a, b) == mergeCard(b, a)`
    public static func mergeCard(_ a: KnowledgeCard, _ b: KnowledgeCard) -> KnowledgeCard {
        // 1. ID 与创建时间：若 ID 相同直接使用；若按标题匹配不同 ID，取更早创建时间与对应 ID
        let mergedId: UUID
        let createdAt: Date
        if a.id == b.id {
            mergedId = a.id
            createdAt = min(a.createdAt, b.createdAt)
        } else {
            if a.createdAt < b.createdAt {
                mergedId = a.id
                createdAt = a.createdAt
            } else if b.createdAt < a.createdAt {
                mergedId = b.id
                createdAt = b.createdAt
            } else {
                mergedId = a.id.uuidString <= b.id.uuidString ? a.id : b.id
                createdAt = a.createdAt
            }
        }

        // 2. 正文与元数据（category, headline, summary, details, links, source）：
        // 若内容不同，取创建时间较晚或详情更丰富的一方；非空优先
        let primary: KnowledgeCard
        let secondary: KnowledgeCard
        if a.createdAt >= b.createdAt {
            primary = a; secondary = b
        } else {
            primary = b; secondary = a
        }

        let category = primary.category.isEmpty ? secondary.category : primary.category
        let headline = primary.headline.isEmpty ? secondary.headline : primary.headline
        let summary = primary.summary.isEmpty ? secondary.summary : primary.summary
        // details 冲突（协议 v2 §5，修「用户缩短被旧长文覆盖」）：
        // 双方均有 editedAt → 新者赢；任一方缺失（或编辑时间相同）→ 沿用 v1「较长者」规则，兼容历史数据。
        // 空正文仍一律让位给非空一方（非空优先是所有字段合并的外层守卫）。
        let details: String
        if a.details.isEmpty {
            details = b.details
        } else if b.details.isEmpty {
            details = a.details
        } else if let editedA = a.editedAt, let editedB = b.editedAt, editedA != editedB {
            details = editedA > editedB ? a.details : b.details
        } else {
            details = primary.details.count >= secondary.details.count ? primary.details : secondary.details
        }
        let links = primary.links.isEmpty ? secondary.links : primary.links
        let source = primary.source == .seed && secondary.source != .seed ? secondary.source : primary.source

        // 编辑时间：取双方较新者（对称、确定性）；双方皆历史卡则保持 nil
        let editedAt: Date?
        switch (a.editedAt, b.editedAt) {
        case let (editedA?, editedB?):
            editedAt = max(editedA, editedB)
        case let (editedA?, nil):
            editedAt = editedA
        case let (nil, editedB?):
            editedAt = editedB
        case (nil, nil):
            editedAt = nil
        }

        // 3. 浏览足迹与意图（seenAt, swiped）：
        // 保留最新浏览时间；swiped 归属最新浏览那一端
        let seenAt: Date?
        let swiped: SwipeDirection?
        switch (a.seenAt, b.seenAt) {
        case let (sA?, sB?):
            if sA >= sB {
                seenAt = sA
                swiped = a.swiped ?? b.swiped
            } else {
                seenAt = sB
                swiped = b.swiped ?? a.swiped
            }
        case let (sA?, nil):
            seenAt = sA
            swiped = a.swiped
        case let (nil, sB?):
            seenAt = sB
            swiped = b.swiped
        case (nil, nil):
            seenAt = nil
            swiped = a.swiped ?? b.swiped
        }

        // 4. 收藏状态（isFavorite, favoritedAt）：
        // 任一端收藏即为收藏；保留最新收藏时间戳
        let isFavorite = a.isFavorite || b.isFavorite
        let favoritedAt: Date?
        switch (a.favoritedAt, b.favoritedAt) {
        case let (fA?, fB?):
            favoritedAt = max(fA, fB)
        case let (fA?, nil):
            favoritedAt = fA
        case let (nil, fB?):
            favoritedAt = fB
        case (nil, nil):
            favoritedAt = isFavorite ? seenAt : nil
        }

        // 5. SM-2 / FSRS 记忆模型与复习状态：
        // 比较 lastReviewedAt：以复习时间更新（更近期）的一端为主
        let reviewCount = max(a.reviewCount, b.reviewCount)
        let masteryLevel: Int
        let lastReviewedAt: Date?
        let repetition: Int
        let intervalDays: Int
        let easeFactor: Double
        let stability: Double
        let difficulty: Double

        switch (a.lastReviewedAt, b.lastReviewedAt) {
        case let (rA?, rB?):
            if rA > rB {
                masteryLevel = a.masteryLevel
                lastReviewedAt = rA
                repetition = a.repetition
                intervalDays = a.intervalDays
                easeFactor = a.easeFactor
                stability = a.stability > 0 ? a.stability : b.stability
                difficulty = a.difficulty > 0 ? a.difficulty : b.difficulty
            } else if rB > rA {
                masteryLevel = b.masteryLevel
                lastReviewedAt = rB
                repetition = b.repetition
                intervalDays = b.intervalDays
                easeFactor = b.easeFactor
                stability = b.stability > 0 ? b.stability : a.stability
                difficulty = b.difficulty > 0 ? b.difficulty : a.difficulty
            } else {
                masteryLevel = max(a.masteryLevel, b.masteryLevel)
                lastReviewedAt = rA
                repetition = max(a.repetition, b.repetition)
                intervalDays = max(a.intervalDays, b.intervalDays)
                easeFactor = max(a.easeFactor, b.easeFactor)
                stability = max(a.stability, b.stability)
                difficulty = max(a.difficulty, b.difficulty)
            }
        case let (rA?, nil):
            masteryLevel = a.masteryLevel
            lastReviewedAt = rA
            repetition = a.repetition
            intervalDays = a.intervalDays
            easeFactor = a.easeFactor
            stability = a.stability
            difficulty = a.difficulty
        case let (nil, rB?):
            masteryLevel = b.masteryLevel
            lastReviewedAt = rB
            repetition = b.repetition
            intervalDays = b.intervalDays
            easeFactor = b.easeFactor
            stability = b.stability
            difficulty = b.difficulty
        case (nil, nil):
            masteryLevel = max(a.masteryLevel, b.masteryLevel)
            lastReviewedAt = nil
            repetition = max(a.repetition, b.repetition)
            intervalDays = max(a.intervalDays, b.intervalDays)
            easeFactor = max(a.easeFactor, b.easeFactor)
            stability = max(a.stability, b.stability)
            difficulty = max(a.difficulty, b.difficulty)
        }

        return KnowledgeCard(
            id: mergedId,
            category: category,
            headline: headline,
            summary: summary,
            details: details,
            links: links,
            source: source,
            createdAt: createdAt,
            editedAt: editedAt,
            seenAt: seenAt,
            swiped: swiped,
            isFavorite: isFavorite,
            favoritedAt: favoritedAt,
            reviewCount: reviewCount,
            masteryLevel: masteryLevel,
            lastReviewedAt: lastReviewedAt,
            repetition: repetition,
            intervalDays: intervalDays,
            easeFactor: easeFactor,
            stability: stability,
            difficulty: difficulty,
            // 学科体系是**内容元数据**而非学习状态：逐字段非空优先，较新的一端胜出。
            // 这样一端补过分级、另一端没补，合并后不会把分级冲掉。
            subject: primary.subject ?? secondary.subject,
            branch: primary.branch ?? secondary.branch,
            level: primary.level ?? secondary.level,
            track: primary.track ?? secondary.track,
            orderKey: primary.orderKey ?? secondary.orderKey,
            prereq: primary.prereq.isEmpty ? secondary.prereq : primary.prereq
        )
    }

    /// 智能合并卡片列表：
    /// 匹配已有卡片并就地升级字段；新卡按去重规则追加
    public static func mergeCardList(
        existing: [KnowledgeCard],
        incoming: [KnowledgeCard]
    ) -> (mergedCards: [KnowledgeCard], addedCount: Int, updatedCount: Int, ignoredCount: Int) {
        var working = existing
        var indexById: [UUID: Int] = [:]
        var indexByHeadline: [String: Int] = [:]

        for (idx, card) in working.enumerated() {
            indexById[card.id] = idx
            let norm = normalizeHeadline(card.headline)
            if !norm.isEmpty && indexByHeadline[norm] == nil {
                indexByHeadline[norm] = idx
            }
        }

        var addedCount = 0
        var updatedCount = 0
        var ignoredCount = 0

        for inc in incoming {
            let norm = normalizeHeadline(inc.headline)
            let matchIdx = indexById[inc.id] ?? (norm.isEmpty ? nil : indexByHeadline[norm])

            if let idx = matchIdx {
                let current = working[idx]
                let merged = mergeCard(current, inc)
                if merged != current {
                    working[idx] = merged
                    updatedCount += 1
                } else {
                    ignoredCount += 1
                }
            } else {
                guard !norm.isEmpty else {
                    ignoredCount += 1
                    continue
                }
                working.append(inc)
                let newIdx = working.count - 1
                indexById[inc.id] = newIdx
                indexByHeadline[norm] = newIdx
                addedCount += 1
            }
        }

        return (working, addedCount, updatedCount, ignoredCount)
    }

    // MARK: - 3.5 同步墓碑合并（协议 v2 §4，两端同源、对称可交换）

    /// 卡片参与墓碑判定的「卡片时间戳」：有 `editedAt` 用 `editedAt`，否则 `createdAt`（协议 §4.3，epoch 毫秒）。
    public static func cardTimestampMs(_ card: KnowledgeCard) -> Int64 {
        let date = card.editedAt ?? card.createdAt
        return Int64((date.timeIntervalSince1970 * 1000).rounded())
    }

    /// 把对端同步载荷（卡片 + 墓碑）合并进本地状态（协议 §4）：
    ///
    /// - **规则 2（收到卡片）**：本地墓碑表存在该 id 且 `deletedAt` ≥ 卡片时间戳 → 拒收（不复活，
    ///   计入 ignored）；否则正常合并，并清除本地同 id 墓碑（复活场景）。
    /// - **规则 1（收到墓碑）**：本地存在同 id 卡片且卡片时间戳 ≤ `deletedAt` → 删除本地卡片、
    ///   记入墓碑表（deletedAt 取较大者），计入 deleted；卡片时间戳 > `deletedAt`（对端删除后
    ///   又有新编辑/重建）→ 保留卡片、忽略该墓碑；本地无此卡 → 仅记墓碑（防止更早副本经第三方回流）。
    ///
    /// 先卡片后墓碑与先墓碑后卡片结果一致（规则天然可交换，由跨端交换律测试守护）。
    /// 返回合并后的卡片、墓碑表与各项计数；墓碑表由调用方落盘。
    public static func mergeSyncPayload(
        existing: [KnowledgeCard],
        localTombstones: [SyncTombstone],
        incomingCards: [KnowledgeCard],
        incomingTombstones: [SyncTombstone]
    ) -> (cards: [KnowledgeCard], tombstones: [SyncTombstone], added: Int, updated: Int, ignored: Int, deleted: Int) {
        // 墓碑 id 统一小写做匹配键：mac UUID 字符串为大写，对端可能发小写；非 UUID id 原样小写保留
        var tombstoneById: [String: (deletedAt: Int64, displayId: String)] = [:]
        func record(_ tombstone: SyncTombstone) {
            let key = tombstone.id.lowercased()
            let current = tombstoneById[key]
            tombstoneById[key] = (max(current?.deletedAt ?? .min, tombstone.deletedAt), current?.displayId ?? tombstone.id)
        }
        for tombstone in localTombstones { record(tombstone) }

        // 规则 2：应用对端卡片
        var effectiveIncoming: [KnowledgeCard] = []
        effectiveIncoming.reserveCapacity(incomingCards.count)
        var rejectedCount = 0
        for card in incomingCards {
            let key = card.id.uuidString.lowercased()
            if let deletedAt = tombstoneById[key]?.deletedAt, deletedAt >= cardTimestampMs(card) {
                rejectedCount += 1   // 墓碑抵抗：拒收，不复活
                continue
            }
            tombstoneById[key] = nil   // 正常合并/复活：清除本地同 id 墓碑
            effectiveIncoming.append(card)
        }

        let (merged, added, updated, ignored) = mergeCardList(existing: existing, incoming: effectiveIncoming)

        // 规则 1：应用对端墓碑
        var working = merged
        var deletedCount = 0
        for tombstone in incomingTombstones {
            let key = tombstone.id.lowercased()
            if let index = working.firstIndex(where: { $0.id.uuidString.lowercased() == key }) {
                if cardTimestampMs(working[index]) <= tombstone.deletedAt {
                    working.remove(at: index)
                    deletedCount += 1
                    record(tombstone)
                }
                // else：卡片比对端删除时更新（删除后重建/新编辑）→ 保留卡片、忽略该墓碑
            } else {
                record(tombstone)   // 本地无此卡：记墓碑，挡住更早副本回流
            }
        }

        let tombstones = tombstoneById
            .map { SyncTombstone(id: $0.value.displayId, deletedAt: $0.value.deletedAt) }
            .sorted { ($0.deletedAt, $0.id) < ($1.deletedAt, $1.id) }
        return (working, tombstones, added, updated, ignored + rejectedCount, deletedCount)
    }

    public static func deduplicateAndMerge(
        existing: [KnowledgeCard],
        incoming: [KnowledgeCard]
    ) -> (cardsToAdd: [KnowledgeCard], duplicateCount: Int) {
        var existingHeadlines = Set<String>()
        var existingIDs = Set<UUID>()

        for card in existing {
            existingIDs.insert(card.id)
            existingHeadlines.insert(normalizeHeadline(card.headline))
        }

        var toAdd: [KnowledgeCard] = []
        var dupCount = 0

        for inc in incoming {
            let norm = normalizeHeadline(inc.headline)
            if existingIDs.contains(inc.id) || existingHeadlines.contains(norm) {
                dupCount += 1
            } else {
                existingIDs.insert(inc.id)
                existingHeadlines.insert(norm)
                toAdd.append(inc)
            }
        }

        return (toAdd, dupCount)
    }

    public static func normalizeHeadline(_ headline: String) -> String {
        headline.unicodeScalars
            .filter { !CharacterSet.whitespacesAndNewlines.contains($0) && !CharacterSet.punctuationCharacters.contains($0) }
            .map { String($0).lowercased() }
            .joined()
    }

    // MARK: - 4. AI 笔记提炼 Prompt 构造

    public static func buildAITransformPrompt(noteContent: String) -> String {
        return """
        你是一位知识提炼专家。请将用户提供的以下笔记或文章内容，深度解构并提炼为 1 到 5 张高品质的「KnowFlick 知识闪卡」。

        【提炼设计准则】
        1. 必须提炼为符合以下 JSON 结构的卡片数组，仅输出 JSON，不要任何多余解释；
        2. category: 精准学科分类（如：物理、计算机、心理学、经济学、生物学、历史、哲学、医学等）；
        3. headline: 一句话反常识/颠覆认知/核心命题标题（例如：「过拟合：模型把背题当成了学会」），不超过 30 字；
        4. summary: 卡片正面摘要，提炼核心论点，不超过 60 字；
        5. details: 卡片深度机理解剖（200-500字，用通俗生动语言讲解背后深层原理或机制）；
        6. searchKeywords: 2-3 个核心学术关键词（如 ["热力学第三定律", "绝对零度"]）；
        7. sources: 1-2 个推荐参考权威来源（如 ["维基百科", "Nature"]）。

        【输出 JSON 示例】
        [
          {
            "category": "物理",
            "headline": "绝对零度永远无法真正达到",
            "summary": "-273.15°C之下没有静止，粒子仍有零点能量。",
            "details": "根据量子力学不确定性原理与热力学第三定律...",
            "searchKeywords": ["热力学第三定律", "绝对零度"],
            "sources": ["维基百科"]
          }
        ]

        【用户笔记原文】
        \(noteContent.prefix(4000))
        """
    }
}
