package com.knowflick.desktop

import androidx.compose.runtime.Composable
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import com.knowflick.app.ui.KnowFlickTheme
import com.knowflick.app.ui.LibraryScreen
import com.knowflick.app.ui.PaperTheme

fun main() = application {
    Window(onCloseRequest = ::exitApplication, title = "KnowFlick 桌面（骨架）") {
        KnowFlickTheme(paperTheme = PaperTheme.SYSTEM) { DesktopHost() }
    }
}

/**
 * 桌面宿主骨架：直接渲染**共享界面模块 `:shared-ui` 里的 LibraryScreen**——
 * 与 Android 端跑的是同一份 Compose 代码（`shared-ui/src/jvmAndAndroidMain/.../ui/LibraryScreen.kt`）。
 *
 * 尚未接线：平台动作（分享 / 导入文件 / 备份导出）在桌面是空实现；库数据还是示例卡
 * （桌面侧没有 data 层）。范围与波次见 docs/adr/0001-desktop-tri-platform-shared-kotlin.md。
 */
@Composable
fun DesktopHost() {
    LibraryScreen(
        cards = DomainBridge.sampleCards(),
        version = 0,
        onOpenDetail = { /* 详情页尚未迁入共享模块 */ },
        onBack = { /* 桌面没有系统返回 */ },
        onShareFavorites = { /* 平台分享待接线 */ },
        onShareArchive = { /* 平台分享待接线 */ },
        onPickImportFile = { /* 文件选择器待接线 */ },
    )
}
