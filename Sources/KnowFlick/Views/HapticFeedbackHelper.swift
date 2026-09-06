import AppKit

/// macOS 触控板触觉反馈辅助类
public final class HapticFeedbackHelper {
    public static let shared = HapticFeedbackHelper()
    private init() {}

    private var hasCrossedThreshold = false

    /// 当卡片拖拽位移达到判定线时触发单次轻微震动
    public func cardThresholdReached() {
        guard !hasCrossedThreshold else { return }
        hasCrossedThreshold = true
        NSHapticFeedbackManager.defaultPerformer.perform(.generic, performanceTime: .default)
    }

    /// 手势回到中线或判定区以内时复位防抖状态
    public func resetThreshold() {
        hasCrossedThreshold = false
    }

    /// 松手未能划走、磁吸回弹时触发微弱对齐反馈
    public func cardSnapBack() {
        NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .default)
        hasCrossedThreshold = false
    }

    /// 成功划走卡片时的确认反馈
    public func cardSwiped() {
        NSHapticFeedbackManager.defaultPerformer.perform(.levelChange, performanceTime: .default)
        hasCrossedThreshold = false
    }
}
