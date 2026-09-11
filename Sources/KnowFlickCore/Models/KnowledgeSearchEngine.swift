import Foundation

/// 搜索来源范围过滤
public enum SearchSourceFilter: String, CaseIterable, Identifiable, Sendable {
    case all = "全部来源"
    case seed = "预置精选"
    case ai = "AI 生成"
    case favorites = "仅已收藏"

    public var id: String { rawValue }
}

/// 匹配命中的字段类型
public enum SearchMatchedField: String, Sendable, Equatable {
    case headline = "标题"
    case category = "分类"
    case summary = "观点"
    case details = "正文"
    case link = "来源"
    case browse = "卡片"
}

/// 搜索结果项
public struct SearchResultItem: Identifiable, Sendable, Equatable {
    public var id: UUID { card.id }
    public let card: KnowledgeCard
    public let score: Int
    public let matchedField: SearchMatchedField
    public let matchedExcerpt: String
    public let isFavorite: Bool

    public init(
        card: KnowledgeCard,
        score: Int,
        matchedField: SearchMatchedField,
        matchedExcerpt: String,
        isFavorite: Bool
    ) {
        self.card = card
        self.score = score
        self.matchedField = matchedField
        self.matchedExcerpt = matchedExcerpt
        self.isFavorite = isFavorite
    }
}

/// 拼音与多音字辅助转换
public enum PinyinHelper {
    public static func pinyin(for string: String) -> String {
        guard !string.isEmpty else { return "" }
        let mutable = NSMutableString(string: string) as CFMutableString
        CFStringTransform(mutable, nil, kCFStringTransformMandarinLatin, false)
        CFStringTransform(mutable, nil, kCFStringTransformStripDiacritics, false)
        return (mutable as String).lowercased().replacingOccurrences(of: " ", with: "")
    }

    public static func initials(for string: String) -> String {
        guard !string.isEmpty else { return "" }
        let mutable = NSMutableString(string: string) as CFMutableString
        CFStringTransform(mutable, nil, kCFStringTransformMandarinLatin, false)
        CFStringTransform(mutable, nil, kCFStringTransformStripDiacritics, false)
        let parts = (mutable as String).components(separatedBy: .whitespacesAndNewlines)
        return parts.compactMap { $0.first }.map { String($0).lowercased() }.joined()
    }
}

/// 全文检索引擎：支持多字段加权排序、拼音全拼/首字母模糊查询与摘要截取
public final class KnowledgeSearchEngine: @unchecked Sendable {
    private struct PhoneticPair: Sendable {
        let full: String
        let initials: String
    }

    /// 拼音转换会调用 CoreFoundation，搜索框每输入一个字符都会重复触发。
    /// 在引擎实例内缓存字段转换结果，避免 400 张卡片反复做相同转换。
    private final class PhoneticCache: @unchecked Sendable {
        private var values: [String: PhoneticPair] = [:]
        private let lock = NSLock()
        private let capacity = 2048

        func value(for text: String) -> PhoneticPair {
            lock.lock()
            if let cached = values[text] {
                lock.unlock()
                return cached
            }
            lock.unlock()

            let pair = PhoneticPair(
                full: PinyinHelper.pinyin(for: text),
                initials: PinyinHelper.initials(for: text)
            )

            lock.lock()
            if values.count >= capacity { values.removeAll(keepingCapacity: true) }
            values[text] = pair
            lock.unlock()
            return pair
        }
    }

    private let phoneticCache = PhoneticCache()

    public init() {}

    /// 执行智能搜索
    public func search(
        query: String,
        category: String? = nil,
        source: SearchSourceFilter = .all,
        in cards: [KnowledgeCard],
        favorites: Set<UUID> = []
    ) -> [SearchResultItem] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let pinyinQuery = trimmed.isEmpty ? "" : trimmed.replacingOccurrences(of: " ", with: "")

        // 1. 过滤分类与来源
        let filtered = cards.filter { card in
            if let cat = category, !cat.isEmpty, cat != "全部" && card.category != cat {
                return false
            }
            switch source {
            case .all:
                return true
            case .seed:
                return card.source == .seed
            case .ai:
                return card.source == .ai
            case .favorites:
                return card.isFavorite || favorites.contains(card.id)
            }
        }

        // 2. 空查询：返回空结果，由视图渲染「输入关键词探索」引导与搜索建议
        //    （此前返回最近 40 条会让引导页与建议按钮永久不可达）
        if trimmed.isEmpty {
            return []
        }

        // 3. 全文检索与打分匹配
        var results: [SearchResultItem] = []

        for card in filtered {
            let headlineLower = card.headline.lowercased()
            let summaryLower = card.summary.lowercased()
            let categoryLower = card.category.lowercased()
            let linksText = card.links.map { "\($0.title) \($0.url)" }.joined(separator: " ").lowercased()

            var totalScore = 0
            var matchedField: SearchMatchedField? = nil
            var excerpt = card.headline

            // 1. 标题匹配（最高优先级与权重）
            if headlineLower == trimmed {
                totalScore += 120
                matchedField = .headline
                excerpt = card.headline
            } else if headlineLower.contains(trimmed) {
                totalScore += 80
                matchedField = .headline
                excerpt = card.headline
            } else {
                let phonetics = phoneticCache.value(for: card.headline)
                if phonetics.full.contains(pinyinQuery) || phonetics.initials.contains(pinyinQuery) {
                    totalScore += 65
                    matchedField = .headline
                    excerpt = card.headline
                }
            }

            // 2. 分类匹配
            if categoryLower == trimmed {
                totalScore += 70
                if matchedField == nil {
                    matchedField = .category
                    excerpt = "学科分类：\(card.category)"
                }
            } else if categoryLower.contains(trimmed) {
                totalScore += 50
                if matchedField == nil {
                    matchedField = .category
                    excerpt = "学科分类：\(card.category)"
                }
            } else {
                let phonetics = phoneticCache.value(for: card.category)
                if phonetics.full.contains(pinyinQuery) || phonetics.initials.contains(pinyinQuery) {
                    totalScore += 40
                    if matchedField == nil {
                        matchedField = .category
                        excerpt = "学科分类：\(card.category)"
                    }
                }
            }

            // 3. 观点摘要匹配
            if summaryLower.contains(trimmed) {
                totalScore += 35
                if matchedField == nil {
                    matchedField = .summary
                    excerpt = card.summary
                }
            } else {
                let phonetics = phoneticCache.value(for: card.summary)
                if phonetics.full.contains(pinyinQuery) {
                    totalScore += 25
                    if matchedField == nil {
                        matchedField = .summary
                        excerpt = card.summary
                    }
                }
            }

            // 4. 深度剖析正文匹配（在原字符串上做大小写不敏感查找，避免跨 lowercased() 副本的索引失效）
            if let range = card.details.range(of: trimmed, options: .caseInsensitive) {
                totalScore += 20
                if matchedField == nil {
                    matchedField = .details
                    excerpt = extractSnippet(from: card.details, around: range)
                }
            } else {
                let phonetics = phoneticCache.value(for: card.details)
                if phonetics.full.contains(pinyinQuery) {
                    totalScore += 12
                    if matchedField == nil {
                        matchedField = .details
                        excerpt = String(card.details.prefix(60)) + "…"
                    }
                }
            }

            // 5. 权威来源链接匹配
            if linksText.contains(trimmed) {
                totalScore += 10
                if matchedField == nil {
                    matchedField = .link
                    if let matchedLink = card.links.first(where: { $0.title.lowercased().contains(trimmed) || $0.url.lowercased().contains(trimmed) }) {
                        excerpt = "权威文献：\(matchedLink.title)"
                    } else {
                        excerpt = card.summary
                    }
                }
            }

            guard totalScore > 0, let field = matchedField else { continue }

            // 收藏额外加分
            let isFav = card.isFavorite || favorites.contains(card.id)
            if isFav { totalScore += 5 }

            results.append(SearchResultItem(
                card: card,
                score: totalScore,
                matchedField: field,
                matchedExcerpt: excerpt,
                isFavorite: isFav
            ))
        }

        // 4. 按匹配权重降序排序，若权重相同则按时间降序
        return results.sorted {
            if $0.score != $1.score {
                return $0.score > $1.score
            }
            let d0 = $0.card.seenAt ?? $0.card.createdAt
            let d1 = $1.card.seenAt ?? $1.card.createdAt
            return d0 > d1
        }
    }

    /// 截取关键词周围的上下文片段。
    /// 注意：调用方传入的 range 必须与 text 同源；这里统一用字符偏移量重算，
    /// 避免跨 lowercased() 副本传递 String.Index 造成索引失效 trap。
    private func extractSnippet(from text: String, around range: Range<String.Index>, radius: Int = 28) -> String {
        let lowerBound = text.distance(from: text.startIndex, to: range.lowerBound)
        let upperBound = text.distance(from: text.startIndex, to: range.upperBound)
        let startOffset = max(0, lowerBound - radius)
        let endOffset = min(text.count, upperBound + radius)
        guard let start = text.index(text.startIndex, offsetBy: startOffset, limitedBy: text.endIndex),
              let end = text.index(text.startIndex, offsetBy: endOffset, limitedBy: text.endIndex),
              start <= end else {
            return text
        }
        var snippet = String(text[start..<end])
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if start > text.startIndex { snippet = "…" + snippet }
        if end < text.endIndex { snippet = snippet + "…" }
        return snippet
    }
}
