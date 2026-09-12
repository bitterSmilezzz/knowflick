package com.knowflick.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * 编辑设计系统基调：暗色人文画报（Dark Editorial）。
 * 与 macOS 端 ThemeTokens 对齐的语义色先导版（完整设计令牌在 M2 落地）。
 */
object EditorialColor {
    val likeGreen = Color(0xFF3D8361)
    val dislikeRed = Color(0xFF8C3A3A)
    val aiAmber = Color(0xFFC79A4B)
}

private val DarkColors = darkColorScheme(
    primary = EditorialColor.aiAmber,
    background = Color(0xFF101012),
    surface = Color(0xFF18181B),
)

private val LightColors = lightColorScheme(
    primary = EditorialColor.aiAmber,
    background = Color(0xFFF5F3EE),
    surface = Color(0xFFFFFFFF),
)

@Composable
fun KnowFlickTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkScheme() else LightScheme(),
        content = content,
    )
}

private fun DarkScheme() = darkColorScheme(
    primary = EditorialColor.aiAmber,
    background = Color(0xFF101012),
    surface = Color(0xFF18181B),
)

private fun LightScheme() = lightColorScheme(
    primary = EditorialColor.aiAmber,
    background = Color(0xFFF5F3EE),
    surface = Color(0xFFFFFFFF),
)
