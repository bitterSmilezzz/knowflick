import Foundation

/// 听书音色预设：把「语速 + 音调 + 切卡停顿」打包成一键可选的场景档。
///
/// 与 Android `speech/SpeechPreset.kt` 是同一套档位与数值（双端必须一致，否则同一档在
/// 手机与桌面上听起来不一样）。**预设不落盘**：当前生效的档位由 `match(speed:pitch:gap:)`
/// 从三个数值反推，用户手拖任一滑块后自然回落到 nil（UI 显示「自定义」），不会出现
/// 「显示着睡前档、数值却是手调的」这种自相矛盾的状态。
///
/// 预设**不改音色通道**（那涉及密钥与服务配置），只改这三个可听参数；「温和真人」在
/// 系统 TTS 下只能近似，接云端真人音色才到位——UI 要把这句实话讲出来。
public struct SpeechPreset: Equatable, Identifiable, Sendable {
    public let id: String
    public let label: String
    public let scene: String
    public let speed: Double
    public let pitch: Float
    public let gapSeconds: Double
    /// 选中该档时自动挂上的睡眠定时（分钟）；0 表示不动定时器
    public let sleepMinutes: Int
    /// 是否在定时结束前淡出（音量与语速一起收）
    public let fadesOut: Bool
    /// 该档是否依赖真人音色才有意义（系统音色下给提示）
    public let prefersRealVoice: Bool

    /// 浮点比较容差：滑块与预设值都来自同一组字面量，容差只用来吃掉序列化/除法的尾差
    public static let matchTolerance = 0.02
    private static let gapTolerance = 0.05

    private init(
        id: String, label: String, scene: String,
        speed: Double, pitch: Float, gapSeconds: Double,
        sleepMinutes: Int = 0, fadesOut: Bool = false, prefersRealVoice: Bool = false
    ) {
        self.id = id; self.label = label; self.scene = scene
        self.speed = speed; self.pitch = pitch; self.gapSeconds = gapSeconds
        self.sleepMinutes = sleepMinutes; self.fadesOut = fadesOut
        self.prefersRealVoice = prefersRealVoice
    }

    public static let standard = SpeechPreset(
        id: "standard", label: "精读标准", scene: "逐条读懂，适合坐下来看",
        speed: 1.00, pitch: 1.00, gapSeconds: 1.5
    )
    public static let warm = SpeechPreset(
        id: "warm", label: "温和真人", scene: "略慢半拍、音调压低一点，像有人在旁边讲",
        speed: 0.92, pitch: 0.95, gapSeconds: 2.0, prefersRealVoice: true
    )
    public static let commute = SpeechPreset(
        id: "commute", label: "通勤清醒", scene: "语速快一点、切卡停顿短，抵得住路上的碎注意力",
        speed: 1.18, pitch: 1.00, gapSeconds: 0.8
    )
    public static let bedtime = SpeechPreset(
        id: "bedtime", label: "睡前轻缓", scene: "最慢最轻，自动 20 分钟定时并在结束前淡出",
        speed: 0.85, pitch: 0.90, gapSeconds: 2.5, sleepMinutes: 20, fadesOut: true, prefersRealVoice: true
    )

    /// 顺序与 Android `entries` 一致（UI 直接按这个顺序排胶囊）
    public static let all: [SpeechPreset] = [standard, warm, commute, bedtime]

    public static func byID(_ id: String?) -> SpeechPreset? {
        guard let id else { return nil }
        return all.first { $0.id == id }
    }

    /// 从当前三个数值反推生效档位；对不上返回 nil（UI 显示「自定义」）
    public static func match(speed: Double, pitch: Float, gapSeconds: Double) -> SpeechPreset? {
        all.first {
            abs($0.speed - speed) <= matchTolerance &&
            abs(Double($0.pitch) - Double(pitch)) <= matchTolerance &&
            abs($0.gapSeconds - gapSeconds) <= gapTolerance
        }
    }
}
