package com.knowflick.app.speech

/**
 * 听书音色预设：把「音色通道 + 语速 + 音调 + 切卡停顿」打包成一键可选的场景档。
 *
 * 与 mac 端 `KnowFlickCore/Models/SpeechPreset.swift` 是同一套档位与数值（双端必须一致，
 * 否则同一档在手机与桌面上听起来不一样）。**预设不落盘**：当前生效的档位由
 * [match] 从三个数值反推，用户手拖任一滑块后自然回落到「自定义」，不会出现
 * 「显示着睡前档、数值却是手调的」这种自相矛盾的状态。
 *
 * 预设**不改音色通道**（那涉及密钥与服务配置），只改这三个可听参数；
 * 「温和真人」在系统 TTS 下只能近似，接云端真人音色才到位——UI 要把这句实话讲出来。
 */
enum class SpeechPreset(
    val id: String,
    val label: String,
    val scene: String,
    val speed: Float,
    val pitch: Float,
    val gapSeconds: Double,
    /** 选中该档时自动挂上的睡眠定时（分钟）；0 表示不动定时器 */
    val sleepMinutes: Int = 0,
    /** 是否在定时结束前淡出（音量与语速一起收） */
    val fadesOut: Boolean = false,
    /** 该档是否依赖真人音色才有意义（系统 TTS 下给提示） */
    val prefersRealVoice: Boolean = false,
) {
    STANDARD(
        id = "standard",
        label = "精读标准",
        scene = "逐条读懂，适合坐下来看",
        speed = 1.00f,
        pitch = 1.00f,
        gapSeconds = 1.5,
    ),
    WARM(
        id = "warm",
        label = "温和真人",
        scene = "略慢半拍、音调压低一点，像有人在旁边讲",
        speed = 0.92f,
        pitch = 0.95f,
        gapSeconds = 2.0,
        prefersRealVoice = true,
    ),
    COMMUTE(
        id = "commute",
        label = "通勤清醒",
        scene = "语速快一点、切卡停顿短，抵得住路上的碎注意力",
        speed = 1.18f,
        pitch = 1.00f,
        gapSeconds = 0.8,
    ),
    BEDTIME(
        id = "bedtime",
        label = "睡前轻缓",
        scene = "最慢最轻，自动 20 分钟定时并在结束前淡出",
        speed = 0.85f,
        pitch = 0.90f,
        gapSeconds = 2.5,
        sleepMinutes = 20,
        fadesOut = true,
        prefersRealVoice = true,
    ),
    ;

    companion object {
        /** 浮点比较容差：滑块与预设值都来自同一组字面量，容差只用来吃掉序列化/除法的尾差 */
        const val MATCH_TOLERANCE = 0.02f
        private const val GAP_TOLERANCE = 0.05

        fun byId(id: String?): SpeechPreset? = entries.firstOrNull { it.id == id }

        /** 从当前三个数值反推生效档位；对不上就是 null（UI 显示「自定义」） */
        fun match(speed: Float, pitch: Float, gapSeconds: Double): SpeechPreset? =
            entries.firstOrNull {
                kotlin.math.abs(it.speed - speed) <= MATCH_TOLERANCE &&
                    kotlin.math.abs(it.pitch - pitch) <= MATCH_TOLERANCE &&
                    kotlin.math.abs(it.gapSeconds - gapSeconds) <= GAP_TOLERANCE
            }
    }
}
