package com.knowflick.app.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf

/**
 * 轻量提示：Android 是 `Toast`，桌面是宿主底部的通知条。
 *
 * **为什么做成宿主提供的 CompositionLocal 而不是 expect/actual**：提示要落在**宿主的界面**上
 * （桌面是 `DesktopHostState.notice` 那条底栏），而不是一个能自己画东西的平台组件。
 * 默认实现是静默的——没提供就什么都不显示，绝不会崩。
 */
fun interface Notifier {
    fun show(message: String)
}

/** 未提供时静默；宿主在根节点用 [CompositionLocalProvider] 注入自己的实现 */
val LocalNotifier = staticCompositionLocalOf<Notifier> { Notifier { } }

/** 共享界面里取提示器：`notifier.show("已复制回答")` */
@Composable
fun rememberNotifier(): Notifier = LocalNotifier.current
