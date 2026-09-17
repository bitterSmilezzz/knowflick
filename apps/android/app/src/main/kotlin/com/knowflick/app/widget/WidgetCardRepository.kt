package com.knowflick.app.widget

import android.content.Context
import androidx.glance.appwidget.updateAll
import com.knowflick.app.data.CardStorage
import com.knowflick.app.data.SeedLoader
import com.knowflick.app.domain.KnowledgeCard
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * 桌面微件独立数据仓储：负责微件卡片数据获取、换卡循环、收藏状态切换与广播刷新。
 * 兼容应用后台被杀或独立桌面进程调用。
 */
object WidgetCardRepository {

    private const val PREFS_NAME = "widget_daily_card_prefs"
    private const val KEY_CURRENT_CARD_ID = "current_card_id"

    /** 获取当前可用卡片列表（优先卡库存储，空库时自动加载预置种子） */
    fun getAvailableCards(context: Context): List<KnowledgeCard> {
        val storage = CardStorage(File(context.filesDir, "store"))
        val loaded = storage.loadCards()
        if (loaded.isNotEmpty()) {
            return loaded
        }
        val seed = SeedLoader(context).load()
        if (seed.isNotEmpty()) {
            storage.saveCards(seed)
            return seed
        }
        return emptyList()
    }

    /** 获取微件当前展示的卡片 */
    fun getCurrentCard(context: Context): KnowledgeCard? {
        val cards = getAvailableCards(context)
        if (cards.isEmpty()) return null

        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val savedId = prefs.getString(KEY_CURRENT_CARD_ID, null)

        val found = if (savedId != null) cards.firstOrNull { it.id == savedId } else null
        if (found != null) return found

        val initial = cards.first()
        prefs.edit().putString(KEY_CURRENT_CARD_ID, initial.id).apply()
        return initial
    }

    /** 桌面微件切至下一张卡片 */
    fun nextCard(context: Context): KnowledgeCard? {
        val cards = getAvailableCards(context)
        if (cards.isEmpty()) return null

        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val currentId = prefs.getString(KEY_CURRENT_CARD_ID, null)
        val currentIndex = cards.indexOfFirst { it.id == currentId }

        val nextIndex = if (currentIndex in cards.indices) {
            (currentIndex + 1) % cards.size
        } else {
            0
        }

        val nextCard = cards[nextIndex]
        prefs.edit().putString(KEY_CURRENT_CARD_ID, nextCard.id).apply()
        return nextCard
    }

    /** 桌面微件切至上一张卡片 */
    fun previousCard(context: Context): KnowledgeCard? {
        val cards = getAvailableCards(context)
        if (cards.isEmpty()) return null

        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val currentId = prefs.getString(KEY_CURRENT_CARD_ID, null)
        val currentIndex = cards.indexOfFirst { it.id == currentId }

        val prevIndex = if (currentIndex in cards.indices) {
            (currentIndex - 1 + cards.size) % cards.size
        } else {
            0
        }

        val prevCard = cards[prevIndex]
        prefs.edit().putString(KEY_CURRENT_CARD_ID, prevCard.id).apply()
        return prevCard
    }

    /** 桌面微件切换当前卡片收藏状态，并原子写回 CardStorage */
    fun toggleFavorite(context: Context): KnowledgeCard? {
        val current = getCurrentCard(context) ?: return null
        val storage = CardStorage(File(context.filesDir, "store"))
        val allCards = getAvailableCards(context).toMutableList()
        val index = allCards.indexOfFirst { it.id == current.id }
        if (index == -1) return current

        val updated = current.copy(
            isFavorite = !current.isFavorite,
            favoritedAt = if (!current.isFavorite) System.currentTimeMillis() else null,
        )
        allCards[index] = updated
        storage.saveCards(allCards)
        return updated
    }

    /** 设定当前展示卡片 ID */
    fun setCurrentCardId(context: Context, cardId: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_CURRENT_CARD_ID, cardId).apply()
    }

    /** 异步触发所有桌面微件更新 */
    fun notifyWidgetUpdate(context: Context) {
        val appContext = context.applicationContext
        CoroutineScope(Dispatchers.IO).launch {
            try {
                DailyCardGlanceWidget().updateAll(appContext)
            } catch (_: Throwable) {
                // 微件可能尚未放置或桌面未就绪，静默忽略
            }
        }
    }
}
