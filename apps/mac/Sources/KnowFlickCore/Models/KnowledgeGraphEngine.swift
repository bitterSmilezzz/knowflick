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

    /// 提取卡片核心关键词集合。
    /// 结果按内容哈希缓存（详情页相关卡、星图构建会反复对全池调用），线程安全。
    public static func extractKeywords(from card: KnowledgeCard) -> Set<String> {
        let key = CardThemeResolver.deterministicHash("\(card.category)|\(card.headline)|\(card.summary)|\(card.details)")
        cacheLock.lock()
        if let cached = keywordCache[key] {
            cacheLock.unlock()
            return cached
        }
        cacheLock.unlock()

        let computed = computeKeywords(from: card)

        cacheLock.lock()
        if keywordCache.count >= 4096 { keywordCache.removeAll(keepingCapacity: false) }
        keywordCache[key] = computed
        cacheLock.unlock()
        return computed
    }

    private static let cacheLock = NSLock()
    // 锁纪律：keywordCache 仅在 cacheLock 保护下读写（Swift 6 静态可变状态显式豁免）
    nonisolated(unsafe) private static var keywordCache: [UInt64: Set<String>] = [:]

    private static func computeKeywords(from card: KnowledgeCard) -> Set<String> {
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

    /// 计算两张卡片的关联相似度与关联性质（含用户可见的关联文案）
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

        guard let classified = classify(cardA: cardA, cardB: cardB, jaccard: jaccard) else { return nil }

        let commonWordsSample = Array(intersection.sorted().prefix(2)).joined(separator: "、")
        let sharedTopicReason = commonWordsSample.isEmpty ? "" : "围绕「\(commonWordsSample)」概念"
        return (classified.kind, classified.score, reason(for: classified.kind, cardA: cardA, cardB: cardB, sharedTopicReason: sharedTopicReason))
    }

    /// 关系判定内核：**只看 jaccard 与分类亲和**，不含文案。
    ///
    /// 为什么和文案分开：星图构图需要判定全部 n(n−1)/2 对关系，但**不需要**文案；
    /// 文案依赖「实际重合了哪些词」（`intersection.sorted()`），把两部分拆开后，
    /// 构图侧就能用倒排索引算出的重合**计数**直接得到 jaccard，省掉每对一次的 Set 交集/并集分配。
    private static func classify(
        cardA: KnowledgeCard, cardB: KnowledgeCard, jaccard: Double
    ) -> (kind: RelationKind, score: Double)? {
        let isSameCategory = (cardA.category == cardB.category) && !cardA.category.isEmpty
        if isSameCategory {
            return (.disciplineDeepen, 0.35 + jaccard * 1.5)
        }
        let affinitySet = disciplineAffinity[cardA.category] ?? []
        let hasDisciplineAffinity = affinitySet.contains(cardB.category)
            || (disciplineAffinity[cardB.category]?.contains(cardA.category) ?? false)
        if hasDisciplineAffinity {
            return (.crossDiscipline, 0.25 + jaccard * 1.8)
        }
        if jaccard >= 0.04 {
            return (.conceptBridge, 0.20 + jaccard * 2.0)
        }
        // 偶然灵感连线：不成立
        return nil
    }

    /// 关联文案（与 `classify` 的四种性质一一对应）
    private static func reason(
        for kind: RelationKind, cardA: KnowledgeCard, cardB: KnowledgeCard, sharedTopicReason: String
    ) -> String {
        switch kind {
        case .disciplineDeepen:
            return sharedTopicReason.isEmpty ? "同属 \(cardA.category) 知识脉络" : "\(cardA.category) 深度拓展：\(sharedTopicReason)"
        case .crossDiscipline:
            return sharedTopicReason.isEmpty
                ? "跨学科启发：\(cardA.category) ↔ \(cardB.category)"
                : "跨界碰撞：\(cardA.category) 与 \(cardB.category) \(sharedTopicReason)"
        case .conceptBridge:
            return "概念共鸣：跨越学科 \(sharedTopicReason)"
        case .serendipity:
            return "灵感偶遇：从 \(cardB.category) 探索新视角"
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
    /// 节点包围盒（世界坐标）；空图返回 nil
    public struct GraphBounds: Equatable, Sendable {
        public let minX: CGFloat
        public let minY: CGFloat
        public let maxX: CGFloat
        public let maxY: CGFloat
    }

    /// 视口自适应结果：screen = world * scale + offset
    public struct GraphFit: Equatable, Sendable {
        public let scale: CGFloat
        public let offsetX: CGFloat
        public let offsetY: CGFloat
    }

    /// 由卡片 id + 盐值确定性派生 [0,1) 实数（同一张卡坐标永远一致）
    private static func hashUnit(_ seed: String, salt: String) -> Double {
        let mixed = CardThemeResolver.deterministicHash("\(seed)|\(salt)") % 1_000_000
        return Double(mixed) / 1_000_000.0
    }

    public static func bounds(of nodes: [GraphNode]) -> GraphBounds? {
        guard let first = nodes.first else { return nil }
        var minX = first.x, maxX = first.x, minY = first.y, maxY = first.y
        for node in nodes.dropFirst() {
            minX = min(minX, node.x); maxX = max(maxX, node.x)
            minY = min(minY, node.y); maxY = max(maxY, node.y)
        }
        return GraphBounds(minX: minX, minY: minY, maxX: maxX, maxY: maxY)
    }

    /// 把包围盒等比缩放并居中到视口内（四周留 padding）。
    /// 纯函数，与 Android 端 `fitToViewport` 同口径，便于双端各测一遍锁住行为。
    public static func fitToViewport(
        bounds: GraphBounds,
        viewWidth: CGFloat,
        viewHeight: CGFloat,
        padding: CGFloat = 24,
        minScale: CGFloat = 0.45,
        maxScale: CGFloat = 3.2
    ) -> GraphFit {
        guard viewWidth > 0, viewHeight > 0 else { return GraphFit(scale: 1, offsetX: 0, offsetY: 0) }
        let bboxWidth = max(1, bounds.maxX - bounds.minX)
        let bboxHeight = max(1, bounds.maxY - bounds.minY)
        let usableWidth = max(1, viewWidth - padding * 2)
        let usableHeight = max(1, viewHeight - padding * 2)
        let scale = min(usableWidth / bboxWidth, usableHeight / bboxHeight).clamped(to: minScale...maxScale)
        let centerX = (bounds.minX + bounds.maxX) / 2
        let centerY = (bounds.minY + bounds.maxY) / 2
        return GraphFit(scale: scale, offsetX: viewWidth / 2 - centerX * scale, offsetY: viewHeight / 2 - centerY * scale)
    }

    public static func buildGraph(
        from cards: [KnowledgeCard],
        width: CGFloat = 860,
        height: CGFloat = 620
    ) -> KnowledgeGraphData {
        guard !cards.isEmpty else {
            return KnowledgeGraphData(nodes: [], edges: [])
        }

        // 结果缓存：构图只依赖「拓扑相关字段」（分类/标题/摘要/正文/复习次数/掌握度 + 画布尺寸），
        // 而视图侧以**整个卡片数组**为 task id——划卡、收藏、复习都会换出新数组并重启构图。
        // 命中缓存后这些与拓扑无关的变化不再重算 n² 关系（实测 216 张冷启动 3.4~4.2s）。
        let signature = graphSignature(cards: cards, width: width, height: height)
        if let cached = graphCache.graph(for: signature) {
            recordDiagnostics(BuildDiagnostics(
                didHitCache: true, sharedKeywordPairs: 0,
                pairsEvaluated: cards.count * (cards.count - 1) / 2
            ))
            return cached
        }

        let centerX = width / 2.0
        let centerY = height / 2.0

        // 收集所有分类并为各分类分配星系圆心角
        let categories = Array(Set(cards.map(\.category))).sorted()
        let sector = 2.0 * .pi / Double(max(1, categories.count))
        var categoryAngles: [String: Double] = [:]
        for (idx, cat) in categories.enumerated() {
            categoryAngles[cat] = Double(idx) * sector
        }

        var nodes: [GraphNode] = []


        for card in cards {
            let catAngle = categoryAngles[card.category] ?? 0
            // 两个独立确定性哈希：角度铺满整个学科扇区、半径按 sqrt 均匀覆盖面积。
            // 旧写法只在扇区中轴附近抖 ±0.45rad，单学科或两学科的片子会塌成一条横线。
            let angleSeed = hashUnit(card.id.uuidString, salt: "angle")
            let radiusSeed = hashUnit(card.id.uuidString, salt: "radius")
            let radiusDist = 120.0 + sqrt(radiusSeed) * 160.0
            let finalAngle = catAngle + angleSeed * sector
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
        // 关键词倒排索引：一次建立，之后每张卡只需遍历自己的关键词就能得到与所有后续卡的**重合计数**。
        // 这是本轮优化的核心——原实现对每一对卡片都要做 Set 的 intersection + union
        // （关键词集平均 473 元、并集近千元），216 张即 23 220 次集合分配，实测 3.4~4.2s 纯 CPU。
        // 改为计数后：jaccard = 重合数 / (|A| + |B| − 重合数)，与原来的逐位判定完全等价（有等价性测试）。
        var postings: [String: [Int]] = [:]
        postings.reserveCapacity(keywords.reduce(0) { $0 + $1.count } / 2)
        for (index, kw) in keywords.enumerated() {
            for word in kw {
                postings[word, default: []].append(index)
            }
        }

        let pairsEvaluated = cards.count * (cards.count - 1) / 2
        var sharedKeywordPairs = 0

        for i in 0..<cards.count {
            if Task.isCancelled {
                // 取消时不丢弃已完成的工作：返回已建节点与当前累计边（连接度/半径口径一致），而非空图。
                // 取消得到的是半成品，因此**不写缓存**。
                finalizeNodeDegrees(&nodes, tally: connectionTally)
                recordDiagnostics(BuildDiagnostics(didHitCache: false, sharedKeywordPairs: sharedKeywordPairs, pairsEvaluated: pairsEvaluated))
                return KnowledgeGraphData(nodes: nodes, edges: edges)
            }
            let cardA = cards[i]

            var sharedCounts: [Int: Int] = [:]
            for word in keywords[i] {
                guard let posting = postings[word] else { continue }
                for j in posting where j > i {
                    sharedCounts[j, default: 0] += 1
                }
            }
            sharedKeywordPairs += sharedCounts.count

            let keyCountA = keywords[i].count
            // 寻找最强的 1~2 个连线
            var bestMatches: [(index: Int, kind: RelationKind, score: Double)] = []

            for j in (i + 1)..<cards.count {
                let shared = sharedCounts[j] ?? 0
                let unionCount = keyCountA + keywords[j].count - shared
                let jaccard = unionCount == 0 ? 0.0 : Double(shared) / Double(unionCount)
                if let relation = classify(cardA: cardA, cardB: cards[j], jaccard: jaccard) {
                    bestMatches.append((j, relation.kind, relation.score))
                }
            }

            // 平局按下标升序：Swift 的 sort 不稳定，显式规则保证「同一份数据两次构图结果一致」
            bestMatches.sort { $0.score != $1.score ? $0.score > $1.score : $0.index < $1.index }
            for match in bestMatches.prefix(2) {
                let edge = GraphEdge(
                    sourceId: cardA.id,
                    targetId: cards[match.index].id,
                    weight: match.score,
                    kind: match.kind
                )
                edges.append(edge)
                connectionTally[cardA.id, default: 0] += 1
                connectionTally[cards[match.index].id, default: 0] += 1
            }
        }

        finalizeNodeDegrees(&nodes, tally: connectionTally)
        let graph = KnowledgeGraphData(nodes: nodes, edges: edges)
        graphCache.store(graph, for: signature)
        recordDiagnostics(BuildDiagnostics(didHitCache: false, sharedKeywordPairs: sharedKeywordPairs, pairsEvaluated: pairsEvaluated))
        return graph
    }

    /// 连接度与半径按累计连线数回填（取消路径与正常路径共用，口径一致）
    private static func finalizeNodeDegrees(_ nodes: inout [GraphNode], tally: [UUID: Int]) {
        for i in 0..<nodes.count {
            let count = tally[nodes[i].cardId, default: 0]
            nodes[i].connectionsCount = count
            nodes[i].radius = max(6.5, min(14.0, 7.0 + CGFloat(count) * 1.5))
        }
    }

    // MARK: - 构图内容签名与结果缓存

    /// 构图内容签名：只取**影响拓扑**的字段。划卡/收藏/来源等状态变化不换图，因此能命中缓存
    /// （视图侧以整个卡片数组为 task id，这些变化都会重启构图）。
    static func graphSignature(cards: [KnowledgeCard], width: CGFloat, height: CGFloat) -> UInt64 {
        var signature = CardThemeResolver.deterministicHash("\(Int(width.rounded()))x\(Int(height.rounded()))")
        for card in cards {
            let part = "\(card.id.uuidString)|\(card.category)|\(card.headline)|\(card.summary)|\(card.details)|\(card.reviewCount)|\(card.masteryLevel)"
            signature = signature &* 1_099_511_628_211 &+ CardThemeResolver.deterministicHash(part)
        }
        return signature
    }

    /// 最近一次构图的诊断快照（测试与性能观测用；不含用户数据）
    struct BuildDiagnostics: Sendable, Equatable {
        public let didHitCache: Bool
        /// 有多少对卡片存在**非零**关键词重合：优化前的实现对全部对都做集合运算，这一项是索引命中规模
        public let sharedKeywordPairs: Int
        /// 本轮评估的两两对数 = n(n−1)/2
        public let pairsEvaluated: Int
    }

    private static let diagnosticsBox = DiagnosticsBox()
    private static let graphCache = GraphCacheBox()

    static var lastBuildDiagnostics: BuildDiagnostics? { diagnosticsBox.value }

    private static func recordDiagnostics(_ diagnostics: BuildDiagnostics) {
        diagnosticsBox.set(diagnostics)
    }

    private final class DiagnosticsBox: @unchecked Sendable {
        private let lock = NSLock()
        private var stored: BuildDiagnostics?
        var value: BuildDiagnostics? {
            lock.lock(); defer { lock.unlock() }
            return stored
        }
        func set(_ newValue: BuildDiagnostics) {
            lock.lock(); stored = newValue; lock.unlock()
        }
    }

    /// 图结果缓存（容量 6）：同一份卡片重复构图直接复用。
    /// 星图改成按学科分片后，缓存的键是「某一片」的签名——容量 2 会在来回切学科时把刚看过的片挤掉，
    /// 每次切换都重算 O(n²)，所以放宽到 6（覆盖常见学科数，超出者按 LRU 淘汰）。
    /// 锁纪律：仅经 lock 读写（Swift 6 下以 @unchecked Sendable 显式豁免静态可变状态检查）。
    private final class GraphCacheBox: @unchecked Sendable {
        private let lock = NSLock()
        private var entries: [(signature: UInt64, graph: KnowledgeGraphData)] = []

        func graph(for signature: UInt64) -> KnowledgeGraphData? {
            lock.lock(); defer { lock.unlock() }
            guard let index = entries.firstIndex(where: { $0.signature == signature }) else { return nil }
            let hit = entries.remove(at: index)
            entries.append(hit)   // 最近命中者后移，实现 LRU
            return hit.graph
        }

        func store(_ graph: KnowledgeGraphData, for signature: UInt64) {
            lock.lock(); defer { lock.unlock() }
            entries.removeAll { $0.signature == signature }
            entries.append((signature, graph))
            if entries.count > 6 { entries.removeFirst(entries.count - 6) }
        }
    }
}

private extension Comparable {
    func clamped(to limits: ClosedRange<Self>) -> Self {
        min(max(self, limits.lowerBound), limits.upperBound)
    }
}
