package com.knowflick.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.ui.DeckScreen
import com.knowflick.app.ui.DetailScreen
import com.knowflick.app.ui.KnowFlickTheme
import com.knowflick.app.ui.StatsScreen

/** 应用入口：卡堆 / 详情 / 统计 / 知识库 / 设置；语音朗读挂接全局控制器 */
class MainActivity : ComponentActivity() {

    private enum class Screen { DECK, DETAIL, STATS, SETTINGS, LIBRARY }

    private val viewModel: KnowFlickViewModel by viewModels()

    private var screen by mutableStateOf(Screen.DECK)
    private var detailCard by mutableStateOf<KnowledgeCard?>(null)

    /** 知识库导入：选择 JSON/文本文件并逐卡挽救导入 */
    private val importFilePicker = registerForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) {
            runCatching {
                contentResolver.openInputStream(uri)?.use { stream ->
                    stream.readBytes().decodeToString()
                }.orEmpty()
            }.getOrNull()?.let { text ->
                viewModel.importFromJson(text)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        com.knowflick.app.ui.SpeechController.ensure(this)
        setContent {
            KnowFlickTheme {
                when (screen) {
                    Screen.DECK -> DeckScreen(
                        store = viewModel.model.store,
                        version = viewModel.version,
                        showAIMark = viewModel.settings.showAIMark,
                        onOpenDetail = { card ->
                            detailCard = card
                            screen = Screen.DETAIL
                        },
                        onOpenStats = { screen = Screen.STATS },
                        onOpenFavorites = { screen = Screen.LIBRARY },
                        onOpenSettings = { screen = Screen.SETTINGS },
                        isGenerating = viewModel.isGenerating,
                        notice = viewModel.generateNotice,
                        onGenerateRequest = { viewModel.generateNewCards(count = 3) },
                    )
                    Screen.DETAIL -> {
                        val card = detailCard
                        if (card == null) {
                            screen = Screen.DECK
                        } else {
                            val isFavorite = viewModel.model.store.cards
                                .firstOrNull { it.id == card.id }?.isFavorite == true
                            DetailScreen(
                                card = card,
                                isFavorite = isFavorite,
                                showAIMark = viewModel.settings.showAIMark,
                                isSpeakingState = com.knowflick.app.ui.SpeechController.currentSpeakingId == card.id &&
                                    com.knowflick.app.ui.SpeechController.isSpeakingState,
                                onToggleFavorite = {
                                    viewModel.mutate { viewModel.model.store.toggleFavorite(card) }
                                },
                                onToggleSpeech = {
                                    viewModel.mutate {
                                        com.knowflick.app.ui.SpeechController.toggle(this@MainActivity, card)
                                    }
                                },
                                onBack = { screen = Screen.DECK },
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
                        onBack = { screen = Screen.DECK },
                        onTestConnection = { temp, key -> viewModel.testConnection(temp, key) },
                        onSave = { updated, key -> viewModel.saveSettings(updated, key) },
                    )
                    Screen.LIBRARY -> com.knowflick.app.ui.LibraryScreen(
                        cards = viewModel.model.store.cards,
                        version = viewModel.version,
                        onOpenDetail = { card ->
                            detailCard = card
                            screen = Screen.DETAIL
                        },
                        onBack = { screen = Screen.DECK },
                        onShareText = { text, title -> shareText(text, title) },
                        onPickImportFile = { importFilePicker.launch(arrayOf("application/json", "text/*")) },
                    )
                }
            }
        }
    }

    private fun shareText(text: String, title: String) {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
            putExtra(Intent.EXTRA_TITLE, title)
        }
        startActivity(Intent.createChooser(intent, title))
    }

    override fun onPause() {
        super.onPause()
        viewModel.flushNow()
    }
}
