package com.knowflick.app.ui.common

import androidx.compose.runtime.Composable

/** 桌面：没有系统返回键，什么都不做（屏内返回按钮才是桌面上的返回路径）。 */
@Composable
actual fun PlatformBackHandler(enabled: Boolean, onBack: () -> Unit) = Unit
