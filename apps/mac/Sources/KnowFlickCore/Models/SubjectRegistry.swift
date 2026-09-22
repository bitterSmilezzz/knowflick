import Foundation

/// 分支定义
public struct BranchSpec: Equatable, Sendable {
    public let slug: String
    public let name: String

    public init(slug: String, name: String) {
        self.slug = slug
        self.name = name
    }
}

/// 学科定义（含可选的应试标尺与分支列表）
public struct SubjectSpec: Equatable, Sendable {
    public let slug: String
    public let name: String
    public let tracks: [String]
    public let branches: [BranchSpec]

    public init(slug: String, name: String, tracks: [String] = [], branches: [BranchSpec] = []) {
        self.slug = slug
        self.name = name
        self.tracks = tracks
        self.branches = branches
    }

    public func branch(_ slug: String?) -> BranchSpec? {
        guard let slug else { return nil }
        return branches.first { $0.slug == slug }
    }
}

/// 一张卡片生效后的学科坐标。
///
/// `subject/branch/level/track` 全部可空：历史卡与未分级的导入内容会落到 `subject == nil`，
/// 界面按「未分级」呈现，而不是被硬塞进某个学科。
public struct CardTaxonomy: Equatable, Sendable {
    public let subject: String?
    public let branch: String?
    public let level: Int?
    public let track: String?
    public let orderKey: String?

    public init(subject: String?, branch: String?, level: Int?, track: String?, orderKey: String?) {
        self.subject = subject
        self.branch = branch
        self.level = level
        self.track = track
        self.orderKey = orderKey
    }

    /// 未显式分级时，从旧 `category` 派生出的学科（迁移期的主要路径）
    public var isDerived: Bool { subject != nil && level == nil }
}

/// 学科 → 分支 → 难度 的单一注册表。
///
/// ## 为什么表内嵌在代码里，而不是运行时读 `shared/assets/taxonomy_map.json`
/// mac 端资源要经 SwiftPM bundle（见 `CoreResources` 的两种工具链差异）、Android 端要进 APK assets，
/// 两处都出现过「本地有、CI 没有」的脆弱历史。因此表内嵌，JSON 只作为**契约夹具**：
/// 两端各有一个 parity 测试把内嵌表与该文件逐条比对，Python 管道也读同一个文件——
/// 任何一侧改漏，测试与 CI 立刻红。
public enum SubjectRegistry {

    /// 难度档位命名（1..5）。注意与 FSRS 的 `difficulty`（记忆难度）无关。
    public static let levels: [Int: String] = [
        1: "入门", 2: "基础", 3: "进阶", 4: "应试实战", 5: "精通",
    ]

    public static let subjects: [SubjectSpec] = [
        SubjectSpec(slug: "ai", name: "AI", branches: [
            BranchSpec(slug: "basics", name: "AI 基础"),
            BranchSpec(slug: "agents", name: "AI Agent"),
            BranchSpec(slug: "tools", name: "工具与用法"),
        ]),
        SubjectSpec(slug: "ai-dev", name: "AI 开发", branches: [
            BranchSpec(slug: "prompt", name: "提示工程"),
            BranchSpec(slug: "rag", name: "RAG 与检索"),
            BranchSpec(slug: "finetune", name: "微调与训练"),
            BranchSpec(slug: "app", name: "应用开发"),
        ]),
        SubjectSpec(slug: "english", name: "英语", tracks: ["高中英语", "大学英语四级", "大学英语六级"], branches: [
            BranchSpec(slug: "vocabulary", name: "词汇"),
            BranchSpec(slug: "grammar", name: "语法"),
            BranchSpec(slug: "reading", name: "阅读"),
            BranchSpec(slug: "listening", name: "听力"),
            BranchSpec(slug: "writing", name: "写作"),
        ]),
        SubjectSpec(slug: "accounting", name: "会计", tracks: ["初级会计", "中级会计", "注册会计师"], branches: [
            BranchSpec(slug: "assets", name: "资产"),
            BranchSpec(slug: "liabilities", name: "负债与所有者权益"),
            BranchSpec(slug: "revenue", name: "收入与费用"),
            BranchSpec(slug: "cost", name: "成本核算"),
            BranchSpec(slug: "reporting", name: "报表编制"),
        ]),
        SubjectSpec(slug: "finance", name: "金融", branches: [
            BranchSpec(slug: "statements", name: "财报分析"),
            BranchSpec(slug: "valuation", name: "估值"),
            BranchSpec(slug: "risk", name: "风险与配置"),
            BranchSpec(slug: "instruments", name: "品种与市场"),
        ]),
        SubjectSpec(slug: "programming", name: "编程架构", branches: [
            BranchSpec(slug: "architecture", name: "系统架构"),
            BranchSpec(slug: "algorithms", name: "算法与数据结构"),
            BranchSpec(slug: "data", name: "数据与存储"),
            BranchSpec(slug: "delivery", name: "工程实践"),
        ]),
        SubjectSpec(slug: "trivia", name: "冷知识", branches: []),
    ]

    /// 历史单层 `category` → 学科坐标。未列出的分类（物理/天文/数学…）视为未分级。
    public struct LegacyMapping: Equatable, Sendable {
        public let subject: String
        public let branch: String?
        public let track: String?
    }

    public static let legacyCategoryMap: [String: LegacyMapping] = [
        "AI": LegacyMapping(subject: "ai", branch: "basics", track: nil),
        "AI 开发": LegacyMapping(subject: "ai-dev", branch: nil, track: nil),
        "AI Agent": LegacyMapping(subject: "ai", branch: "agents", track: nil),
        "中级会计": LegacyMapping(subject: "accounting", branch: nil, track: "中级会计"),
        "会计": LegacyMapping(subject: "accounting", branch: nil, track: nil),
        "投资理财": LegacyMapping(subject: "finance", branch: nil, track: nil),
        "冷知识": LegacyMapping(subject: "trivia", branch: nil, track: nil),
        "英语": LegacyMapping(subject: "english", branch: nil, track: nil),
        "语言": LegacyMapping(subject: "english", branch: nil, track: nil),
        "编程": LegacyMapping(subject: "programming", branch: nil, track: nil),
        "算法": LegacyMapping(subject: "programming", branch: "algorithms", track: nil),
        "Python": LegacyMapping(subject: "programming", branch: nil, track: nil),
        "Rust": LegacyMapping(subject: "programming", branch: nil, track: nil),
    ]

    private static let bySlug: [String: SubjectSpec] = Dictionary(
        uniqueKeysWithValues: subjects.map { ($0.slug, $0) }
    )

    public static func subject(_ slug: String?) -> SubjectSpec? {
        guard let slug else { return nil }
        return bySlug[slug]
    }

    public static var allSubjectSlugs: [String] { subjects.map(\.slug) }

    public static func levelName(_ level: Int?) -> String {
        guard let level else { return "未分级" }
        guard let name = levels[level] else { return "L\(level)" }
        return "L\(level) \(name)"
    }

    /// 卡片生效的学科坐标：显式字段优先，缺失时按旧 `category` 派生。
    public static func taxonomy(of card: KnowledgeCard) -> CardTaxonomy {
        let mapping = legacyCategoryMap[card.category]
        return CardTaxonomy(
            subject: card.subject ?? mapping?.subject,
            branch: card.branch ?? mapping?.branch,
            level: card.level,
            track: card.track ?? mapping?.track,
            orderKey: card.orderKey
        )
    }

    /// 学科展示名（未知 slug 原样返回，避免界面出现空白）
    public static func displayName(subject slug: String?) -> String {
        guard let slug else { return "未分级" }
        return subject(slug)?.name ?? slug
    }

    public static func displayName(subject slug: String?, branch: String?) -> String {
        guard let spec = subject(slug) else { return slug ?? "未分级" }
        guard let branch, let branchSpec = spec.branch(branch) else { return spec.name }
        return "\(spec.name) · \(branchSpec.name)"
    }

    // MARK: - 分片（星图与学习地图共用）

    /// 学科摘要：星图/地图的分片选择器用。`slug == nil` 表示「未分级」一片。
    public struct SubjectSummary: Equatable, Sendable, Identifiable {
        public let slug: String?
        public let name: String
        public let count: Int
        public var id: String { slug ?? "__ungraded__" }
    }

    /// 卡片所属学科 slug（含 category 派生），未分级返回 nil。
    public static func shardSlug(of card: KnowledgeCard) -> String? {
        taxonomy(of: card).subject
    }

    /// 按学科取子集：`subject == nil` 时取「未分级」那一片，不做跨片混入。
    public static func cards(_ cards: [KnowledgeCard], in subject: String?) -> [KnowledgeCard] {
        cards.filter { shardSlug(of: $0) == subject }
    }

    /// 分片摘要（按卡数降序、同数按名称），未分级固定排在末尾。
    public static func subjectSummaries(_ cards: [KnowledgeCard]) -> [SubjectSummary] {
        var tally: [String?: Int] = [:]
        for card in cards { tally[shardSlug(of: card), default: 0] += 1 }
        let summaries = tally.map { key, count in
            SubjectSummary(slug: key, name: displayName(subject: key), count: count)
        }
        return summaries.sorted {
            if ($0.slug == nil) != ($1.slug == nil) { return $0.slug != nil }
            if $0.count != $1.count { return $0.count > $1.count }
            return $0.name < $1.name
        }
    }

    /// 导入管道与内容编辑的校验口径（与 Python 侧保持一致）
    public static func validationIssues(for card: KnowledgeCard) -> [String] {
        var issues: [String] = []
        let taxonomy = Self.taxonomy(of: card)
        if let subject = taxonomy.subject, self.subject(subject) == nil {
            issues.append("未知学科 slug：\(subject)")
        }
        if let branch = taxonomy.branch, self.subject(taxonomy.subject)?.branch(branch) == nil {
            issues.append("分支 \(branch) 不属于学科 \(taxonomy.subject ?? "—")")
        }
        if let level = card.level, !(1...5).contains(level) {
            issues.append("难度必须落在 1...5，当前 \(level)")
        }
        if let track = card.track, let spec = self.subject(taxonomy.subject), !spec.tracks.isEmpty,
           !spec.tracks.contains(track) {
            issues.append("标尺 \(track) 不在学科 \(spec.slug) 的候选里")
        }
        return issues
    }
}
