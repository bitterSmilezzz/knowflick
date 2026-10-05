import Foundation

/// 本地诊断日志仓（MetricKit 观测的存储端，Wave D1）。
///
/// 职责单一：把上层（`DiagnosticsObserver`）编码好的 payload JSON 按「类型 + 月份」
/// 追加成 JSONL 文件，并提供清点 / 清空 / 超期清理。**只落本地，无任何网络出口**——
/// 导出由用户在设置页手动触发（在访达中显示后自行附带）。
///
/// MetricKit 的 payload 类型本身 Codable，但测试环境无法构造真实 payload，
/// 因此本类型只接收已编码的 JSON Data，与 MetricKit 解耦后纯逻辑可测。
public struct DiagnosticsStore {
    /// 保留天数：诊断的价值随时间快速衰减，90 天前的文件直接清理
    public static let retentionDays: Int = 90

    public let directory: URL
    private let fileManager: FileManager

    /// - Parameter directory: 诊断目录；默认与卡片库同区
    ///   （`~/Library/Application Support/KnowFlick/diagnostics/`）
    public init(directory: URL? = nil, fileManager: FileManager = .default) {
        if let directory {
            self.directory = directory
        } else {
            let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            self.directory = base
                .appendingPathComponent("KnowFlick", isDirectory: true)
                .appendingPathComponent("diagnostics", isDirectory: true)
        }
        self.fileManager = fileManager
    }

    // MARK: - 文件命名

    /// 按月分文件：`metrics-2026-10.jsonl` / `diagnostics-2026-10.jsonl`。
    /// 月粒度在「文件数够少可清点」与「单文件不至于无限膨胀」之间取平衡；
    /// 固定 POSIX locale，避免用户日历设置影响文件名。
    public static func fileName(kind: String, for date: Date, calendar: Calendar = .current) -> String {
        let comps = calendar.dateComponents([.year, .month], from: date)
        let month = String(format: "%04d-%02d", comps.year ?? 0, comps.month ?? 0)
        return "\(kind)-\(month).jsonl"
    }

    // MARK: - 写入

    /// 追加一条 payload（`payloadJSON` 为上层已编码的 JSON 对象数据）。
    /// 首写原子建文件，其后 seekToEnd 追加；超期清理顺手在同一目录清单上完成。
    public func append(payloadJSON: Data, kind: String, receivedAt: Date = Date()) throws {
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        pruneStaleFiles(now: receivedAt)
        let url = directory.appendingPathComponent(Self.fileName(kind: kind, for: receivedAt))
        let line = try Self.jsonLine(kind: kind, receivedAt: receivedAt, payload: payloadJSON)
        guard !fileManager.fileExists(atPath: url.path) else {
            let handle = try FileHandle(forWritingTo: url)
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: line)
            return
        }
        try line.write(to: url, options: .atomic)
    }

    /// 一行 JSONL：`{"kind":…,"receivedAt":…,…payload字段}`。
    /// payload 为对象时字段平铺到顶层，便于 jq/grep 直接查；非对象时整体挂到 `payload` 键。
    static func jsonLine(kind: String, receivedAt: Date, payload: Data) throws -> Data {
        let formatter = ISO8601DateFormatter()
        var envelope: [String: Any] = [
            "kind": kind,
            "receivedAt": formatter.string(from: receivedAt)
        ]
        if var object = try JSONSerialization.jsonObject(with: payload, options: [.fragmentsAllowed]) as? [String: Any] {
            object.merge(envelope) { current, _ in current }
            envelope = object
        } else {
            envelope["payload"] = try JSONSerialization.jsonObject(with: payload, options: [.fragmentsAllowed])
        }
        var data = try JSONSerialization.data(withJSONObject: envelope)
        data.append(0x0A)   // "\n"
        return data
    }

    // MARK: - 清点 / 清理

    public struct Summary: Equatable, Sendable {
        public var fileCount: Int
        public var totalBytes: Int64
        public var lastModified: Date?
    }

    /// 当前诊断目录的清点（设置页展示用）
    public func summary(now: Date = Date()) -> Summary {
        let files = jsonlFiles()
        let bytes = files.reduce(Int64(0)) { $0 + (fileSize($1) ?? 0) }
        let last = files.compactMap(modificationDate).max()
        pruneStaleFiles(now: now)
        return Summary(fileCount: files.count, totalBytes: bytes, lastModified: last)
    }

    /// 清空全部诊断文件（设置页「清空」按钮）
    public func clear() throws {
        for url in jsonlFiles() {
            try? fileManager.removeItem(at: url)
        }
    }

    /// 删除超期（>retentionDays）的 JSONL 文件
    public func pruneStaleFiles(now: Date) {
        let cutoff = now.addingTimeInterval(-Double(Self.retentionDays) * 24 * 3600)
        for url in jsonlFiles() {
            if let modified = modificationDate(url), modified < cutoff {
                try? fileManager.removeItem(at: url)
            }
        }
    }

    // MARK: - 目录助手

    private func jsonlFiles() -> [URL] {
        let contents = (try? fileManager.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey, .isRegularFileKey]
        )) ?? []
        return contents.filter { $0.pathExtension == "jsonl" }
    }

    private func fileSize(_ url: URL) -> Int64? {
        let values = try? url.resourceValues(forKeys: [.fileSizeKey])
        return values.map { Int64($0.fileSize ?? 0) }
    }

    private func modificationDate(_ url: URL) -> Date? {
        (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
    }
}
