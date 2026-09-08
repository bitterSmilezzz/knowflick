import Foundation

/// 知识卡片关联关系分类
public enum RelationKind: String, Codable, CaseIterable, Sendable {
    case disciplineDeepen   // 同领域深化
    case crossDiscipline    // 交叉学科碰撞
    case conceptBridge      // 核心概念共鸣
    case serendipity        // 灵感偶遇

    public var title: String {
        switch self {
        case .disciplineDeepen: return "同领域深化"
        case .crossDiscipline: return "交叉学科碰撞"
        case .conceptBridge: return "核心概念共鸣"
        case .serendipity: return "灵感偶遇"
        }
    }

    public var icon: String {
        switch self {
        case .disciplineDeepen: return "atom"
        case .crossDiscipline: return "sparkles"
        case .conceptBridge: return "link"
        case .serendipity: return "wand.and.stars"
        }
    }
}

/// 关联卡片单项
public struct RelatedCardItem: Identifiable, Hashable, Sendable {
    public var id: UUID { card.id }
    public let card: KnowledgeCard
    public let kind: RelationKind
    public let score: Double
    public let reason: String

    public init(card: KnowledgeCard, kind: RelationKind, score: Double, reason: String) {
        self.card = card
        self.kind = kind
        self.score = score
        self.reason = reason
    }
}

/// 星图节点模型
public struct GraphNode: Identifiable, Hashable, Sendable {
    public let id: UUID
    public let cardId: UUID
    public let category: String
    public let headline: String
    public var x: CGFloat
    public var y: CGFloat
    public var radius: CGFloat
    public var masteryLevel: Int
    public var connectionsCount: Int

    public init(
        id: UUID = UUID(),
        cardId: UUID,
        category: String,
        headline: String,
        x: CGFloat,
        y: CGFloat,
        radius: CGFloat = 8,
        masteryLevel: Int = 0,
        connectionsCount: Int = 0
    ) {
        self.id = id
        self.cardId = cardId
        self.category = category
        self.headline = headline
        self.x = x
        self.y = y
        self.radius = radius
        self.masteryLevel = masteryLevel
        self.connectionsCount = connectionsCount
    }
}

/// 星图引力连线
public struct GraphEdge: Identifiable, Hashable, Sendable {
    public var id: String { "\(sourceId.uuidString)_\(targetId.uuidString)" }
    public let sourceId: UUID
    public let targetId: UUID
    public let weight: Double
    public let kind: RelationKind

    public init(sourceId: UUID, targetId: UUID, weight: Double, kind: RelationKind) {
        self.sourceId = sourceId
        self.targetId = targetId
        self.weight = weight
        self.kind = kind
    }
}

/// 星图全景拓扑数据
public struct KnowledgeGraphData: Sendable {
    public let nodes: [GraphNode]
    public let edges: [GraphEdge]

    public init(nodes: [GraphNode], edges: [GraphEdge]) {
        self.nodes = nodes
        self.edges = edges
    }
}

/// 语义关联与星图拓扑计算引擎
public enum KnowledgeGraphEngine {
    /// 跨学科亲和矩阵（双向关系加权）
    private static let disciplineAffinity: [String: Set<String>] = [
        "物理": ["天文", "数学", "化学", "科技", "编程"],
        "天文": ["物理", "数学", "科技", "地理"],
        "数学": ["物理", "AI", "编程", "算法", "投资理财", "中级会计"],
        "化学": ["物理", "生物", "材料"],
        "生物": ["生态", "脑科学", "心理", "生命", "医学"],
        "脑科学": ["生物", "心理", "AI", "认知科学", "学习方法"],
        "心理": ["脑科学", "社会", "哲学", "学习方法"],
        "哲学": ["历史", "心理", "语言", "社会", "物理"],
        "历史": ["哲学", "地理", "社会", "语言"],
        "AI": ["编程", "算法", "数学", "脑科学", "AI Agent", "AI 开发", "科技"],
        "AI Agent": ["AI", "编程", "AI 开发", "科技"],
        "AI 开发": ["AI", "编程", "AI Agent", "科技"],
        "编程": ["AI", "算法", "数学", "科技", "Rust", "Python"],
        "Rust": ["编程", "科技", "算法"],
        "Python": ["编程", "AI", "算法"],
        "投资理财": ["中级会计", "经济", "数学"],
        "中级会计": ["投资理财", "经济", "数学"],
        "语言": ["历史", "哲学", "社会", "心理"]
    ]

    /// 停止词列表，降低无关词重合干扰
    private static let stopWords: Set<String> = [
        "这个", "那个", "不是", "就是", "可以", "以及", "通过", "因为", "所以",
        "为了", "虽然", "但是", "如果", "进行", "这些", "那些", "一种", "关于",
        "例如", "主要", "其实", "产生", "同时", "并且", "由于", "出现", "目前",
        "这是一种", "这是", "在", "的", "了", "和", "是", "与", "或", "等", "而", "及"
    ]

    /// 提取卡片核心关键词集合
    public static func extractKeywords(from card: KnowledgeCard) -> Set<String> {
        let text = "\(card.headline) \(card.summary) \(card.details)".lowercased()
        var words = Set<String>()

        // 英文与数字分词
        let enTokens = text.components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { $0.count >= 2 && !stopWords.contains($0) }
        words.formUnion(enTokens)

        // 中文双字与三字 N-Gram 提取
        let chars = Array(text)
        if chars.count >= 2 {
            for i in 0..<(chars.count - 1) {
                let s2 = String(chars[i...i+1]).trimmingCharacters(in: .whitespacesAndNewlines)
                if s2.count == 2 && !stopWords.contains(s2) && isPureChinese(s2) {
                    words.insert(s2)
                }
                if i + 2 < chars.count {
                    let s3 = String(chars[i...i+2]).trimmingCharacters(in: .whitespacesAndNewlines)
                    if s3.count == 3 && !stopWords.contains(s3) && isPureChinese(s3) {
                        words.insert(s3)
                    }
                }
            }
        }

        return words
    }

    private static func isPureChinese(_ str: String) -> Bool {
        for scalar in str.unicodeScalars {
            if scalar.value < 0x4e00 || scalar.value > 0x9fa5 {
                return false
            }
        }
        return true
    }

    /// 计算两张卡片的关联相似度与关联性质
    public static func evaluateRelation(cardA: KnowledgeCard, cardB: KnowledgeCard) -> (kind: RelationKind, score: Double, reason: String)? {
        evaluateRelation(cardA: cardA, cardB: cardB,
                         kwA: extractKeywords(from: cardA), kwB: extractKeywords(from: cardB))
    }

    private static func evaluateRelation(
        cardA: KnowledgeCard, cardB: KnowledgeCard, kwA: Set<String>, kwB: Set<String>
    ) -> (kind: RelationKind, score: Double, reason: String)? {
        guard cardA.id != cardB.id else { return nil }

        let intersection = kwA.intersection(kwB)
        let union = kwA.union(kwB)
        let jaccard = union.isEmpty ? 0.0 : Double(intersection.count) / Double(union.count)

        let isSameCategory = (cardA.category == cardB.category) && !cardA.category.isEmpty
        let affinitySet = disciplineAffinity[cardA.category] ?? []
        let hasDisciplineAffinity = affinitySet.contains(cardB.category)
            || (disciplineAffinity[cardB.category]?.contains(cardA.category) ?? false)

        let commonWordsSample = Array(intersection.sorted().prefix(2)).joined(separator: "、")
        let sharedTopicReason = commonWordsSample.isEmpty ? "" : "围绕「\(commonWordsSample)」概念"

        if isSameCategory {
            let score = 0.35 + jaccard * 1.5
            let reason = sharedTopicReason.isEmpty ? "同属 \(cardA.category) 知识脉络" : "\(cardA.category) 深度拓展：\(sharedTopicReason)"
            return (.disciplineDeepen, score, reason)
        } else if hasDisciplineAffinity {
            let score = 0.25 + jaccard * 1.8
            let reason = sharedTopicReason.isEmpty ? "跨学科启发：\(cardA.category) ↔ \(cardB.category)" : "跨界碰撞：\(cardA.category) 与 \(cardB.category) \(sharedTopicReason)"
            return (.crossDiscipline, score, reason)
        } else if jaccard >= 0.04 {
            let score = 0.20 + jaccard * 2.0
            let reason = "概念共鸣：跨越学科 \(sharedTopicReason)"
            return (.conceptBridge, score, reason)
        } else {
            // 偶然灵感连线
            return nil
        }
    }

    /// 为指定卡片寻找最佳关联的 2~3 张知识卡片
    public static func findRelatedCards(
        for card: KnowledgeCard,
        in pool: [KnowledgeCard],
        limit: Int = 3
    ) -> [RelatedCardItem] {
        guard limit > 0 else { return [] }
        let keywords = extractKeywords(from: card)
        var scored: [RelatedCardItem] = []

        for other in pool where other.id != card.id {
            if let result = evaluateRelation(cardA: card, cardB: other, kwA: keywords, kwB: extractKeywords(from: other)) {
                scored.append(RelatedCardItem(
                    card: other,
                    kind: result.kind,
                    score: result.score,
                    reason: result.reason
                ))
            }
        }

        // 按评分倒序
        scored.sort { $0.score > $1.score }

        // 若不足指定数量，补充同分类或随机灵感卡片
        if scored.count < limit {
            let existingIds = Set(scored.map(\.id) + [card.id])
            let candidates = pool.filter { !existingIds.contains($0.id) }

            for candidate in candidates.shuffled().prefix(limit - scored.count) {
                scored.append(RelatedCardItem(
                    card: candidate,
                    kind: .serendipity,
                    score: 0.15,
                    reason: "灵感偶遇：从 \(candidate.category) 探索新视角"
                ))
            }
        }

        return Array(scored.prefix(limit))
    }

    /// 将卡片集映射为星空引力拓扑图
    public static func buildGraph(
        from cards: [KnowledgeCard],
        width: CGFloat = 860,
        height: CGFloat = 620
    ) -> KnowledgeGraphData {
        guard !cards.isEmpty else {
            return KnowledgeGraphData(nodes: [], edges: [])
        }

        let centerX = width / 2.0
        let centerY = height / 2.0

        // 收集所有分类并为各分类分配星系圆心角
        let categories = Array(Set(cards.map(\.category))).sorted()
        var categoryAngles: [String: Double] = [:]
        for (idx, cat) in categories.enumerated() {
            let angle = (Double(idx) / Double(max(1, categories.count))) * 2.0 * .pi
            categoryAngles[cat] = angle
        }

        var nodes: [GraphNode] = []


        for card in cards {
            let catAngle = categoryAngles[card.category] ?? 0
            // 在所属分类星云附近散布，半径 140~270
            let seed = Double(CardThemeResolver.deterministicHash(card.id.uuidString) % 10000) / 10000.0
            let angleJitter = (seed - 0.5) * 0.9
            let radiusDist = 120.0 + seed * 160.0

            let finalAngle = catAngle + angleJitter
            let nx = centerX + CGFloat(cos(finalAngle) * radiusDist)
            let ny = centerY + CGFloat(sin(finalAngle) * radiusDist * 0.78)

            let node = GraphNode(
                id: card.id,
                cardId: card.id,
                category: card.category,
                headline: card.headline,
                x: nx,
                y: ny,
                radius: 7.0 + CGFloat(min(card.reviewCount, 5)) * 1.2,
                masteryLevel: card.masteryLevel,
                connectionsCount: 0
            )
            nodes.append(node)

        }

        // 计算节点之间的强关联引力线
        var edges: [GraphEdge] = []
        var connectionTally: [UUID: Int] = [:]

        let keywords = cards.map { extractKeywords(from: $0) }
        for i in 0..<cards.count {
            if Task.isCancelled { return KnowledgeGraphData(nodes: [], edges: []) }
            let cardA = cards[i]
            // 寻找最强的 1~2 个连线
            var bestMatches: [(other: KnowledgeCard, kind: RelationKind, score: Double)] = []

            for j in (i + 1)..<cards.count {
                let cardB = cards[j]
                if let rel = evaluateRelation(cardA: cardA, cardB: cardB, kwA: keywords[i], kwB: keywords[j]) {
                    bestMatches.append((cardB, rel.kind, rel.score))
                }
            }

            bestMatches.sort { $0.score > $1.score }
            for match in bestMatches.prefix(2) {
                let edge = GraphEdge(
                    sourceId: cardA.id,
                    targetId: match.other.id,
                    weight: match.score,
                    kind: match.kind
                )
                edges.append(edge)
                connectionTally[cardA.id, default: 0] += 1
                connectionTally[match.other.id, default: 0] += 1
            }
        }

        // 更新各节点的连接度
        for i in 0..<nodes.count {
            let cid = nodes[i].cardId
            let count = connectionTally[cid, default: 0]
            nodes[i].connectionsCount = count
            nodes[i].radius = max(6.5, min(14.0, 7.0 + CGFloat(count) * 1.5))
        }

        return KnowledgeGraphData(nodes: nodes, edges: edges)
    }
}
