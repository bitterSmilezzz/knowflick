package com.knowflick.app.ui.common

import androidx.compose.runtime.Composable

/** Android：转给 activity-compose 的 [androidx.activity.compose.BackHandler]（行为与宿主直连一致） */
@Composable
actual fun PlatformBackHandler(enabled: Boolean, onBack: () -> Unit) {
    androidx.activity.compose.BackHandler(enabled = enabled, onBack = onBack)
}
