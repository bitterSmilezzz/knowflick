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
import com.knowflick.app.domain.RelatedCards
import com.knowflick.app.ui.DeckScreen
import com.knowflick.app.ui.DetailScreen
import com.knowflick.app.ui.KnowFlickTheme
import com.knowflick.app.ui.LibraryScreen
import com.knowflick.app.ui.PaperTheme
import com.knowflick.app.ui.QuizScreen
import com.knowflick.app.ui.StatsScreen
import java.awt.Frame

fun main() = application {
    Window(onCloseRequest = ::exitApplication, title = "KnowFlick") {
        // 真实卡库：与 Android 端同一份落盘实现（:shared-data），这里只注入桌面数据目录。
        // 空库是正常起点（预置知识库已退役，内容由用户剪藏/导入产生）。
        val state = remember {
            DesktopHostState(AppModel(CardStorage.shared(DesktopPaths.storeDir())).apply { bootstrap() })
        }

        // 桌面原生的入口放菜单栏（而不是另造一套界面）：屏幕与编排都是共享模块的
        MenuBar {
            Menu("学习", mnemonic = 'L') {
                Item("刷卡（主页）", onClick = { state.goHome() })
                Item("收藏阁", onClick = { state.openLibrary() })
                Item("学习统计", onClick = { state.openStats() })
                Separator()
                Item("知识测验（10 张）", onClick = { state.startQuiz() })
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
 * 桌面宿主：**界面全部来自共享模块**——卡库是 `:shared-data`，五个整屏（刷卡 / 收藏阁 / 详情 /
 * 测验 / 统计）与全部编排（`QuizCycle` / `RelatedCards` / `StatsCalculator`）都在 `:shared-ui` / `:domain`。
 * 自己只负责平台边界：数据目录、原生文件对话框、菜单栏，以及桌面没有的能力（微件 / 海报导出 / 语音）。
 *
 * 当前能力：刷卡（含收藏、撤销之外的全部手势与音效接缝）、收藏阁、卡片详情、知识测验、学习统计、
 * 导入归档、导出 Markdown/JSON、三系统安装包。
 */
@Composable
fun DesktopHost(state: DesktopHostState, owner: Frame? = null) {
    val model = state.model
    val quizSession = state.quizSession
    val detailCard = state.detailCard

    // 导入归档：对话框取字节 → 共享引擎解析合并（刷卡页与收藏阁共用同一入口）
    val pickAndImport: () -> Unit = {
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
                onFailure = { error -> state.showNotice("导入失败：${error.message ?: "无法读取文件"}") },
            )
        }
    }

    Box(Modifier.fillMaxSize()) {
        when {
            quizSession != null -> key(state.version) {
                // key(version)：评分只改动**同一个** QuizSession 实例的内部进度（实例不变），
                // 所以必须靠 version 触发重组；key 同时完成「订阅 version」与「重建这棵子树」，
                // 与 Android 宿主对版本驱动屏幕的处理同一手法（MainActivity 的 key(viewModel.version)）。
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

            detailCard != null -> key(state.version) {
                // 详情页：与 Android 端同一份。聊天/海报 Sheet 传 null——桌面暂未接
                //（聊天要 AI 供应商配置、海报要光栅化），但屏本体是共享的。
                DetailScreen(
                    card = detailCard,
                    isFavorite = detailCard.isFavorite,
                    showAIMark = true,
                    isSpeakingState = false,
                    onToggleFavorite = { state.toggleFavorite(detailCard) },
                    onToggleSpeech = { state.showNotice("语音朗读尚未在桌面端接线") },
                    onBack = state::closeDetail,
                    relatedCards = RelatedCards.pick(detailCard, model.store.cards),
                    onSelectRelatedCard = { related -> state.openDetail(related.id) },
                    onOpenChat = { state.showNotice("卡片追问尚未在桌面端接线") },
                )
            }

            state.showingStats -> key(state.version) {
                StatsScreen(
                    cards = model.store.cards,
                    onBack = state::goHome,
                    onStartDueReview = state::startDueReviewFromStats,
                    onOpenCardDetail = { cardId -> state.openDetail(cardId) },
                )
            }

            state.showingLibrary -> LibraryScreen(
                cards = model.store.cards,
                version = state.version,
                onOpenDetail = { card -> state.openDetail(card.id) },
                onBack = state::goHome,
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
                onPickImportFile = pickAndImport,
            )

            else -> key(state.version) {
                // 刷卡页：Android 的主屏，桌面同为首页（产品对齐，而不是另造一套导航）
                DeckScreen(
                    store = model.store,
                    deck = model.store.deck,
                    version = state.version,
                    showAIMark = true,
                    onMutate = state::mutate,
                    notice = state.notice,
                    onOpenDetail = { card -> state.openDetail(card.id) },
                    onOpenStats = state::openStats,
                    onOpenFavorites = state::openLibrary,
                    onOpenQuiz = state::startQuiz,
                    onOpenSearch = { state.showNotice("搜索尚未迁入共享模块") },
                    onOpenSettings = { state.showNotice("设置页尚未迁入共享模块") },
                    onOpenGraph = { state.showNotice("知识图谱尚未迁入共享模块") },
                    onOpenMap = { state.showNotice("学习地图尚未迁入共享模块") },
                    onOpenSync = { state.showNotice("局域网同步尚未在桌面端接线") },
                    onOpenClip = { state.showNotice("网页剪藏尚未在桌面端接线") },
                    onGenerateRequest = { state.showNotice("AI 生成尚未在桌面端接线（需要供应商配置）") },
                    onOpenBackupExport = { state.showNotice("备份导出面板尚未在桌面端接线") },
                    onPickImportFile = pickAndImport,
                    // 微件与海报导出是 Android 能力：桌面不传槽位，菜单项与面板自然不出现
                )
            }
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
