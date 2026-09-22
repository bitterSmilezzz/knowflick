package com.knowflick.app.speech

/**
 * 睡眠定时的收尾淡出：不硬切，最后一段窗口里把音量和语速一起收下来。
 *
 * 与 mac 端 `KnowFlickCore/Models/SleepFade.swift` 同一套曲线（同一剩余秒数双端必须
 * 给出同样的音量与语速系数）。纯函数，定时循环只负责把结果搬到播放器上。
 */
object SleepFade {
    /** 默认淡出窗口（秒） */
    const val DEFAULT_WINDOW_SECONDS = 30

    /** 淡到底时保留的音量：留一点余声，避免「突然安静」把人彻底弄醒 */
    const val MIN_VOLUME = 0.15f

    /** 淡到底时的语速系数（相对当前语速）：慢一成，更像要睡了 */
    const val MIN_SPEED_SCALE = 0.90f

    data class Plan(val volume: Float, val speedScale: Float)

    /** 全程满音量（窗口外或窗口长度为 0） */
    val full = Plan(1f, 1f)

    /**
     * @param remainingSeconds 距离定时结束的秒数
     * @param windowSeconds 淡出窗口长度；剩余秒数 ≥ 窗口时不淡出
     */
    fun plan(remainingSeconds: Int, windowSeconds: Int = DEFAULT_WINDOW_SECONDS): Plan {
        if (windowSeconds <= 0 || remainingSeconds >= windowSeconds) return full
        val progress = if (remainingSeconds <= 0) 0f else remainingSeconds.toFloat() / windowSeconds
        return Plan(
            volume = MIN_VOLUME + (1f - MIN_VOLUME) * progress,
            speedScale = 1f - (1f - MIN_SPEED_SCALE) * (1f - progress),
        )
    }
}
