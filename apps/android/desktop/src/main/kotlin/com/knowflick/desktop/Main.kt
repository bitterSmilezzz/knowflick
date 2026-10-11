package com.knowflick.desktop

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.MenuBar
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import com.knowflick.app.data.AppModel
import com.knowflick.app.data.CardStorage
import com.knowflick.app.ui.KnowFlickTheme
import com.knowflick.app.ui.LibraryScreen
import com.knowflick.app.ui.PaperTheme
import com.knowflick.app.ui.QuizScreen
import java.awt.Frame

fun main() = application {
    Window(onCloseRequest = ::exitApplication, title = "KnowFlick") {
        // 真实卡库：与 Android 端同一份落盘实现（:shared-data），这里只注入桌面数据目录。
        // 空库是正常起点（预置知识库已退役，内容由用户剪藏/导入产生）。
        val state = remember {
            DesktopHostState(AppModel(CardStorage.shared(DesktopPaths.storeDir())).apply { bootstrap() })
        }

        // 桌面原生的入口放菜单栏（而不是另造一套界面）：测验是共享 `QuizScreen`，编排是共享 `QuizCycle`
        MenuBar {
            Menu("学习", mnemonic = 'L') {
                Item("开始知识测验（10 张）", onClick = { state.startQuiz() })
                Item("只测今天到期", onClick = { state.startDueReview() })
                Separator()
                Item("退出测验", enabled = state.quizSession != null, onClick = { state.exitQuiz() })
            }
        }

        KnowFlickTheme(paperTheme = PaperTheme.SYSTEM) {
            // window 是 ComposeWindow（Frame），交给原生文件对话框做 owner，保证模态行为正确
            DesktopHost(state = state, owner = window)
        }
    }
}

/**
 * 桌面宿主：界面几乎全部来自共享模块——卡库是 `:shared-data`、屏幕是 `:shared-ui`、
 * 测验编排是 `:domain` 的 `QuizCycle`。自己只负责平台边界（文件对话框、菜单栏、数据目录）。
 *
 * 当前能力：浏览卡库（收藏阁 / 历史）、导入归档、导出 Markdown/JSON、**知识测验与到期复习**。
 * 未接线：详情页与追问/海报 Sheet（未迁入共享模块）、系统级分享（桌面用「另存为」替代）。
 */
@Composable
fun DesktopHost(state: DesktopHostState, owner: Frame? = null) {
    val model = state.model
    val quizSession = state.quizSession

    Box(Modifier.fillMaxSize()) {
        if (quizSession != null) {
            // key(version)：评分只改动**同一个** QuizSession 实例的内部进度（实例不变），
            // 所以必须靠 version 触发重组；key 同时完成「订阅 version」与「重建这棵子树」，
            // 与 Android 宿主对版本驱动屏幕的处理同一手法（MainActivity 的 key(viewModel.version)）。
            key(state.version) {
                QuizScreen(
                    session = quizSession,
                    onRate = state::rateQuiz,
                    onNextRound = state::nextQuizRound,
                    onRetestWeakCards = state::retestWeak,
                    onOpenChat = { state.showNotice("卡片追问尚未在桌面端接线") },
                    onPromoteCardToDeck = { state.showNotice("置顶到卡堆尚未在桌面端接线") },
                    onExit = state::exitQuiz,
                )
            }
        } else {
            LibraryScreen(
                cards = model.store.cards,
                version = state.version,
                onOpenDetail = { state.showNotice("详情页尚未迁入共享模块") },
                onBack = { /* 桌面没有系统返回 */ },
                onShareFavorites = { favorites ->
                    state.saveText(
                        owner = owner,
                        title = "导出收藏笔记",
                        defaultName = "KnowFlick 收藏笔记.md",
                        text = DesktopArchiveActions.exportMarkdown(favorites, "KnowFlick 知识收藏阁"),
                    )
                },
                onShareArchive = { cards ->
                    state.saveText(
                        owner = owner,
                        title = "导出知识库镜像",
                        defaultName = "knowflick-cards.json",
                        text = DesktopArchiveActions.exportJson(cards),
                    )
                },
                onPickImportFile = {
                    val file = DesktopFileDialogs.openFile(
                        owner = owner,
                        title = "导入知识库归档（.zip / .json）",
                        extensions = listOf(".zip", ".json"),
                    )
                    if (file == null) {
                        state.dismissNotice()
                    } else {
                        runCatching { DesktopArchiveActions.readArchiveBytes(file) }.fold(
                            onSuccess = { bytes -> state.importBytes(file.name, bytes) },
                            onFailure = { error ->
                                state.showNotice("导入失败：${error.message ?: "无法读取文件"}")
                            },
                        )
                    }
                },
            )
        }

        state.notice?.let { message ->
            Surface(
                modifier = Modifier.align(Alignment.BottomCenter).padding(20.dp),
                color = MaterialTheme.colorScheme.inverseSurface,
                contentColor = MaterialTheme.colorScheme.inverseOnSurface,
                shape = MaterialTheme.shapes.medium,
                tonalElevation = 3.dp,
            ) {
                Text(message, Modifier.padding(horizontal = 16.dp, vertical = 10.dp))
            }
        }
    }
}
