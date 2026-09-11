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
        lastReviewedAt: Date? = nil
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
    }

    enum CodingKeys: String, CodingKey {
        case id, category, headline, summary, details, links, source
        case createdAt, seenAt, swiped, isFavorite, favoritedAt, reviewCount, masteryLevel, lastReviewedAt
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
