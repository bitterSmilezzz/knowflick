import Foundation

/// 一条知识卡片（预置或 AI 生成）
struct KnowledgeCard: Codable, Identifiable, Hashable {
    var id: UUID
    var category: String        // 分类：物理 / 生物 / 历史 / 数学 ...
    var headline: String        // 卡片标题（一句话冷知识）
    var summary: String         // 卡片正面副标题
    var details: String         // 详情页正文（可多段，\n\n 分段）
    var links: [ScienceLink]    // 科普链接
    var source: CardSource      // 来源：预置库 / AI 生成
    var createdAt: Date
    var seenAt: Date?           // 看过的时间（nil = 还没刷到）
    var swiped: SwipeDirection? // 刷走方向

    init(
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
struct ScienceLink: Codable, Hashable {
    var title: String
    var url: String
}

/// 卡片来源
enum CardSource: String, Codable, Hashable {
    case seed    // 预置知识库
    case ai      // AI 实时生成
}

/// 刷走方向
enum SwipeDirection: String, Codable, Hashable {
    case left    // 左划 = 不喜欢/换一张
    case right   // 右划 = 收藏/感兴趣
}
