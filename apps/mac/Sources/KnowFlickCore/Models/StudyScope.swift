import Foundation

/// 学习范围：「专学一条支线，一点点看」或「多选混合」。
///
/// 三个维度都是**空集 = 不限**；`branches` 用 `subject/branch` 复合键，避免不同学科下的同名分支互相串。
/// 范围生效时它接管分类维度（`preferredCategories` 让位），因为学习地图本身就是更结构化的分类选择器。
/// 与 Android 侧 `domain/StudyScope.kt` 逐条对齐，任何一侧改动都要同步另一侧。
public struct StudyScope: Equatable, Sendable {
    public var subjects: Set<String>
    public var branches: Set<String>
    public var levels: Set<Int>
    /// true = 按 orderKey 顺序推进（不再随机打散），false = 混着刷
    public var sequential: Bool

    public init(
        subjects: Set<String> = [],
        branches: Set<String> = [],
        levels: Set<Int> = [],
        sequential: Bool = false
    ) {
        self.subjects = subjects
        self.branches = branches
        self.levels = levels
        self.sequential = sequential
    }

    public var isActive: Bool {
        !subjects.isEmpty || !branches.isEmpty || !levels.isEmpty
    }

    public func matches(_ card: KnowledgeCard) -> Bool {
        let taxonomy = SubjectRegistry.taxonomy(of: card)
        if !subjects.isEmpty && taxonomy.subject.map({ !subjects.contains($0) }) ?? true { return false }
        if !branches.isEmpty && !branches.contains(Self.branchKey(taxonomy.subject, taxonomy.branch)) { return false }
        if !levels.isEmpty && taxonomy.level.map({ !levels.contains($0) }) ?? true { return false }
        return true
    }

    public func filter(_ cards: [KnowledgeCard]) -> [KnowledgeCard] {
        cards.filter { matches($0) }
    }

    /// 顺序推进时按 orderKey 排；缺 orderKey 的落到最后并按标题稳定排序，保证两次结果一致
    public func orderForDeck(_ cards: [KnowledgeCard]) -> [KnowledgeCard] {
        guard sequential else { return cards }
        return cards.sorted { lhs, rhs in
            let lhsKey = lhs.orderKey ?? Self.noOrderKey
            let rhsKey = rhs.orderKey ?? Self.noOrderKey
            if lhsKey != rhsKey { return lhsKey < rhsKey }
            let lhsSubject = lhs.subject ?? ""
            let rhsSubject = rhs.subject ?? ""
            if lhsSubject != rhsSubject { return lhsSubject < rhsSubject }
            return lhs.headline < rhs.headline
        }
    }

    /// 顶栏徽标文案，如「英语 · 语法、L2 基础」
    public func describe() -> String {
        guard isActive else { return "" }
        var parts: [String] = []
        // 分支标签自带学科前缀（「会计 · 资产」），此时再列学科名就是重复；
        // 只列分支还带来另一个好处：徽标读起来就是「我在学什么」。
        if !branches.isEmpty {
            for key in branches.sorted() {
                let subject = String(key.prefix(while: { $0 != "/" }))
                let branch = key.contains("/") ? String(key.dropFirst(subject.count + 1)) : ""
                // branchKey 把 nil 学科编码成字面 "nil"（复合键必须是字符串）；describe 还原回未分级
                let subjectSlug = subject == "nil" ? nil : subject
                if branch.isEmpty || branch == Self.unbranched {
                    parts.append(SubjectRegistry.displayName(subject: subjectSlug))
                } else {
                    parts.append(SubjectRegistry.displayName(subject: subjectSlug, branch: branch))
                }
            }
        } else {
            parts.append(contentsOf: subjects.sorted().map { SubjectRegistry.displayName(subject: $0) })
        }
        parts.append(contentsOf: levels.sorted().map { SubjectRegistry.levelName($0) })
        return Array(parts.deduplicated()).joined(separator: "、")
    }

    // MARK: - 复合键

    /// 分支复合键；未分分支用 `—` 占位，保证能与「不限分支」区分开
    public static func branchKey(_ subject: String?, _ branch: String?) -> String {
        "\(subject ?? "nil")/\(branch ?? unbranched)"
    }

    public static let unbranched = "—"
    public static let none = StudyScope()

    /// 没标 orderKey 的卡排在最后（历史卡普遍没有顺序），用 BMP 末位字符当哨兵
    private static let noOrderKey = "\u{FFFF}"
}

private extension Array where Element == String {
    /// 保持首次出现顺序的去重（describe 里分支标签与学科名可能撞车）
    func deduplicated() -> [String] {
        var seen = Set<String>()
        return filter { seen.insert($0).inserted }
    }
}

/// 学科进度（学习地图第一层）
public struct SubjectProgress: Equatable, Sendable, Identifiable {
    public let slug: String?
    public let name: String
    public let total: Int
    public let seen: Int
    public let mastered: Int
    public let branchCount: Int
    public var id: String { slug ?? "__ungraded__" }
}

/// 分支进度（学习地图第二层）
public struct BranchProgress: Equatable, Sendable, Identifiable {
    public let key: String
    public let slug: String?
    public let name: String
    public let total: Int
    public let seen: Int
    public let mastered: Int
    public let levels: [LevelProgress]
    public var id: String { key }

    /// 该分支里最小的还没学完的难度档，用来显示「下一步：L2 基础」
    public var nextLevel: Int? {
        levels
            .sorted { ($0.level ?? Int.max) < ($1.level ?? Int.max) }
            .first { $0.total > $0.seen }?
            .level
    }
}

public struct LevelProgress: Equatable, Sendable {
    public let level: Int?
    public let name: String
    public let total: Int
    public let seen: Int
}

/// 学习地图的派生视图：全部是纯函数，可测。
/// 卡片量级在几千张以内，每次进页面重算即可，不做缓存（缓存失效的复杂度不值当）。
public enum StudyMap {

    public static func subjectProgress(_ cards: [KnowledgeCard]) -> [SubjectProgress] {
        struct Bucket {
            var total = 0
            var seen = 0
            var mastered = 0
            var branches = Set<String>()
        }
        var buckets: [String?: Bucket] = [:]
        var order: [String?] = []
        for card in cards {
            let taxonomy = SubjectRegistry.taxonomy(of: card)
            if buckets[taxonomy.subject] == nil {
                buckets[taxonomy.subject] = Bucket()
                order.append(taxonomy.subject)
            }
            var bucket = buckets[taxonomy.subject]!
            bucket.total += 1
            if card.seenAt != nil { bucket.seen += 1 }
            if card.masteryLevel >= 2 { bucket.mastered += 1 }
            bucket.branches.insert(StudyScope.branchKey(taxonomy.subject, taxonomy.branch))
            buckets[taxonomy.subject] = bucket
        }
        return order.map { slug in
            let bucket = buckets[slug]!
            return SubjectProgress(
                slug: slug,
                name: SubjectRegistry.displayName(subject: slug),
                total: bucket.total,
                seen: bucket.seen,
                mastered: bucket.mastered,
                branchCount: bucket.branches.count
            )
        }
        .sorted {
            if ($0.slug == nil) != ($1.slug == nil) { return $0.slug != nil }
            if $0.total != $1.total { return $0.total > $1.total }
            return $0.name < $1.name
        }
    }

    public static func branchProgress(_ cards: [KnowledgeCard], subject: String?) -> [BranchProgress] {
        let inSubject = cards.filter { SubjectRegistry.shardSlug(of: $0) == subject }
        struct Bucket {
            var total = 0
            var seen = 0
            var mastered = 0
            var levels: [Int?: (total: Int, seen: Int)] = [:]
            var levelOrder: [Int?] = []
        }
        var buckets: [String: Bucket] = [:]
        var order: [String] = []
        for card in inSubject {
            let taxonomy = SubjectRegistry.taxonomy(of: card)
            let key = StudyScope.branchKey(subject, taxonomy.branch)
            if buckets[key] == nil {
                buckets[key] = Bucket()
                order.append(key)
            }
            var bucket = buckets[key]!
            bucket.total += 1
            if card.seenAt != nil { bucket.seen += 1 }
            if card.masteryLevel >= 2 { bucket.mastered += 1 }
            if bucket.levels[taxonomy.level] == nil {
                bucket.levels[taxonomy.level] = (0, 0)
                bucket.levelOrder.append(taxonomy.level)
            }
            var cell = bucket.levels[taxonomy.level]!
            cell.total += 1
            if card.seenAt != nil { cell.seen += 1 }
            bucket.levels[taxonomy.level] = cell
            buckets[key] = bucket
        }
        let spec = SubjectRegistry.subject(subject)
        return order.map { key in
            let bucket = buckets[key]!
            let slug = String(key.dropFirst((subject ?? "nil").count + 1))
            let branchSlug = (slug == StudyScope.unbranched || slug.isEmpty) ? nil : slug
            let name = branchSlug.map { spec?.branch($0)?.name ?? $0 } ?? "未分分支"
            return BranchProgress(
                key: key,
                slug: branchSlug,
                name: name,
                total: bucket.total,
                seen: bucket.seen,
                mastered: bucket.mastered,
                levels: bucket.levelOrder
                    .map { level in
                        let cell = bucket.levels[level]!
                        return LevelProgress(level: level, name: SubjectRegistry.levelName(level), total: cell.total, seen: cell.seen)
                    }
                    .sorted { ($0.level ?? Int.max) < ($1.level ?? Int.max) }
            )
        }
        .sorted {
            if ($0.slug == nil) != ($1.slug == nil) { return $0.slug != nil }
            if $0.total != $1.total { return $0.total > $1.total }
            return $0.name < $1.name
        }
    }

    /// 该范围下还剩多少没学（地图与顶栏徽标共用）
    public static func remaining(_ cards: [KnowledgeCard], scope: StudyScope) -> Int {
        scope.filter(cards).count { $0.seenAt == nil }
    }
}
