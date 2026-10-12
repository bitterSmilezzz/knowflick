package com.knowflick.app.ui.common

import androidx.compose.runtime.Composable

/**
 * 系统返回键的跨端接缝。
 *
 * - Android（androidMain）：接 `androidx.activity.compose.BackHandler`；
 * - 桌面（jvmMain）：**没有系统返回键**（窗口关闭是另一回事），no-op——屏内返回按钮照常工作。
 *
 * 抽成接缝的理由：CMP 1.8 没有公共的 `BackHandler`，此前每迁一个屏都要在**宿主调用点**再包一层，
 * 于是「某个屏的返回语义」被拆到两个文件里，且宿主越写越厚。收进接缝后，共享屏自己声明返回语义，
 * 宿主不必知道任何屏的返回细节。
 */
@Composable
expect fun PlatformBackHandler(enabled: Boolean = true, onBack: () -> Unit)
