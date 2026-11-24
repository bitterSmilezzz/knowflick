package com.knowflick.app.ui.common

import androidx.compose.runtime.Composable

/**
 * 界面音效的**跨端接缝**：Android 有合成音效（`AudioTrack`，见 androidMain 的
 * `AudioEffectHelper`：滑纸声、翻卡声、掌握提示音、点击声），桌面端没有对应音效设计，用 no-op。
 *
 * 与 [PlatformHaptics] 同一形态：音效属于「允许各端各写」的平台边界，但必须收在一个接缝里，
 * 共享界面只调这些方法，不碰 `AudioTrack` / `Context`。
 */
interface PlatformSounds {
    fun playPaperSlide()
    fun playCardFlip()
    fun playMasteryChime()
    fun playClick()
}

/** 无音效平台（桌面三端）的空实现 */
object NoOpPlatformSounds : PlatformSounds {
    override fun playPaperSlide() = Unit
    override fun playCardFlip() = Unit
    override fun playMasteryChime() = Unit
    override fun playClick() = Unit
}

/** 取当前平台的音效实现；共享界面在需要反馈处调用它 */
@Composable
expect fun rememberPlatformSounds(): PlatformSounds
