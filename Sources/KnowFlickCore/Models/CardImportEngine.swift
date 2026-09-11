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

/// 卡片导入与笔记提炼引擎
public enum CardImportEngine {

    // MARK: - 1. JSON 备份解析

    public static func parseJSON(data: Data) throws -> [KnowledgeCard] {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        if let list = try? decoder.decode([KnowledgeCard].self, from: data), !list.isEmpty {
            return list
        }
        if let single = try? decoder.decode(KnowledgeCard.self, from: data) {
            return [single]
        }
        // 尝试宽松解码器（允许日期解码失败时赋当前日期）
        let relaxedDecoder = JSONDecoder()
        if let list = try? relaxedDecoder.decode([KnowledgeCard].self, from: data), !list.isEmpty {
            return list
        }
        throw AIError.parse("无法解析 JSON 文件，格式与 KnowFlick 卡片结构不匹配")
    }

    public static func parseJSON(_ text: String) -> [KnowledgeCard]? {
        guard let data = text.data(using: .utf8) else { return nil }
        return try? parseJSON(data: data)
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

            // 识别标题：# 标题 或 ### 1. 标题
            if headline.isEmpty && (line.hasPrefix("#") || line.hasPrefix("【") || line.contains("：")) {
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
