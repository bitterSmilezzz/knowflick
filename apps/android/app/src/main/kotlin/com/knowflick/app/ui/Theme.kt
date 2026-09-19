package com.knowflick.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** 语义色与扁平化设计令牌（与 macOS ThemeTokens 对齐；Editorial / Flat Minimalist） */
object EditorialColor {
    // 语义主色（经典低饱和）
    val likeGreen = Color(0xFF388E69)
    val dislikeRed = Color(0xFFC24C4C)
    val aiAmber = Color(0xFFC79A4B)
    val warningOrange = Color(0xFFD9743A)
    val detailBlue = Color(0xFF4A7C9D)

    // 扁平化低饱和微彩托盘（浅色模式底托与边框）
    val likeGreenPastel = Color(0xFFEEF6F2)
    val likeGreenBorder = Color(0xFFCEE4D7)
    val dislikeRedPastel = Color(0xFFFDF0F0)
    val dislikeRedBorder = Color(0xFFF3D2D2)
    val detailBluePastel = Color(0xFFF1F5F8)
    val detailBlueBorder = Color(0xFFD3E0EA)

    // 扁平化低饱和微彩托盘（深色模式底托与边框）
    val likeGreenPastelDark = Color(0xFF1B2822)
    val likeGreenBorderDark = Color(0xFF2E4B3D)
    val dislikeRedPastelDark = Color(0xFF291B1D)
    val dislikeRedBorderDark = Color(0xFF4C272A)
    val detailBluePastelDark = Color(0xFF1B232C)
    val detailBlueBorderDark = Color(0xFF2B3C4E)

    // 1px 极细微结构边框 (Hairline Borders)
    val hairlineLight = Color(0x14000000)
    val hairlineDark = Color(0x24FFFFFF)
    val hairlineCard = Color(0x26FFFFFF)
}

private val DarkColors = darkColorScheme(
    primary = EditorialColor.aiAmber,
    background = Color(0xFF121215),
    surface = Color(0xFF1B1B1F),
    surfaceVariant = Color(0xFF232328),
    outline = Color(0x26FFFFFF),
    onBackground = Color(0xFFEDE9E1),
    onSurface = Color(0xFFEDE9E1),
)

private val LightColors = lightColorScheme(
    primary = EditorialColor.aiAmber,
    background = Color(0xFFFAF9F6),
    surface = Color(0xFFFFFFFF),
    surfaceVariant = Color(0xFFF2F0EB),
    outline = Color(0x14000000),
    onBackground = Color(0xFF23211E),
    onSurface = Color(0xFF23211E),
)

/** 暗色人文画报（Dark Editorial）基调，跟随系统深浅色 */
@Composable
fun KnowFlickTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
        content = content,
    )
}
