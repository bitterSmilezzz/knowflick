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
}
