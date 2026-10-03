import Foundation
import Testing
@testable import KnowFlickCore

/// 局域网同步协议 v2 标准夹具（docs/SYNC_PROTOCOL.md §7）。
///
/// 跨端对照约定：测试名必须含 F1/F2/F3/F4，Android 端逐条对齐。
/// 夹具的信封外壳（protocolVersion/cards/tombstones 三个键）与墓碑编码与规格**逐字节一致**；
/// 卡片对象按「单卡编码以两端既有 KnowledgeCard 线格式为准」的约定（§7 括注）使用 mac 线格式：
/// id 为 UUID 字符串、日期为 ISO8601 字符串（规格示例里的 `"f1"`/epoch 毫秒是示意字段子集，
/// mac 的既有卡片 Codable 无法直接解码，以两端各自测试套件为权威）。
enum SyncProtocolFixtures {
    /// F1 v2 信封（墓碑 id "dead" 非 UUID，按协议原样保留、可再广播）
    static let f1EnvelopeJSON = #"{"protocolVersion":2,"cards":[{"id":"F1A73039-3A26-4C67-9E5D-52D5F3B35E1F","headline":"测试卡","summary":"摘要","details":"正文","category":"冷知识","source":"seed","links":[],"createdAt":"2024-10-02T17:33:20Z","seenAt":null,"swiped":null,"isFavorite":false}],"tombstones":[{"id":"dead","deletedAt":1727900001000}]}"#

    /// F2 v1 裸列表（与 F1 的单卡对象逐字节一致）
    static let f2BareListJSON = #"[{"id":"F1A73039-3A26-4C67-9E5D-52D5F3B35E1F","headline":"测试卡","summary":"摘要","details":"正文","category":"冷知识","source":"seed","links":[],"createdAt":"2024-10-02T17:33:20Z","seenAt":null,"swiped":null,"isFavorite":false}]"#
}

/// 协议 v2 §7 标准夹具解析断言（F1-F4，跨端对照锚点）
struct SyncProtocolFixtureTests {

    /// F1：v2 信封解析——卡片、墓碑、版本三要素齐全。
    @Test("F1 v2 信封解析：cards + tombstones + protocolVersion")
    func f1EnvelopePayloadParses() throws {
        let payload = try CardImportEngine.parseJSON(data: Data(SyncProtocolFixtures.f1EnvelopeJSON.utf8))

        #expect(payload.protocolVersion == 2)
        #expect(payload.cards.count == 1)
        #expect(payload.cards[0].headline == "测试卡")
        #expect(payload.cards[0].category == "冷知识")
        #expect(payload.cards[0].source == .seed)
        #expect(payload.tombstones == [SyncTombstone(id: "dead", deletedAt: 1_727_900_001_000)])
    }

    /// F2：v1 裸列表解析——墓碑为空、版本 nil（旧端）。
    @Test("F2 v1 裸列表解析：墓碑为空、协议版本 nil")
    func f2BareListParsesAsLegacyPayload() throws {
        let payload = try CardImportEngine.parseJSON(data: Data(SyncProtocolFixtures.f2BareListJSON.utf8))

        #expect(payload.protocolVersion == nil)
        #expect(payload.tombstones.isEmpty)
        #expect(payload.cards.count == 1)
        #expect(payload.cards[0].headline == "测试卡")
    }

    /// 非法输入（既非数组、也非带 cards 的对象）必须抛错——同步服务端据此回 400（协议 §1/§3）。
    @Test("非法载荷抛错（服务端回 400 的依据）")
    func malformedPayloadThrows() {
        #expect(throws: AIError.self) {
            try CardImportEngine.parseJSON(data: Data(#"{"garbage": true}"#.utf8))
        }
        #expect(throws: AIError.self) {
            try CardImportEngine.parseJSON(data: Data("not json at all".utf8))
        }
    }

    /// 信封缺 tombstones 键 → 空墓碑表；tombstones 存在但格式非法 → 抛错（绝不静默丢删除信息）。
    @Test("信封 tombstones 缺省为空、格式非法抛错")
    func envelopeTombstoneFieldHandling() throws {
        let withoutTombstones = #"{"protocolVersion":2,"cards":[],"tombstonesX":[]}"#
        let payload = try CardImportEngine.parseJSON(data: Data(withoutTombstones.utf8))
        #expect(payload.cards.isEmpty)
        #expect(payload.tombstones.isEmpty)
        #expect(payload.protocolVersion == 2)

        let malformed = #"{"protocolVersion":2,"cards":[],"tombstones":[{"id":42,"deletedAt":1}]}"#
        #expect(throws: AIError.self) {
            try CardImportEngine.parseJSON(data: Data(malformed.utf8))
        }
    }

    /// 信封导出 → 解析 roundtrip：卡片、墓碑、版本逐字段还原。
    @Test("v2 信封导出/解析 roundtrip")
    func envelopeExportParseRoundTrip() throws {
        var card = KnowledgeCard(
            id: UUID(uuidString: "F1A73039-3A26-4C67-9E5D-52D5F3B35E1F")!,
            category: "冷知识",
            headline: "回环卡",
            summary: "摘要",
            details: "正文",
            source: .seed,
            createdAt: Date(timeIntervalSince1970: 1_727_900_000)
        )
        card.isFavorite = true
        let tombstones = [SyncTombstone(id: card.id.uuidString, deletedAt: 1_727_900_001_000)]

        let json = try CardExportEngine.exportToJSON(cards: [card], tombstones: tombstones)
        let payload = try CardImportEngine.parseJSON(data: Data(json.utf8))

        #expect(payload.protocolVersion == SyncProtocol.currentVersion)
        #expect(payload.cards == [card])
        #expect(payload.tombstones == tombstones)

        // 顶层是对象且有 cards 键（协议 §3 的信封判定依据）
        let object = try #require(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
        #expect(object["cards"] != nil)
        #expect(object["protocolVersion"] as? Int == 2)
    }

    /// F4：details 冲突合并口径（协议 §5）。
    /// A{details:"短",editedAt:2000} × B{details:"更长的正文内容",editedAt:1000} → 取 A（新者赢）；
    /// B 无 editedAt → 取 B（沿用 v1「较长者」旧规则，兼容历史数据）。
    /// 双向合并必须对称（mergeCard(a,b) == mergeCard(b,a)）。
    @Test("F4 details 冲突：双方有 editedAt 取新者，任一缺失沿用较长者旧规则")
    func f4DetailsConflictPrefersNewerEditedAt() {
        let base = KnowledgeCard(
            id: UUID(uuidString: "F1A73039-3A26-4C67-9E5D-52D5F3B35E1F")!,
            category: "冷知识",
            headline: "测试卡",
            summary: "摘要",
            details: "占位",
            source: .seed,
            createdAt: Date(timeIntervalSince1970: 1)
        )

        func with(details: String, editedAt: Date?) -> KnowledgeCard {
            var card = base
            card.details = details
            card.editedAt = editedAt
            return card
        }

        // 场景一：双方均有 editedAt → 新者赢（用户缩短后不再被旧长文覆盖）
        let newerShort = with(details: "短", editedAt: Date(timeIntervalSince1970: 2_000))
        let olderLong = with(details: "更长的正文内容", editedAt: Date(timeIntervalSince1970: 1_000))
        #expect(CardImportEngine.mergeCard(newerShort, olderLong).details == "短")
        #expect(CardImportEngine.mergeCard(olderLong, newerShort).details == "短")
        #expect(CardImportEngine.mergeCard(newerShort, olderLong) == CardImportEngine.mergeCard(olderLong, newerShort))

        // 场景二：任一方缺失 editedAt → 沿用 v1「较长者」规则
        let legacyLong = with(details: "更长的正文内容", editedAt: nil)
        #expect(CardImportEngine.mergeCard(newerShort, legacyLong).details == "更长的正文内容")
        #expect(CardImportEngine.mergeCard(legacyLong, newerShort).details == "更长的正文内容")

        // 场景三：空正文让位非空（字段合并的外层守卫不变）
        let editedEmpty = with(details: "", editedAt: Date(timeIntervalSince1970: 3_000))
        #expect(CardImportEngine.mergeCard(editedEmpty, olderLong).details == "更长的正文内容")
    }

    /// editedAt 的线格式契约（协议 §5/§9）：可选字段缺省不落键；旧数据缺键解码为 nil。
    @Test("editedAt 编码缺省不落键、旧数据缺键解码为 nil")
    func editedAtWireFormatIsOptionalAndBackwardCompatible() throws {
        let base = KnowledgeCard(
            category: "冷知识", headline: "历史卡", summary: "摘要", details: "正文", source: .seed,
            createdAt: Date(timeIntervalSince1970: 1_727_900_000)
        )

        // 历史卡不写 editedAt 键（本地 cards.json 格式不变）
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let legacyObject = try #require(JSONSerialization.jsonObject(with: encoder.encode(base)) as? [String: Any])
        #expect(legacyObject["editedAt"] == nil)

        // 旧 cards.json / 旧同步包缺键 → nil
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        #expect(try decoder.decode(KnowledgeCard.self, from: encoder.encode(base)).editedAt == nil)

        // 带 editedAt 的卡 roundtrip 还原
        var edited = base
        edited.editedAt = Date(timeIntervalSince1970: 1_727_900_100)
        let decoded = try decoder.decode(KnowledgeCard.self, from: encoder.encode(edited))
        #expect(decoded.editedAt == edited.editedAt)

        // 合并：单方有 editedAt 的历史卡合并，合并结果带较新编辑时间
        let merged = CardImportEngine.mergeCard(edited, base)
        #expect(merged.editedAt == edited.editedAt)
        #expect(merged == CardImportEngine.mergeCard(base, edited))
    }

    /// 旧版本 KnowFlick 导出的裸数组文件导入仍然可用（文件导入路径的兼容验证）。
    @Test("文件导入路径兼容 v1 裸数组与 v2 信封两种备份")
    func fileImportPathAcceptsLegacyBareListAndEnvelope() throws {
        // v1 裸数组（旧版导出就是裸的 [KnowledgeCard]）
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let legacyBare = try encoder.encode([KnowledgeCard(
            category: "物理", headline: "旧版备份卡", summary: "摘要", details: "正文", source: .seed
        )])
        let legacyPayload = try CardImportEngine.parseJSON(data: legacyBare)
        #expect(legacyPayload.cards.count == 1)
        #expect(legacyPayload.cards[0].headline == "旧版备份卡")
        #expect(legacyPayload.protocolVersion == nil)

        // v2 信封（新版导出）
        let modern = try CardExportEngine.exportToJSON(cards: [KnowledgeCard(
            category: "物理", headline: "新版备份卡", summary: "摘要", details: "正文", source: .seed
        )])
        #expect(try CardImportEngine.parseJSON(data: Data(modern.utf8)).cards.count == 1)
    }

    /// 编辑器保存漏斗（CardEditorView → updateCardContent）：任一字段变更即写 editedAt，
    /// 内容未变不刷新时间戳（协议 §5）。
    @Test("编辑器保存任一字段变更即写 editedAt=now，内容未变不刷新")
    @MainActor
    func editingContentStampsEditedAtOnlyWhenChanged() {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = AppStore(storage: Storage(baseDir: directory))
        defer { try? FileManager.default.removeItem(at: directory) }
        store.isLoadingSeed = false

        var subject = KnowledgeCard(
            category: "冷知识", headline: "原标题", summary: "原摘要", details: "原正文",
            source: .imported, createdAt: Date(timeIntervalSince1970: 1_727_900_000)
        )
        subject.seenAt = Date(timeIntervalSince1970: 1_727_900_100)
        store.cards = [subject]
        #expect(subject.editedAt == nil)

        // 任一字段变更 → 打编辑时间戳，学习状态不被触碰
        #expect(store.updateCardContent(id: subject.id, headline: "新标题", category: "冷知识", summary: "原摘要", details: "原正文"))
        let edited = try! #require(store.cards.first)
        #expect(edited.editedAt != nil)
        #expect(edited.seenAt == subject.seenAt)

        // 相同内容再保存 → 时间戳不刷新
        let stamp = edited.editedAt
        #expect(store.updateCardContent(id: subject.id, headline: "新标题", category: "冷知识", summary: "原摘要", details: "原正文"))
        #expect(store.cards.first?.editedAt == stamp)
    }
}
