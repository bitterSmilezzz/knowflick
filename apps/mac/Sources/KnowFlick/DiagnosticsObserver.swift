import Foundation
import MetricKit
import KnowFlickCore

/// MetricKit 订阅者（Wave D1）：把系统下发的崩溃/挂起/性能诊断落本地。
///
/// 隐私口径：数据**只进本地诊断目录**（`~/Library/Application Support/KnowFlick/diagnostics/`），
/// 无任何网络上传；出口只有设置页的「在访达中显示」，由用户决定是否随反馈提供。
/// MXMetric/MXDiagnostic payload 不备 Codable，按官方口径用 `jsonRepresentation()`
/// 取 JSON 数据交 `DiagnosticsStore` 追加；落盘失败仅 NSLog，不影响应用运行
/// （观测是旁路，不引入新的故障面）。
final class DiagnosticsObserver: NSObject, MXMetricManagerSubscriber, @unchecked Sendable {
    static let shared = DiagnosticsObserver()

    private let store = DiagnosticsStore()

    private override init() {
        super.init()
    }

    /// 应用启动时注册一次（重复 add 同一订阅者无副作用，但仍以幂等语义调用）
    func start() {
        MXMetricManager.shared.add(self)
    }

    /// 每日/每周系统性能汇总（启动耗时、磁盘写入、内存等）
    func didReceive(_ payloads: [MXMetricPayload]) {
        for payload in payloads {
            appendToStore(payloadJSON: payload.jsonRepresentation(), kind: "metrics")
        }
    }

    /// 崩溃 / 挂起 / 卡顿 / 磁盘写入超额等诊断（macOS 12+）
    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        for payload in payloads {
            appendToStore(payloadJSON: payload.jsonRepresentation(), kind: "diagnostics")
        }
    }

    private func appendToStore(payloadJSON: Data, kind: String) {
        do {
            try store.append(payloadJSON: payloadJSON, kind: kind)
        } catch {
            NSLog("KnowFlick: 诊断日志落盘失败: %@", error.localizedDescription)
        }
    }
}
