package com.knowflick.app

import android.content.ClipData
import android.content.Intent
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.lifecycle.lifecycleScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.knowflick.app.ui.DeckScreen
import com.knowflick.app.ui.DetailScreen
import com.knowflick.app.ui.KnowFlickTheme
import com.knowflick.app.ui.StatsScreen
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 应用入口：卡堆 / 详情 / 统计 / 知识库 / 设置；语音朗读挂接全局控制器 */
@OptIn(ExperimentalComposeUiApi::class)
class MainActivity : ComponentActivity() {

    private enum class Screen { DECK, DETAIL, STATS, SETTINGS, LIBRARY, QUIZ }

    private val viewModel: KnowFlickViewModel by viewModels()

    private var screen by mutableStateOf(Screen.DECK)
    private var detailCardId by mutableStateOf<String?>(null)
    private var detailReturnScreen by mutableStateOf(Screen.DECK)

    /** 知识库导入：选择 JSON/文本文件并逐卡挽救导入 */
    private val importFilePicker = registerForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) {
            viewModel.importFromUri(uri)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        screen = Screen.entries.firstOrNull { it.name == savedInstanceState?.getString("screen") } ?: Screen.DECK
        detailCardId = savedInstanceState?.getString("detailCardId")
        detailReturnScreen = if (savedInstanceState?.getString("detailReturnScreen") == Screen.LIBRARY.name) Screen.LIBRARY else Screen.DECK
        enableEdgeToEdge()
        setContent {
            KnowFlickTheme {
                val libraryState = rememberSaveableStateHolder()
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(MaterialTheme.colorScheme.background)
                        .safeDrawingPadding()
                        // 让 UIAutomator 能用稳定资源 ID 驱动 baseline profile 与性能回归。
                        .semantics { testTagsAsResourceId = true },
                ) {
                    when (screen) {
                        Screen.DECK -> {
                            // 显式读取 version 建立响应性，再把卡堆快照作为参数传给 DeckScreen：
                            // 卡堆是普通可变属性，Compose 观察不到它的变化，必须靠参数比较发现差异。
                            val deckVersion = viewModel.version
                            DeckScreen(
                                store = viewModel.model.store,
                                deck = viewModel.model.store.deck,
                                version = deckVersion,
                                onMutate = viewModel::mutate,
                                showAIMark = viewModel.settings.showAIMark,
                                onOpenDetail = { card ->
                                    detailCardId = card.id
                                    detailReturnScreen = Screen.DECK
                                    screen = Screen.DETAIL
                                },
                                onOpenStats = { screen = Screen.STATS },
                                onOpenFavorites = { screen = Screen.LIBRARY },
                                onOpenSettings = { screen = Screen.SETTINGS },
                            isGenerating = viewModel.isGenerating,
                            notice = viewModel.persistenceNotice ?: viewModel.generateNotice,
                            onGenerateRequest = { viewModel.generateNewCards(count = 3) },
                            onOpenQuiz = {
                                viewModel.startQuiz()
                                screen = Screen.QUIZ
                            },
                                isAmbientMode = viewModel.speech.isAmbientMode,
                                onToggleAmbient = {
                                    viewModel.speech.toggleAmbient(viewModel.model.store.topCard)
                                    viewModel.bump()
                                },
                                canUndo = viewModel.canUndoLastSwipe,
                                onUndo = { viewModel.undoLastSwipe() },
                            )
                        }
                        Screen.DETAIL -> {
                            val card = remember(detailCardId, viewModel.version) {
                                viewModel.model.store.cards.firstOrNull { it.id == detailCardId }
                            }
                            if (card == null) {
                                screen = detailReturnScreen
                            } else {
                                val isFavorite = card.isFavorite
                                DetailScreen(
                                    card = card,
                                    isFavorite = isFavorite,
                                    showAIMark = viewModel.settings.showAIMark,
                                    isSpeakingState = viewModel.speech.speakingCardId == card.id && viewModel.speech.isSpeaking,
                                    onToggleFavorite = {
                                        viewModel.mutate { viewModel.model.store.toggleFavorite(card) }
                                    },
                                    onToggleSpeech = {
                                        viewModel.speech.toggle(card)
                                        viewModel.bump()
                                    },
                                    onBack = { screen = detailReturnScreen },
                                )
                            }
                        }
                        Screen.STATS -> StatsScreen(
                            cards = viewModel.model.store.cards,
                            onBack = { screen = Screen.DECK },
                        )
                        Screen.SETTINGS -> com.knowflick.app.ui.SettingsScreen(
                            initial = viewModel.settings,
                            initialApiKey = viewModel.currentApiKey(),
                            initialSpeech = viewModel.speechSettings,
                            initialSpeechKey = viewModel.currentSpeechApiKey(),
                            onBack = { screen = Screen.DECK },
                            onTestConnection = { temp, key -> viewModel.testConnection(temp, key) },
                            onSave = { updated, key -> viewModel.saveSettings(updated, key) },
                            onSaveSpeech = { speech, key -> viewModel.saveSpeechSettings(speech, key) },
                            credentialsEncrypted = viewModel.credentialsEncrypted,
                        )
                        Screen.QUIZ -> {
                            val session = viewModel.quizSession
                            if (session == null) {
                                screen = Screen.DECK
                            } else {
                                com.knowflick.app.ui.QuizScreen(
                                    session = session,
                                    onRate = { rating -> viewModel.rateQuiz(rating) },
                                    onNextRound = { viewModel.nextQuizRound() },
                                    onExit = {
                                        viewModel.exitQuiz()
                                        screen = Screen.DECK
                                    },
                                )
                            }
                        }
                        Screen.LIBRARY -> libraryState.SaveableStateProvider("library") {
                            com.knowflick.app.ui.LibraryScreen(
                                cards = viewModel.model.store.cards,
                                version = viewModel.version,
                                onOpenDetail = { card ->
                                    detailCardId = card.id
                                    detailReturnScreen = Screen.LIBRARY
                                    screen = Screen.DETAIL
                                },
                                onBack = { screen = Screen.DECK },
                                onShareFavorites = { favorites ->
                                    shareFile("KnowFlick 收藏笔记.md") {
                                        com.knowflick.app.data.CardExportEngine.exportMarkdownSingleFile(
                                            favorites,
                                            "KnowFlick 知识收藏阁",
                                        )
                                    }
                                },
                                onShareArchive = { cards ->
                                    shareFile("knowflick_cards.json") {
                                        com.knowflick.app.data.CardExportEngine.exportJSONArchive(cards)
                                    }
                                },
                                onPickImportFile = { importFilePicker.launch(arrayOf("application/json", "text/*")) },
                            )
                        }
                    }
                }
            }
        }
    }

    /** 文本生成与文件写入都在 IO 线程执行，大卡库导出不会阻塞知识库界面。 */
    private fun shareFile(title: String, createText: () -> String) {
        lifecycleScope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    val text = createText()
                    com.knowflick.app.data.ShareFileWriter.create(this@MainActivity, text, title)
                }
            }.onSuccess { shared ->
                val intent = Intent(Intent.ACTION_SEND).apply {
                    type = shared.mimeType
                    putExtra(Intent.EXTRA_STREAM, shared.uri)
                    putExtra(Intent.EXTRA_TITLE, title)
                    clipData = ClipData.newRawUri(title, shared.uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                startActivity(Intent.createChooser(intent, title))
            }.onFailure { error ->
                viewModel.showNotice("导出失败：${error.message ?: "无法创建分享文件"}")
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("screen", screen.name)
        outState.putString("detailCardId", detailCardId)
        outState.putString("detailReturnScreen", detailReturnScreen.name)
        super.onSaveInstanceState(outState)
    }

    override fun onPause() {
        super.onPause()
        viewModel.flushPending()
    }
}
