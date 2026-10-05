import AppKit

/// macOS 触控板多阶精密触觉反馈辅助类。
/// 状态仅在手势回调（主线程）读写，整体 @MainActor 隔离。
@MainActor
public final class HapticFeedbackHelper {
    public static let shared = HapticFeedbackHelper()
    private init() {}

    private var hasInitiatedDrag = false
    public private(set) var hasCrossedThreshold = false
    private var lastTensionStep = 0

    /// 第一阶段：卡片起步拖拽阻尼反馈（位移达 18pt 时触发）
    public func dragInitiated() {
        guard !hasInitiatedDrag else { return }
        hasInitiatedDrag = true
        NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .default)
    }

    /// 物理张力中间刻度齿（每跨过一个阻尼张力区间触发微触觉）
    public func tensionNotch(step: Int) {
        guard step != lastTensionStep else { return }
        lastTensionStep = step
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
        lastTensionStep = 0
    }

    /// 手势完全释放或回位时重置所有触觉阶段
    public func resetAll() {
        hasInitiatedDrag = false
        hasCrossedThreshold = false
        lastTensionStep = 0
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

    /// 收藏触发的特制双阶心跳触觉
    public func favoriteHeartbeat() {
        NSHapticFeedbackManager.defaultPerformer.perform(.levelChange, performanceTime: .default)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
            NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .default)
        }
    }

    /// 机械微动开关按压触觉
    public func buttonClick() {
        NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .default)
    }
}
