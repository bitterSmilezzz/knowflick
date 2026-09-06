import Foundation

/// 一条知识卡片（预置或 AI 生成）
public struct KnowledgeCard: Codable, Identifiable, Hashable {
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
        swiped: SwipeDirection? = nil
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
    }
}

/// 科普链接
public struct ScienceLink: Codable, Hashable {
    public var title: String
    public var url: String

    public init(title: String, url: String) {
        self.title = title
        self.url = url
    }
}

/// 卡片来源
public enum CardSource: String, Codable, Hashable {
    case seed    // 预置知识库
    case ai      // AI 实时生成
}

/// 刷走意图
public enum SwipeDirection: String, Codable, Hashable {
    case left    // 左划 = 不喜欢/换一张
    case right   // 右划 = 收藏/感兴趣
    case skip    // 系统操作（换一批）：仅计已刷，不表达喜好
}
