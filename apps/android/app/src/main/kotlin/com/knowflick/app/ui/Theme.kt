package com.knowflick.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * 纸质人文主题风格体系 (Paper Themes)
 */
enum class PaperTheme(val displayName: String, val subtitle: String) {
    SYSTEM("跟随系统", "自适应系统深浅模式"),
    RICE_PAPER("宣纸白", "温暖米白"),
    PARCHMENT("羊皮纸", "温润驼黄"),
    MORNING_MIST("晨雾灰", "清朗灰调"),
    WARM_OBSIDIAN("暖曜黑", "柔和暗色");

    companion object {
        fun fromName(name: String?): PaperTheme =
            entries.firstOrNull { it.name.equals(name, ignoreCase = true) } ?: SYSTEM
    }
}

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

// 1. 宣纸白（天然手造纸）
val RicePaperColors = lightColorScheme(
    primary = Color(0xFF80591D),
    onPrimary = Color.White,
    background = Color(0xFFFAF9F6),
    surface = Color(0xFFFFFFFF),
    surfaceVariant = Color(0xFFF2F0EB),
    outline = Color(0x14000000),
    onBackground = Color(0xFF23211E),
    onSurface = Color(0xFF23211E),
)

// 2. 复古羊皮纸（古典书卷）
val ParchmentColors = lightColorScheme(
    primary = Color(0xFF78521D),
    onPrimary = Color.White,
    background = Color(0xFFF5EFE6),
    surface = Color(0xFFFAF6EE),
    surfaceVariant = Color(0xFFEBE2D3),
    outline = Color(0x1E5C4328),
    onBackground = Color(0xFF2E271F),
    onSurface = Color(0xFF2E271F),
)

// 3. 晨雾冷灰（清朗现代）
val MorningMistColors = lightColorScheme(
    primary = Color(0xFF356580),
    onPrimary = Color.White,
    background = Color(0xFFEFF2F4),
    surface = Color(0xFFF7F9FA),
    surfaceVariant = Color(0xFFE1E6EB),
    outline = Color(0x1E2C3844),
    onBackground = Color(0xFF1E252C),
    onSurface = Color(0xFF1E252C),
)

// 4. 暖曜黑（墨玉护眼）
val WarmObsidianColors = darkColorScheme(
    primary = EditorialColor.aiAmber,
    onPrimary = Color(0xFF231B0F),
    background = Color(0xFF121215),
    surface = Color(0xFF1B1B1F),
    surfaceVariant = Color(0xFF232328),
    outline = Color(0x26FFFFFF),
    onBackground = Color(0xFFEDE9E1),
    onSurface = Color(0xFFEDE9E1),
)

/** Keep Material controls within the selected palette rather than default purple roles. */
private fun ColorScheme.paperControls(): ColorScheme = copy(
    primaryContainer = surfaceVariant,
    onPrimaryContainer = onSurface,
    secondary = primary,
    onSecondary = onPrimary,
    secondaryContainer = surfaceVariant,
    onSecondaryContainer = onSurface,
    tertiary = primary,
    onTertiary = onPrimary,
    tertiaryContainer = surfaceVariant,
    onTertiaryContainer = onSurface,
    onSurfaceVariant = onSurface.copy(alpha = 0.75f),
    outlineVariant = onSurface.copy(alpha = 0.16f),
    surfaceDim = background,
    surfaceBright = surface,
    surfaceContainerLowest = background,
    surfaceContainerLow = surface,
    surfaceContainer = surfaceVariant,
    surfaceContainerHigh = surfaceVariant,
    surfaceContainerHighest = surfaceVariant,
    inverseSurface = onSurface,
    inverseOnSurface = surface,
    inversePrimary = if (background == WarmObsidianColors.background) RicePaperColors.primary else WarmObsidianColors.primary,
)

/** 全局主题包装，支持跟随系统与 4 款纸质人文主题热切换 */
@Composable
fun KnowFlickTheme(
    paperTheme: PaperTheme = PaperTheme.SYSTEM,
    content: @Composable () -> Unit,
) {
    val isSystemDark = isSystemInDarkTheme()
    val scheme = when (paperTheme) {
        PaperTheme.SYSTEM -> if (isSystemDark) WarmObsidianColors else RicePaperColors
        PaperTheme.RICE_PAPER -> RicePaperColors
        PaperTheme.PARCHMENT -> ParchmentColors
        PaperTheme.MORNING_MIST -> MorningMistColors
        PaperTheme.WARM_OBSIDIAN -> WarmObsidianColors
    }
    MaterialTheme(
        colorScheme = scheme.paperControls(),
        content = content,
    )
}
