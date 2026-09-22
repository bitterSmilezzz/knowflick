import Foundation

/// 睡眠定时的收尾淡出：不硬切，最后一段窗口里把音量和语速一起收下来。
///
/// 与 Android `speech/SleepFade.kt` 同一套曲线（同一剩余秒数双端必须给出同样的音量与
/// 语速系数）。纯函数，定时循环只负责把结果搬到播放器上。
public enum SleepFade {
    /// 默认淡出窗口（秒）
    public static let defaultWindowSeconds = 30

    /// 淡到底时保留的音量：留一点余声，避免「突然安静」把人彻底弄醒
    public static let minVolume: Float = 0.15

    /// 淡到底时的语速系数（相对当前语速）：慢一成，更像要睡了
    public static let minSpeedScale: Float = 0.90

    public struct Plan: Equatable, Sendable {
        public let volume: Float
        public let speedScale: Float

        public init(volume: Float, speedScale: Float) {
            self.volume = volume
            self.speedScale = speedScale
        }
    }

    /// 全程满音量（窗口外或窗口长度为 0）
    public static let full = Plan(volume: 1, speedScale: 1)

    /// - Parameters:
    ///   - remainingSeconds: 距离定时结束的秒数
    ///   - windowSeconds: 淡出窗口长度；剩余秒数 ≥ 窗口时不淡出
    public static func plan(remainingSeconds: Int, windowSeconds: Int = defaultWindowSeconds) -> Plan {
        if windowSeconds <= 0 || remainingSeconds >= windowSeconds { return full }
        let progress: Float = remainingSeconds <= 0
            ? 0
            : Float(remainingSeconds) / Float(windowSeconds)
        return Plan(
            volume: minVolume + (1 - minVolume) * progress,
            speedScale: 1 - (1 - minSpeedScale) * (1 - progress)
        )
    }
}
