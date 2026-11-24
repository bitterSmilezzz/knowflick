package com.knowflick.app.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

/**
 * Android 实现：包住原有的 [AudioEffectHelper]（合成音效），行为与迁移前一致。
 * `AudioEffectHelper` 本身也在本模块的 androidMain，不再由 `:app` 私藏。
 */
@Composable
actual fun rememberPlatformSounds(): PlatformSounds {
    val context = LocalContext.current
    return remember(context) {
        object : PlatformSounds {
            override fun playPaperSlide() = AudioEffectHelper.playPaperSlide(context)
            override fun playCardFlip() = AudioEffectHelper.playCardFlip(context)
            override fun playMasteryChime() = AudioEffectHelper.playMasteryChime(context)
            override fun playClick() = AudioEffectHelper.playClick(context)
        }
    }
}
