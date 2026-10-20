package com.knowflick.app.ui.common

import android.widget.Toast
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

/**
 * Android 宿主用这个包住根内容，共享界面里的 `notifier.show(...)` 就会走系统 Toast。
 * 保持与迁移前完全一致的用户可见行为（原先是共享屏里直接 `Toast.makeText(...)`）。
 */
@Composable
fun ProvideToastNotifier(content: @Composable () -> Unit) {
    val context = LocalContext.current
    val notifier = remember(context) {
        Notifier { message -> Toast.makeText(context, message, Toast.LENGTH_SHORT).show() }
    }
    CompositionLocalProvider(LocalNotifier provides notifier) { content() }
}
