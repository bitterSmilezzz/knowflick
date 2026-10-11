package com.knowflick.app.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback

/**
 * Android 实现：包住原有的 [HapticFeedbackHelper]（API 29+ 的 `VibrationEffect` 预设 +
 * 低版本回退 Compose 触觉），行为与迁移前完全一致。
 */
@Composable
actual fun rememberPlatformHaptics(): PlatformHaptics {
    val context = LocalContext.current
    val composeHaptic = LocalHapticFeedback.current
    return remember(context, composeHaptic) {
        val helper = HapticFeedbackHelper(context, composeHaptic)
        object : PlatformHaptics {
            override fun tick() = helper.tick()
            override fun click() = helper.click()
            override fun success() = helper.success()
            override fun warning() = helper.warning()
        }
    }
}
