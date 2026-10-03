package com.knowflick.app.widget

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import com.knowflick.app.data.CardSaveResult
import com.knowflick.app.data.CardStorage
import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
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
    private lateinit var storeDir: File

    @BeforeTest
    fun setUp() {
        app = ApplicationProvider.getApplicationContext()
        // 清空测试目录与 SharedPreferences
        storeDir = File(app.filesDir, "store")
        storeDir.deleteRecursively()
        app.getSharedPreferences("widget_daily_card_prefs", Application.MODE_PRIVATE).edit().clear().commit()
    }

    private fun makeCard(id: String, headline: String) =
        KnowledgeCard.create("学习", headline, "摘要", "正文", source = CardSource.IMPORTED).copy(id = id)

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

        // 验证持久化到了 CardStorage（与应用侧同一共享实例）
        val storage = CardStorage.shared(storeDir)
        val storedCards = storage.loadCards()
        val storedCard = storedCards.firstOrNull { it.id == card.id }
        assertNotNull(storedCard)
        assertEquals(!initialFavorite, storedCard.isFavorite, "CardStorage 中的卡片收藏状态也必须同步更新")
    }

    @Test
    fun A5_toggleFavoriteEmitsCardIdToWidgetSyncBus() = runTest {
        val received = mutableListOf<String>()
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            WidgetSyncBus.favoriteChanges.collect { received += it }
        }

        // 预置已知卡库，避免走种子加载路径
        val card = makeCard("bus-1", "总线卡")
        CardStorage.shared(storeDir).saveCards(listOf(card))
        WidgetCardRepository.setCurrentCardId(app, "bus-1")

        val updated = WidgetCardRepository.toggleFavorite(app)
        assertNotNull(updated, "已知 id 的 toggle 必须成功")
        runCurrent()
        job.cancel()

        assertTrue(
            received.contains("bus-1"),
            "落库成功后必须向 WidgetSyncBus 发射卡片 id，实际：$received",
        )
    }

    @Test
    fun toggleFavoriteRebasesOntoLatestDiskState() {
        // A5 生产路径：App 侧先整库写入收藏变更，微件随后的 toggle 不得把它冲掉
        val appCard = makeCard("app-x", "应用侧卡")
        val widgetCard = makeCard("widget-y", "微件侧卡")
        CardStorage.shared(storeDir).saveCards(listOf(appCard, widgetCard))
        WidgetCardRepository.setCurrentCardId(app, "widget-y")

        // 应用侧持久化队列式写入（app-x 收藏 = true）
        val saveResult = CardStorage.shared(storeDir)
            .saveCards(listOf(appCard.copy(isFavorite = true), widgetCard))
        assertTrue(saveResult is CardSaveResult.Saved)

        val updated = WidgetCardRepository.toggleFavorite(app)
        assertNotNull(updated)
        assertTrue(updated.isFavorite, "微件翻转的是锁内最新基线上的收藏")

        val final = CardStorage.shared(storeDir).loadCards()
        assertTrue(final.first { it.id == "app-x" }.isFavorite, "App 写入的收藏不得被微件写回冲掉")
        assertTrue(final.first { it.id == "widget-y" }.isFavorite, "微件的收藏翻转必须落库")
    }

    @Test
    fun appWriteSurvivesConcurrentWidgetToggleFavorite() {
        // 并发压力：App 线程反复整库写入（x 收藏恒为 true），微件线程反复 toggleFavorite。
        // 共享实例锁 + 锁内重读基线 ⇒ App 的收藏在任何交错下都不会被微件旧快照冲掉；
        // 修复前微件「读-改-写」两段无锁，交错时最终库会出现 x 收藏丢失。
        val appCard = makeCard("app-x", "应用侧卡")
        val widgetCard = makeCard("widget-y", "微件侧卡")
        val storage = CardStorage.shared(storeDir)
        storage.saveCards(listOf(appCard, widgetCard))
        WidgetCardRepository.setCurrentCardId(app, "widget-y")

        val appWriteRounds = 300
        val appDone = CountDownLatch(1)
        val appThread = Thread {
            repeat(appWriteRounds) {
                storage.saveCards(listOf(appCard.copy(isFavorite = true), widgetCard))
            }
            appDone.countDown()
        }
        val widgetThread = Thread {
            repeat(2_000) {
                if (appDone.await(0, TimeUnit.MILLISECONDS)) return@Thread
                WidgetCardRepository.toggleFavorite(app)
            }
        }
        appThread.start()
        widgetThread.start()
        assertTrue(appDone.await(30, TimeUnit.SECONDS))
        widgetThread.join(30_000)
        assertTrue(!widgetThread.isAlive, "微件线程应在时限内结束")

        val final = storage.loadCards()
        assertTrue(
            final.first { it.id == "app-x" }.isFavorite,
            "并发交错后 App 写入的收藏必须存活",
        )
        assertTrue(final.isNotEmpty(), "并发交错后卡库不得损坏")
    }

    @Test
    fun widgetBitmapHelperLoadsAndTintsBackground() {
        val bitmap = WidgetBitmapHelper.loadWidgetBackground(app, "tech", 360, 240)
        assertNotNull(bitmap, "微件底图位图应能正确从 assets 解码并合成渐变")
        assertEquals(360, bitmap.width)
        assertEquals(240, bitmap.height)
    }
}
