import Foundation
import Testing
@testable import KnowFlickCore

/// 学科注册表的契约测试：把 mac 内嵌表钉在 `shared/assets/taxonomy_map.json` 上
/// （Android 端有同一份契约的等价测试），并覆盖派生、线格式兼容与合并语义。
@MainActor
struct SubjectRegistryTests {

    // MARK: - 夹具定位

    /// 从测试源文件位置向上找仓库根，避免依赖 SwiftPM 资源 bundle（历史上它在两种工具链下表现不一致）
    private func fixtureJSON() throws -> Data {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<8 {
            url = url.deletingLastPathComponent()
            let candidate = url.appendingPathComponent("shared/assets/taxonomy_map.json")
            if FileManager.default.fileExists(atPath: candidate.path) {
                return try Data(contentsOf: candidate)
            }
        }
        throw CocoaError(.fileNoSuchFile)
    }

    private struct Fixture: Decodable {
        struct Levels: Decodable { var map: [Int: String]
            init(from decoder: Decoder) throws {
                let container = try decoder.singleValueContainer()
                let raw = try container.decode([String: String].self)
                map = Dictionary(uniqueKeysWithValues: raw.map { (Int($0.key) ?? 0, $0.value) })
            }
        }
        struct Branch: Decodable, Equatable { let slug: String; let name: String }
        struct Subject: Decodable, Equatable {
            let slug: String
            let name: String
            var tracks: [String]?
            var branches: [Branch]?
        }
        struct Legacy: Decodable, Equatable { let subject: String; var branch: String?; var track: String? }
        let levels: Levels
        let subjects: [Subject]
        let legacyCategoryMap: [String: Legacy]
    }

    // MARK: - 双端契约

    @Test func embeddedLevelsMatchSharedFixture() throws {
        let fixture = try JSONDecoder().decode(Fixture.self, from: fixtureJSON())
        #expect(fixture.levels.map == SubjectRegistry.levels)
    }

    @Test func embeddedSubjectsMatchSharedFixture() throws {
        let fixture = try JSONDecoder().decode(Fixture.self, from: fixtureJSON())
        let expected = fixture.subjects.map {
            SubjectSpec(
                slug: $0.slug,
                name: $0.name,
                tracks: $0.tracks ?? [],
                branches: ($0.branches ?? []).map { BranchSpec(slug: $0.slug, name: $0.name) }
            )
        }
        #expect(expected == SubjectRegistry.subjects, "学科与分支必须与共享契约夹具逐条一致")
    }

    @Test func embeddedLegacyCategoryMapMatchesSharedFixture() throws {
        let fixture = try JSONDecoder().decode(Fixture.self, from: fixtureJSON())
        let expected = fixture.legacyCategoryMap.mapValues {
            SubjectRegistry.LegacyMapping(subject: $0.subject, branch: $0.branch, track: $0.track)
        }
        #expect(expected == SubjectRegistry.legacyCategoryMap)
    }

    @Test func everyFixtureSlugResolvesToARealSubjectAndBranch() {
        for spec in SubjectRegistry.subjects {
            #expect(SubjectRegistry.subject(spec.slug) == spec)
            for branch in spec.branches {
                #expect(spec.branch(branch.slug) == branch)
            }
        }
        for mapping in SubjectRegistry.legacyCategoryMap.values {
            let spec = SubjectRegistry.subject(mapping.subject)
            #expect(spec != nil, "未知学科 \(mapping.subject)")
            if let branch = mapping.branch {
                #expect(spec?.branch(branch) != nil, "学科 \(mapping.subject) 没有分支 \(branch)")
            }
        }
    }

    // MARK: - 派生

    private func card(
        category: String = "冷知识",
        headline: String = "标题",
        details: String = "正文"
    ) -> KnowledgeCard {
        KnowledgeCard(category: category, headline: headline, summary: "摘要", details: details, source: .seed)
    }

    @Test func explicitFieldsWinAndLegacyCategoryFillsGaps() {
        let legacy = SubjectRegistry.taxonomy(of: card(category: "中级会计"))
        #expect(legacy.subject == "accounting")
        #expect(legacy.track == "中级会计")
        #expect(legacy.level == nil, "历史卡没有内容难度，不能凭空补")

        let explicit = SubjectRegistry.taxonomy(of: card(category: "冷知识").copying(subject: "english", branch: "grammar", level: 3))
        #expect(explicit.subject == "english")
        #expect(explicit.branch == "grammar")
        #expect(explicit.level == 3)
    }

    @Test func unmappedCategoryStaysUngraded() {
        let taxonomy = SubjectRegistry.taxonomy(of: card(category: "物理"))
        #expect(taxonomy.subject == nil, "未列入映射表的学科不得被硬塞进冷知识")
        #expect(SubjectRegistry.displayName(subject: nil) == "未分级")
        #expect(SubjectRegistry.levelName(2) == "L2 基础")
        #expect(SubjectRegistry.levelName(nil) == "未分级")
        #expect(SubjectRegistry.displayName(subject: "english", branch: "grammar") == "英语 · 语法")
    }

    @Test func validationRejectsUnknownBranchAndLevelOutOfRange() {
        var bad = card()
        bad.subject = "english"
        bad.branch = "nope"
        bad.level = 9
        bad.track = "不存在的标尺"
        let issues = SubjectRegistry.validationIssues(for: bad)
        #expect(issues.contains { $0.contains("分支 nope") })
        #expect(issues.contains { $0.contains("难度") })
        #expect(issues.contains { $0.contains("标尺") })

        var good = card()
        good.subject = "english"
        good.branch = "grammar"
        good.level = 2
        #expect(SubjectRegistry.validationIssues(for: good).isEmpty)
    }

    // MARK: - 分片（星图与学习地图共用）

    @Test func shardPartitionPutsEveryCardInExactlyOneShard() {
        let cards = [
            card(category: "AI"), card(category: "AI Agent"), card(category: "投资理财"),
            card(category: "中级会计"), card(category: "物理"),
        ]
        let summaries = SubjectRegistry.subjectSummaries(cards)
        #expect(summaries.reduce(0) { $0 + $1.count } == cards.count, "分片摘要必须覆盖全部卡片")
        #expect(summaries.last?.name == "未分级", "未分级固定排在末尾")
        #expect(SubjectRegistry.shardSlug(of: cards[0]) == "ai")
        #expect(SubjectRegistry.shardSlug(of: cards[1]) == "ai")
        #expect(SubjectRegistry.shardSlug(of: cards[4]) == nil)
        #expect(SubjectRegistry.cards(cards, in: "ai").count == 2)
        #expect(SubjectRegistry.cards(cards, in: nil).count == 1)
    }

    @Test func explicitGradingWinsOverLegacyCategoryWhenSharding() {
        let englishUnderTrivia = card(category: "冷知识").copying(subject: "english", branch: "grammar", level: nil)
        #expect(SubjectRegistry.shardSlug(of: englishUnderTrivia) == "english")
        #expect(SubjectRegistry.cards([englishUnderTrivia], in: "trivia").isEmpty)
    }

    @Test func shardSummariesOrderIsStableAndDeterministic() {
        let pool = [
            card(category: "冷知识"), card(category: "冷知识"), card(category: "冷知识"),
            card(category: "AI"), card(category: "AI"),
            card(category: "物理"),
        ]
        let summaries = SubjectRegistry.subjectSummaries(pool)
        #expect(summaries.map(\.name) == ["冷知识", "AI", "未分级"], "按卡数降序，未分级殿后")
        #expect(summaries.map(\.count) == [3, 2, 1])
        #expect(summaries.map(\.id) == ["trivia", "ai", "__ungraded__"])
    }

    // MARK: - 线格式与合并

    @Test func taxonomyFieldsRoundTripThroughWireFormat() throws {
        var source = card(headline: "定语从句三步拆解")
        source.subject = "english"
        source.branch = "grammar"
        source.level = 4
        source.track = "大学英语六级"
        source.orderKey = "en/grammar/0042"
        source.prereq = ["AAA", "BBB"]

        let data = try JSONEncoder().encode([source])
        let restored = try JSONDecoder().decode([KnowledgeCard].self, from: data)
        #expect(restored == [source])
    }

    @Test func ungradedCardWritesNoNewKeysAndLegacyPayloadStillDecodes() throws {
        // id 用真实 UUID 串：mac 端解码要求合法 UUID（Android 端宽松回退随机 id），
        // 双端生成的都是大写 UUID，因此线格式始终合法
        let legacyId = "7A1B2C3D-4E5F-6A7B-8C9D-0E1F2A3B4C5D"
        let legacy = Data(#"[{"id":"\#(legacyId)","category":"冷知识","headline":"标题","summary":"摘要","details":"正文","source":"seed","createdAt":"2026-01-01T00:00:00Z"}]"#.utf8)
        // 磁盘线格式是 ISO8601（与 Storage 的编解码策略一致），测试必须用同一策略
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let cards = try decoder.decode([KnowledgeCard].self, from: legacy)
        #expect(cards.count == 1)
        #expect(cards[0].subject == nil)
        #expect(cards[0].level == nil)
        #expect(cards[0].prereq.isEmpty)

        // 未分级的卡不写新键：旧版本 App 收到同步包也不会遇到未知字段
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let encoded = String(decoding: try encoder.encode(cards), as: UTF8.self)
        #expect(!encoded.contains("\"subject\""))
        #expect(!encoded.contains("\"prereq\""))
    }

    @Test func mergeKeepsGradingFromTheEndThatHasIt() throws {
        var graded = card()
        graded.subject = "accounting"
        graded.branch = "cost"
        graded.level = 3
        graded.orderKey = "k1"
        graded.prereq = ["P1"]

        // 另一端更新（createdAt 更晚）但完全没有分级
        var ungraded = card()
        ungraded.createdAt = graded.createdAt.addingTimeInterval(10)

        let merged = CardImportEngine.mergeCard(graded, ungraded)
        #expect(merged.subject == "accounting")
        #expect(merged.branch == "cost")
        #expect(merged.level == 3)
        #expect(merged.orderKey == "k1")
        #expect(merged.prereq == ["P1"])
    }
}

private extension KnowledgeCard {
    /// 测试便捷：只改学科三字段，其余保持原值
    func copying(subject: String?, branch: String?, level: Int?) -> KnowledgeCard {
        var copy = self
        copy.subject = subject
        copy.branch = branch
        copy.level = level
        return copy
    }
}
