import Foundation

/// 局域网同步协议（docs/SYNC_PROTOCOL.md）的共享常量与线格式类型。
///
/// macOS（本模块）与 Android（Kotlin CardJson/SyncServer/SyncClient）逐字段对齐实现；
/// 未来 Windows 端以协议文档 + 两端测试夹具为验收标准。
/// 任何语义调整必须先修订协议文档并双端同轮升级——**禁止单端私改语义**。
public enum SyncProtocol {
    /// 本端支持的最高协议版本。
    /// v2（2026-10 定版）：/api/info 版本握手 + 载荷信封 + 墓碑预留 + editedAt。
    public static let currentVersion = 2

    /// 本地墓碑表容量上限（协议 §4）：超出裁最老（deletedAt 最小）。
    public static let maxTombstoneCount = 1_000
}

/// 同步墓碑（协议 §3/§4）：「某卡片已在对端被删除」的记录。
///
/// - `id` 用字符串承载对端卡片 id：mac 卡为 UUID 字符串（匹配本地卡片时按 UUID 解析、
///   忽略大小写）；规格夹具等非 UUID id 原样保留、可再广播，不阻断解析。
/// - `deletedAt` 为 epoch 毫秒。
public struct SyncTombstone: Codable, Sendable, Equatable, Hashable {
    public let id: String
    public let deletedAt: Int64

    public init(id: String, deletedAt: Int64) {
        self.id = id
        self.deletedAt = deletedAt
    }
}

/// /api/cards GET 响应与 POST 请求体的 v2 信封（协议 §3）。
///
/// `cards` 的单卡线格式与 v1 裸列表完全一致（既有 Codable 不变）；
/// `tombstones` 本轮两端均无删除 UI、恒为空数组——纯协议预留。
public struct CardSyncEnvelope: Codable, Sendable, Equatable {
    public let protocolVersion: Int
    public let cards: [KnowledgeCard]
    public let tombstones: [SyncTombstone]

    public init(cards: [KnowledgeCard], tombstones: [SyncTombstone] = []) {
        self.protocolVersion = SyncProtocol.currentVersion
        self.cards = cards
        self.tombstones = tombstones
    }
}
