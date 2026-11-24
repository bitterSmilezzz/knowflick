package com.knowflick.app.ui.common

import androidx.compose.runtime.Composable

/**
 * 触觉反馈的**跨端接缝**：Android 用系统振动器（分级预设，见 androidMain 的 `HapticFeedbackHelper`），
 * 桌面没有对应能力，用 [NoOpPlatformHaptics]。
 *
 * 触觉属于「允许各端各写」的平台边界，但必须收在一个接缝里——共享界面只调 [PlatformHaptics]，
 * 不碰 `Vibrator` / `Context`。原来的 `HapticFeedbackHelper` 直接依赖这两者，所以它被放进了
 * androidMain：**签名与行为不变**，Android 端的手感不受影响。
 */
interface PlatformHaptics {
    fun tick()
    fun click()
    fun success()
    fun warning()
}

/** 无触觉平台（桌面三端）的空实现；不引入任何平台依赖 */
object NoOpPlatformHaptics : PlatformHaptics {
    override fun tick() = Unit
    override fun click() = Unit
    override fun success() = Unit
    override fun warning() = Unit
}

/** 取当前平台的触觉实现；共享界面在需要反馈处调用它 */
@Composable
expect fun rememberPlatformHaptics(): PlatformHaptics
