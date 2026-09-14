import Foundation

/// 导出文件项（用于多文件/目录导出）
public struct ExportFileItem: Sendable, Hashable {
    public let filename: String
    public let content: String

    public init(filename: String, content: String) {
        self.filename = filename
        self.content = content
    }
}

/// 导出目标格式
public enum CardExportFormat: String, CaseIterable, Identifiable, Sendable {
    case markdownSingle = "md_single"
    case obsidianVault  = "obsidian_vault"
    case ankiTSV        = "anki_tsv"
    case jsonArchive    = "json_archive"

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .markdownSingle: return "Markdown 整合单文档 (.md)"
        case .obsidianVault:  return "Obsidian 独立双链笔记包"
        case .ankiTSV:        return "Anki 记忆牌组卡片 (.tsv)"
        case .jsonArchive:    return "JSON 结构化完整备份 (.json)"
        }
    }

    public var fileExtension: String {
        switch self {
        case .markdownSingle: return "md"
        case .obsidianVault:  return "zip"
        case .ankiTSV:        return "tsv"
        case .jsonArchive:    return "json"
        }
    }

    public var systemIcon: String {
        switch self {
        case .markdownSingle: return "doc.text"
        case .obsidianVault:  return "folder.badge.gearshape"
        case .ankiTSV:        return "menucard"
        case .jsonArchive:    return "curlybraces"
        }
    }

    public var description: String {
        switch self {
        case .markdownSingle:
            return "含 YAML 元数据、目录跳转索引、卡片正文及链接的排版文档，兼容 Typora、Notion 与 Bear。"
        case .obsidianVault:
            return "每张卡片生成独立 .md 笔记，支持 [[分类]] 双向链接与 #标签，开箱即用导入 Obsidian 图谱。"
        case .ankiTSV:
            return "严格符合 Anki 导入规范的制表符分隔文件，正面核心主张，背面机理解析，支持 Anki Desktop 与 AnkiMobile。"
        case .jsonArchive:
            return "完整卡片数据镜像，包含 UUID、复习进度、熟练度与意图，用于跨 Mac/移动端无缝迁移与恢复。"
        }
    }
}

/// 卡片批量导出引擎
public enum CardExportEngine {

    // DateFormatter 非线程安全，导出可能在后台 Task 并发执行，改为每次调用局部创建
    private static func makeDateFormatter() -> DateFormatter {
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd HH:mm"
        return df
    }

    private static func makeDayFormatter() -> DateFormatter {
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        return df
    }

    // MARK: - 1. 单文件 Markdown 导出

    /// 单文件时间字段口径：通用导出用浏览时间，收藏阁导出用收藏时间（与收藏阁排序一致）
    private enum TimeField {
        case seen
        case favorited
    }

    public static func exportMarkdownSingleFile(cards: [KnowledgeCard], title: String = "KnowFlick 知识卡片") -> String {
        renderSingleFileMarkdown(
            cards: cards,
            title: title,
            highlight: "本次共导出 **\(cards.count)** 张知识卡片。",
            timeField: .seen
        )
    }

    /// 收藏阁 Markdown 导出：与通用导出共用渲染管线（目录锚点一致、来源三分支、收藏时间口径）
    public static func exportFavoritesMarkdown(cards: [KnowledgeCard]) -> String {
        renderSingleFileMarkdown(
            cards: cards,
            title: "KnowFlick 知识收藏阁",
            highlight: "共精选收藏 **\(cards.count)** 条知识卡片。",
            timeField: .favorited
        )
    }

    private static func renderSingleFileMarkdown(
        cards: [KnowledgeCard],
        title: String,
        highlight: String,
        timeField: TimeField
    ) -> String {
        let dateFormatter = makeDateFormatter()
        let nowStr = dateFormatter.string(from: Date())

        var lines: [String] = []
        lines.reserveCapacity(cards.count * 16 + 24)
        lines.append("""
        ---
        title: "\(title)"
        date: "\(nowStr)"
        total_cards: \(cards.count)
        tags: [knowflick, study-notes, flashcards]
        generator: KnowFlick macOS
        ---

        # 📚 \(title)

        > 沉淀闪念，连接灵感。\(highlight)
        > 导出时间：\(nowStr)

        ---

        ## 📑 目录索引

        """)

        for (idx, card) in cards.enumerated() {
            let cleanHeadline = card.headline.replacingOccurrences(of: "\n", with: " ")
            let anchor = "card-\(idx + 1)"
            lines.append("\(idx + 1). [\(card.category) · \(cleanHeadline)](#\(anchor))")
        }

        lines.append("\n---\n\n## 💡 知识笔记详情\n\n")

        for (idx, card) in cards.enumerated() {
            let categoryName = card.category.isEmpty ? "未分类" : card.category
            let timeLabel: String
            switch timeField {
            case .seen:
                timeLabel = card.seenAt.map { dateFormatter.string(from: $0) } ?? "待刷中"
            case .favorited:
                // 收藏时间与收藏阁排序口径一致；无记录时回退建卡时间
                timeLabel = dateFormatter.string(from: card.favoritedAt ?? card.createdAt)
            }

            let sourceName: String
            switch card.source {
            case .ai: sourceName = "🤖 AI 灵感探索"
            case .seed: sourceName = "🌱 精选经典"
            case .imported: sourceName = "📥 个人笔记提纯"
            }

            let cleanHeadline = card.headline.replacingOccurrences(of: "\n", with: " ")

            lines.append("""
            <a id="card-\(idx + 1)"></a>
            ### \(idx + 1). \(cleanHeadline)

            - **领域分类**：`\(categoryName)`
            - **\(timeField == .seen ? "收录状态" : "收藏时间")**：`\(timeLabel)`
            - **知识来源**：\(sourceName)
            - **记忆熟练度**：\(card.masteryLevel > 0 ? (card.masteryLevel == 2 ? "已掌握 (★★)" : "学习中 (★☆)") : "未测验 (☆☆)")

            > **核心观点**
            > \(card.summary)

            **深入剖析**
            \(card.details)

            """)

            if !card.links.isEmpty {
                lines.append("\n**延伸阅读**")
                for link in card.links {
                    lines.append("- [\(link.title)](\(link.url))")
                }
            }

            lines.append("\n---\n\n")
        }

        lines.append("*Generated by KnowFlick (闪念智库)*\n")
        return lines.joined(separator: "\n")
    }

    // MARK: - 2. Obsidian 独立双链文件集合

    public static func exportObsidianFiles(cards: [KnowledgeCard]) -> [ExportFileItem] {
        var items: [ExportFileItem] = []
        var usedFilenames: Set<String> = []
        let dayFormatter = makeDayFormatter()

        for card in cards {
            let categoryName = card.category.isEmpty ? "通用知识" : card.category
            let safeHeadline = sanitizeFilename(card.headline)
            var baseName = sanitizeFilename("[\(categoryName)] \(safeHeadline)")
            if baseName.count > 60 {
                baseName = String(baseName.prefix(60))
            }
            var fileName = "\(baseName).md"
            var counter = 1
            while usedFilenames.contains(fileName.precomposedStringWithCanonicalMapping.lowercased()) {
                fileName = "\(baseName) (\(counter)).md"
                counter += 1
            }
            usedFilenames.insert(fileName.precomposedStringWithCanonicalMapping.lowercased())

            let createdStr = dayFormatter.string(from: card.createdAt)
            let safeCategoryTag = categoryName.replacingOccurrences(of: " ", with: "_")
            let sourceTag = card.source.rawValue

            var md = """
            ---
            id: "\(card.id.uuidString)"
            title: "\(card.headline.replacingOccurrences(of: "\"", with: "\\\""))"
            category: "\(categoryName)"
            source: "\(sourceTag)"
            created: "\(createdStr)"
            mastery: \(card.masteryLevel)
            tags:
              - knowflick
              - \(safeCategoryTag)
              - \(sourceTag)
            ---

            # \(card.headline)

            **领域**：[[\(categoryName)]] · **来源**：\(card.source == .ai ? "🤖 AI 探索" : (card.source == .imported ? "📥 外部笔记" : "🌱 经典知识"))

            > **核心观点**
            > \(card.summary)

            ## 深入剖析

            \(card.details)

            """

            if !card.links.isEmpty {
                md += "\n## 延伸探索\n\n"
                for link in card.links {
                    md += "- [\(link.title)](\(link.url))\n"
                }
            }

            items.append(ExportFileItem(filename: fileName, content: md))
        }

        return items
    }

    // MARK: - 3. Anki 牌组 TSV 导出

    public static func exportAnkiTSV(cards: [KnowledgeCard]) -> String {
        // Anki TSV 规范：
        // 字段 1：Front (正面) - HTML 格式，标题与核心观点
        // 字段 2：Back (背面) - 深度解析与科普链接
        // 字段 3：Tags (标签) - 空格分隔，无制表符与换行
        var lines: [String] = []

        for card in cards {
            let categoryBadge = "<span style=\"color:#d97706; font-size:12px; font-weight:bold;\">[\(card.category.htmlEscaped)]</span>"
            let headlineHTML = "<div style=\"font-size:18px; font-weight:bold; margin-top:6px; margin-bottom:8px;\">\(card.headline.htmlEscaped.replacingOccurrences(of: "\n", with: "<br>"))</div>"
            let summaryHTML = "<div style=\"color:#555; font-size:14px; line-height:1.5;\">\(card.summary.htmlEscaped.replacingOccurrences(of: "\n", with: "<br>"))</div>"
            let front = "\(categoryBadge)<br>\(headlineHTML)\(summaryHTML)"

            var back = "<div style=\"font-size:15px; line-height:1.6;\">\(card.details.htmlEscaped.replacingOccurrences(of: "\n", with: "<br>"))</div>"
            if !card.links.isEmpty {
                back += "<hr style=\"border:none; border-top:1px dashed #ccc; margin:12px 0;\">"
                back += "<div style=\"font-size:12px; color:#888;\"><b>延伸阅读：</b><br>"
                for link in card.links {
                    back += "<a href=\"\(link.url.htmlEscaped)\">\(link.title.htmlEscaped)</a><br>"
                }
                back += "</div>"
            }

            // 清理字段内的 tab 字符
            let cleanFront = front.replacingOccurrences(of: "\t", with: " ")
            let cleanBack = back.replacingOccurrences(of: "\t", with: " ")

            var tags = ["knowflick", sanitizeTag(card.category)]
            switch card.source {
            case .seed: tags.append("经典精选")
            case .ai: tags.append("AI探索")
            case .imported: tags.append("笔记提炼")
            }
            if card.masteryLevel == 2 {
                tags.append("已掌握")
            }
            let tagsString = tags.filter { !$0.isEmpty }.joined(separator: " ")

            lines.append("\(cleanFront)\t\(cleanBack)\t\(tagsString)")
        }

        return lines.joined(separator: "\n")
    }

    // MARK: - 4. JSON 结构化备份归档

    public static func exportJSONArchive(cards: [KnowledgeCard]) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(cards)
    }

    public static func exportToSingleMarkdown(cards: [KnowledgeCard], title: String = "KnowFlick 知识卡片") -> String {
        exportMarkdownSingleFile(cards: cards, title: title)
    }

    public static func exportToObsidianVault(cards: [KnowledgeCard]) -> [ExportFileItem] {
        exportObsidianFiles(cards: cards)
    }

    public static func exportToAnkiTSV(cards: [KnowledgeCard]) -> String {
        exportAnkiTSV(cards: cards)
    }

    /// JSON 备份文本；编码失败直接抛出，调用方必须走失败分支，不得伪装成空归档。
    public static func exportToJSON(cards: [KnowledgeCard]) throws -> String {
        let data = try exportJSONArchive(cards: cards)
        guard let str = String(data: data, encoding: .utf8) else {
            throw AIError.parse("JSON 归档编码结果不是合法 UTF-8 文本")
        }
        return str
    }

    // MARK: - 辅助清洗方法

    private static func sanitizeFilename(_ name: String) -> String {
        let invalidCharacters = CharacterSet(charactersIn: "\\/:*?\"<>|\n\r\t")
        var cleaned = name.components(separatedBy: invalidCharacters).joined(separator: "")
        cleaned = cleaned.trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? "未命名知识卡" : cleaned
    }

    private static func sanitizeTag(_ text: String) -> String {
        let invalid = CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: ",;:\"'#"))
        return text.components(separatedBy: invalid).joined(separator: "_")
    }
}

private extension String {
    var htmlEscaped: String {
        self.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }
}
