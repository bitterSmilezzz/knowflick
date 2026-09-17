package com.knowflick.app.widget

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import com.knowflick.app.data.CardStorage
import java.io.File
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@Config(sdk = [35])
@RunWith(RobolectricTestRunner::class)
class WidgetCardRepositoryTest {

    private lateinit var app: Application

    @BeforeTest
    fun setUp() {
        app = ApplicationProvider.getApplicationContext()
        // 清空测试目录与 SharedPreferences
        File(app.filesDir, "store").deleteRecursively()
        app.getSharedPreferences("widget_daily_card_prefs", Application.MODE_PRIVATE).edit().clear().commit()
    }

    @Test
    fun getAvailableCardsLoadsFromSeedWhenEmpty() {
        val cards = WidgetCardRepository.getAvailableCards(app)
        assertTrue(cards.isNotEmpty(), "空库时应从种子资产中加载卡片")
        assertEquals(214, cards.size)
    }

    @Test
    fun getCurrentCardReturnsFirstCardInitially() {
        val card = WidgetCardRepository.getCurrentCard(app)
        assertNotNull(card)
        assertTrue(card.headline.isNotBlank())
    }

    @Test
    fun nextCardCyclesThroughAvailableCards() {
        val card1 = WidgetCardRepository.getCurrentCard(app)
        assertNotNull(card1)

        val card2 = WidgetCardRepository.nextCard(app)
        assertNotNull(card2)
        assertNotEquals(card1.id, card2.id, "下一张卡片应与当前卡片不同")

        val current = WidgetCardRepository.getCurrentCard(app)
        assertEquals(card2.id, current?.id, "getCurrentCard 应返回切换后的卡片")
    }

    @Test
    fun previousCardStepsBackCorrectly() {
        val initial = WidgetCardRepository.getCurrentCard(app)
        assertNotNull(initial)

        val next = WidgetCardRepository.nextCard(app)
        assertNotNull(next)
        assertNotEquals(initial.id, next.id)

        val back = WidgetCardRepository.previousCard(app)
        assertNotNull(back)
        assertEquals(initial.id, back.id, "上一张卡片应返回原卡片")
    }

    @Test
    fun toggleFavoritePersistsToStorage() {
        val card = WidgetCardRepository.getCurrentCard(app)
        assertNotNull(card)
        val initialFavorite = card.isFavorite

        val updated = WidgetCardRepository.toggleFavorite(app)
        assertNotNull(updated)
        assertEquals(!initialFavorite, updated.isFavorite, "收藏状态应取反")

        // 验证持久化到了 CardStorage
        val storage = CardStorage(File(app.filesDir, "store"))
        val storedCards = storage.loadCards()
        val storedCard = storedCards.firstOrNull { it.id == card.id }
        assertNotNull(storedCard)
        assertEquals(!initialFavorite, storedCard.isFavorite, "CardStorage 中的卡片收藏状态也必须同步更新")
    }

    @Test
    fun widgetBitmapHelperLoadsAndTintsBackground() {
        val bitmap = WidgetBitmapHelper.loadWidgetBackground(app, "tech", 360, 240)
        assertNotNull(bitmap, "微件底图位图应能正确从 assets 解码并合成渐变")
        assertEquals(360, bitmap.width)
        assertEquals(240, bitmap.height)
    }
}
