import AppKit

/// macOS 触控板多阶精密触觉反馈辅助类
public final class HapticFeedbackHelper {
    public static let shared = HapticFeedbackHelper()
    private init() {}

    private var hasInitiatedDrag = false
    private var hasCrossedThreshold = false

    /// 第一阶段：卡片起步拖拽阻尼反馈（位移达 24pt 时触发）
    public func dragInitiated() {
        guard !hasInitiatedDrag else { return }
        hasInitiatedDrag = true
        NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .default)
    }

    /// 第二阶段：卡片拖拽达到判决阈值线（85pt）时触发清脆确认反馈
    public func cardThresholdReached() {
        guard !hasCrossedThreshold else { return }
        hasCrossedThreshold = true
        NSHapticFeedbackManager.defaultPerformer.perform(.levelChange, performanceTime: .default)
    }

    /// 手势回退至中线或安全区时复位状态
    public func resetThreshold() {
        hasCrossedThreshold = false
    }

    /// 手势完全释放或回位时重置所有触觉阶段
    public func resetAll() {
        hasInitiatedDrag = false
        hasCrossedThreshold = false
    }

    /// 第三阶段（A）：松手未能划走、磁吸回弹时触发柔和吸附反馈
    public func cardSnapBack() {
        NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .default)
        resetAll()
    }

    /// 第三阶段（B）：成功划走卡片时的清脆确认反馈
    public func cardSwiped() {
        NSHapticFeedbackManager.defaultPerformer.perform(.generic, performanceTime: .default)
        resetAll()
    }
}
