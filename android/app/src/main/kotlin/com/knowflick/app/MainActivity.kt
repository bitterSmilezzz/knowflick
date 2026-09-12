package com.knowflick.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.ui.DeckScreen
import com.knowflick.app.ui.DetailScreen
import com.knowflick.app.ui.KnowFlickTheme
import com.knowflick.app.ui.StatsScreen

/** 应用入口：三个顶层屏幕（卡堆 / 详情 / 统计）；收藏阁与历史在 M4 接入 */
class MainActivity : ComponentActivity() {

    private enum class Screen { DECK, DETAIL, STATS, SETTINGS }

    private val viewModel: KnowFlickViewModel by viewModels()

    private var screen by mutableStateOf(Screen.DECK)
    private var detailCard by mutableStateOf<KnowledgeCard?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            KnowFlickTheme {
                when (screen) {
                    Screen.DECK -> DeckScreen(
                        store = viewModel.model.store,
                        version = viewModel.version,
                        showAIMark = true,
                        onOpenDetail = { card ->
                            detailCard = card
                            screen = Screen.DETAIL
                        },
                        onOpenStats = { screen = Screen.STATS },
                        onOpenFavorites = { screen = Screen.STATS },   // 收藏阁在 M5 接入
                        onOpenSettings = { screen = Screen.SETTINGS },
                        isGenerating = viewModel.isGenerating,
                        notice = viewModel.generateNotice,
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
                                showAIMark = true,
                                onToggleFavorite = {
                                    viewModel.mutate { viewModel.model.store.toggleFavorite(card) }
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
                }
            }
        }
    }

    override fun onPause() {
        super.onPause()
        viewModel.flushNow()
    }
}
