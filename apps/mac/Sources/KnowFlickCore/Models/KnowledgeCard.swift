import Foundation

/// 一条知识卡片（预置或 AI 生成）
public struct KnowledgeCard: Codable, Identifiable, Hashable, Sendable {
    public var id: UUID
    public var category: String        // 分类：物理 / 生物 / 历史 / 数学 ...
    public var headline: String        // 卡片标题（一句话冷知识）
    public var summary: String         // 卡片正面副标题
    public var details: String         // 详情页正文（可多段，\n\n 分段）
    public var links: [ScienceLink]    // 科普链接
    public var source: CardSource      // 来源：预置库 / AI 生成
    public var createdAt: Date
    public var seenAt: Date?           // 看过的时间（nil = 还没刷到）
    public var swiped: SwipeDirection? // 刷走意图
    /// 收藏状态：与 `swiped`（喜好意图）解耦；取消收藏只清此标记，不污染喜欢/不喜欢统计。
    public var isFavorite: Bool = false
    /// 收藏时间：收藏阁排序依据。与 `seenAt` 分离——收藏未读卡不应被计为「已浏览」。
    public var favoritedAt: Date? = nil

    public var reviewCount: Int = 0          // 累计复习次数
    public var masteryLevel: Int = 0         // 熟练度：0-未测验 1-学习中 2-已掌握
    public var lastReviewedAt: Date? = nil   // 上次复习时间戳
    public var repetition: Int = 0           // SM-2 连续成功复习次数
    public var intervalDays: Int = 1         // SM-2 / FSRS 下次复习间隔天数 (初始 1 天)
    public var easeFactor: Double = 2.5      // SM-2 简易度系数 EF (初始 2.5)
    public var stability: Double = 0.0       // FSRS 记忆稳定性 (0.0 表示未初始化)
    public var difficulty: Double = 0.0      // FSRS 记忆难度 (0.0 表示未初始化)

    // MARK: - 学科体系（三级：学科 → 分支 → 难度）
    //
    // 这六个字段全部可选，且**不参与** `category` 的语义：`category` 仍是展示用的叶子名
    // （全仓数百处引用它），学科能力一律读这里的派生结果 `SubjectRegistry.taxonomy(of:)`。
    // 旧 cards.json / 旧同步包没有这些键时解出 nil，行为与升级前完全一致。

    /// 学科 slug，如 `english`；nil 表示未分级（历史卡）
    public var subject: String? = nil
    /// 分支 slug，如 `grammar`；隶属某个 subject
    public var branch: String? = nil
    /// 内容难度 1...5。与 FSRS 的 `difficulty`（记忆难度）是两回事，不要混用
    public var level: Int? = nil
    /// 应试标尺名，如 `CET-6`、`中级会计`；给难度提供人类可读的解释
    public var track: String? = nil
    /// 分支内序号：决定「一点点看」的推进顺序
    public var orderKey: String? = nil
    /// 前置卡片 id：学习路径的边
    public var prereq: [String] = []

    public init(
        id: UUID = UUID(),
        category: String,
        headline: String,
        summary: String,
        details: String,
        links: [ScienceLink] = [],
        source: CardSource,
        createdAt: Date = Date(),
        seenAt: Date? = nil,
        swiped: SwipeDirection? = nil,
        isFavorite: Bool = false,
        favoritedAt: Date? = nil,
        reviewCount: Int = 0,
        masteryLevel: Int = 0,
        lastReviewedAt: Date? = nil,
        repetition: Int = 0,
        intervalDays: Int = 1,
        easeFactor: Double = 2.5,
        stability: Double = 0.0,
        difficulty: Double = 0.0,
        subject: String? = nil,
        branch: String? = nil,
        level: Int? = nil,
        track: String? = nil,
        orderKey: String? = nil,
        prereq: [String] = []
    ) {
        self.id = id
        self.category = category
        self.headline = headline
        self.summary = summary
        self.details = details
        self.links = links
        self.source = source
        self.createdAt = createdAt
        self.seenAt = seenAt
        self.swiped = swiped
        self.isFavorite = isFavorite
        self.favoritedAt = favoritedAt
        self.reviewCount = reviewCount
        self.masteryLevel = masteryLevel
        self.lastReviewedAt = lastReviewedAt
        self.repetition = repetition
        self.intervalDays = intervalDays
        self.easeFactor = easeFactor
        self.stability = stability
        self.difficulty = difficulty
        self.subject = subject
        self.branch = branch
        self.level = level
        self.track = track
        self.orderKey = orderKey
        self.prereq = prereq
    }

    enum CodingKeys: String, CodingKey {
        case id, category, headline, summary, details, links, source
        case createdAt, seenAt, swiped, isFavorite, favoritedAt, reviewCount, masteryLevel, lastReviewedAt
        case repetition, intervalDays, easeFactor, stability, difficulty
        case subject, branch, level, track, orderKey, prereq
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(UUID.self, forKey: .id)
        self.category = try container.decode(String.self, forKey: .category)
        self.headline = try container.decode(String.self, forKey: .headline)
        self.summary = try container.decode(String.self, forKey: .summary)
        self.details = try container.decode(String.self, forKey: .details)
        self.links = try container.decodeIfPresent([ScienceLink].self, forKey: .links) ?? []
        self.source = try container.decode(CardSource.self, forKey: .source)
        self.createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
        self.seenAt = try container.decodeIfPresent(Date.self, forKey: .seenAt)
        self.swiped = try container.decodeIfPresent(SwipeDirection.self, forKey: .swiped)
        // 旧数据无 isFavorite 字段：从「右划感兴趣」回填，保持既有收藏阁内容不丢。
        self.isFavorite = try container.decodeIfPresent(Bool.self, forKey: .isFavorite)
            ?? (self.swiped == .right)
        // 旧数据无 favoritedAt：用 seenAt 近似（收藏阁原有排序本就按 seenAt）
        self.favoritedAt = try container.decodeIfPresent(Date.self, forKey: .favoritedAt)
            ?? (self.isFavorite ? self.seenAt : nil)
        self.reviewCount = try container.decodeIfPresent(Int.self, forKey: .reviewCount) ?? 0
        self.masteryLevel = try container.decodeIfPresent(Int.self, forKey: .masteryLevel) ?? 0
        self.lastReviewedAt = try container.decodeIfPresent(Date.self, forKey: .lastReviewedAt)
        self.repetition = try container.decodeIfPresent(Int.self, forKey: .repetition) ?? 0
        self.intervalDays = try container.decodeIfPresent(Int.self, forKey: .intervalDays) ?? 1
        self.easeFactor = try container.decodeIfPresent(Double.self, forKey: .easeFactor) ?? 2.5
        self.stability = try container.decodeIfPresent(Double.self, forKey: .stability) ?? 0.0
        self.difficulty = try container.decodeIfPresent(Double.self, forKey: .difficulty) ?? 0.0
        subject = try container.decodeIfPresent(String.self, forKey: .subject)
        branch = try container.decodeIfPresent(String.self, forKey: .branch)
        level = try container.decodeIfPresent(Int.self, forKey: .level)
        track = try container.decodeIfPresent(String.self, forKey: .track)
        orderKey = try container.decodeIfPresent(String.self, forKey: .orderKey)
        prereq = try container.decodeIfPresent([String].self, forKey: .prereq) ?? []
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(category, forKey: .category)
        try container.encode(headline, forKey: .headline)
        try container.encode(summary, forKey: .summary)
        try container.encode(details, forKey: .details)
        try container.encode(links, forKey: .links)
        try container.encode(source, forKey: .source)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encodeIfPresent(seenAt, forKey: .seenAt)
        try container.encodeIfPresent(swiped, forKey: .swiped)
        try container.encode(isFavorite, forKey: .isFavorite)
        try container.encodeIfPresent(favoritedAt, forKey: .favoritedAt)
        try container.encode(reviewCount, forKey: .reviewCount)
        try container.encode(masteryLevel, forKey: .masteryLevel)
        try container.encodeIfPresent(lastReviewedAt, forKey: .lastReviewedAt)
        try container.encode(repetition, forKey: .repetition)
        try container.encode(intervalDays, forKey: .intervalDays)
        try container.encode(easeFactor, forKey: .easeFactor)
        if stability > 0.0 {
            try container.encode(stability, forKey: .stability)
        }
        if difficulty > 0.0 {
            try container.encode(difficulty, forKey: .difficulty)
        }
        // 学科字段只在有值时写出：未分级的历史卡不产生新键，双端与旧版本互传保持字节级友好
        try container.encodeIfPresent(subject, forKey: .subject)
        try container.encodeIfPresent(branch, forKey: .branch)
        try container.encodeIfPresent(level, forKey: .level)
        try container.encodeIfPresent(track, forKey: .track)
        try container.encodeIfPresent(orderKey, forKey: .orderKey)
        if !prereq.isEmpty {
            try container.encode(prereq, forKey: .prereq)
        }
    }
}

/// 科普链接
public struct ScienceLink: Codable, Hashable, Sendable {
    public var title: String
    public var url: String

    public init(title: String, url: String) {
        self.title = title
        self.url = url
    }
}

/// 卡片来源
public enum CardSource: String, Codable, Hashable, Sendable {
    case seed       // 预置知识库
    case ai         // AI 实时生成
    case imported   // 外部导入/提炼笔记

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = try container.decode(String.self)
        self = CardSource(rawValue: raw) ?? .seed
    }
}

/// 刷走意图
public enum SwipeDirection: String, Codable, Hashable, Sendable {
    case left    // 左划 = 不喜欢/换一张
    case right   // 右划 = 收藏/感兴趣
    case skip    // 系统操作（换一批）：仅计已刷，不表达喜好
}
