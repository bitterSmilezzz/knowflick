package com.knowflick.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** 语义色（与 macOS ThemeTokens 对齐的先导版；完整设计令牌随后续里程碑落地） */
object EditorialColor {
    val likeGreen = androidx.compose.ui.graphics.Color(0xFF3D8361)
    val dislikeRed = androidx.compose.ui.graphics.Color(0xFF8C3A3A)
    val aiAmber = androidx.compose.ui.graphics.Color(0xFFC79A4B)

    /** 降级/风险提示橙：与品牌强调色 aiAmber 区分，专用于「功能可用但已降级」的知情提示 */
    val warningOrange = androidx.compose.ui.graphics.Color(0xFFD9743A)
}

private val DarkColors = darkColorScheme(
    primary = EditorialColor.aiAmber,
    background = androidx.compose.ui.graphics.Color(0xFF101012),
    surface = androidx.compose.ui.graphics.Color(0xFF1B1B1F),
    onBackground = androidx.compose.ui.graphics.Color(0xFFEDE9E1),
    onSurface = androidx.compose.ui.graphics.Color(0xFFEDE9E1),
)

private val LightColors = lightColorScheme(
    primary = EditorialColor.aiAmber,
    background = androidx.compose.ui.graphics.Color(0xFFF5F3EE),
    surface = androidx.compose.ui.graphics.Color(0xFFFFFFFF),
    onBackground = androidx.compose.ui.graphics.Color(0xFF23211E),
    onSurface = androidx.compose.ui.graphics.Color(0xFF23211E),
)

/** 暗色人文画报（Dark Editorial）基调，跟随系统深浅色 */
@Composable
fun KnowFlickTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
        content = content,
    )
}
