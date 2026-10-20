package com.knowflick.desktop

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import com.knowflick.app.data.AppModel
import com.knowflick.app.data.CardStorage
import com.knowflick.app.ui.KnowFlickTheme
import com.knowflick.app.ui.LibraryScreen
import com.knowflick.app.ui.PaperTheme

fun main() = application {
    Window(onCloseRequest = ::exitApplication, title = "KnowFlick 桌面（骨架）") {
        // 真实卡库：与 Android 端同一份落盘实现（:shared-data），这里只注入桌面数据目录。
        // 空库是正常起点（预置知识库已退役，内容由用户剪藏/导入产生）。
        val model = remember {
            AppModel(CardStorage.shared(DesktopPaths.storeDir())).apply { bootstrap() }
        }
        KnowFlickTheme(paperTheme = PaperTheme.SYSTEM) { DesktopHost(model) }
    }
}

/**
 * 桌面宿主：直接渲染**共享界面模块 `:shared-ui` 里的 LibraryScreen**，数据来自
 * **共享持久化模块 `:shared-data` 里的真实卡库**——与 Android 端跑的是同一份 Compose 与同一份存储代码。
 *
 * 尚未接线：平台动作（分享 / 导入文件 / 备份导出）在桌面是空实现——所以桌面端目前还无法
 * 把卡片放进来（卡库通常是空的）。范围见 docs/adr/0001-desktop-tri-platform-shared-kotlin.md。
 */
@Composable
fun DesktopHost(model: AppModel) {
    LibraryScreen(
        cards = model.store.cards,
        // 仅作 remember 缓存键：cards 变化时它必然变化
        version = model.store.cards.size,
        onOpenDetail = { /* 详情页尚未迁入共享模块 */ },
        onBack = { /* 桌面没有系统返回 */ },
        onShareFavorites = { /* 平台分享待接线 */ },
        onShareArchive = { /* 平台分享待接线 */ },
        onPickImportFile = { /* 文件选择器待接线 */ },
    )
}
