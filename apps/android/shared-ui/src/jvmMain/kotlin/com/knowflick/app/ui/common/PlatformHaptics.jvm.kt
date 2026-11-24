package com.knowflick.app.ui.common

import androidx.compose.runtime.Composable

/** 桌面（Windows / macOS / Linux）没有触觉反馈：一律空实现，不引入任何平台依赖。 */
@Composable
actual fun rememberPlatformHaptics(): PlatformHaptics = NoOpPlatformHaptics
