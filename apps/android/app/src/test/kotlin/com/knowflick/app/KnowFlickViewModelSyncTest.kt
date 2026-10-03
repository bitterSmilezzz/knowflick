package com.knowflick.app

import android.app.Application
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import com.knowflick.app.data.CardStorage
import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.Tombstone
import com.knowflick.app.widget.WidgetCardRepository
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** VM 装配点（SYNC_PROTOCOL.md §4）：启动时从持久化层灌入墓碑表，合并写回走 CardStorage；
 *  A5：微件落库事件回灌内存 store */
@Config(sdk = [35])
@RunWith(RobolectricTestRunner::class)
class KnowFlickViewModelSyncTest {

    private val application: Application = ApplicationProvider.getApplicationContext()
    private val storeDir: File get() = File(application.filesDir, "store")

    private fun makeCard(id: String, headline: String) =
        KnowledgeCard.create("学习", headline, "摘要", "正文", source = CardSource.IMPORTED).copy(id = id)

    @Test
    fun bootstrapLoadsPersistedTombstonesIntoStore() {
        storeDir.deleteRecursively()
        val storage = CardStorage.shared(storeDir)
        val tombstones = listOf(Tombstone("dead-1", 1_727_900_001_000L))
        assertTrue(storage.saveTombstones(tombstones), "墓碑表预写失败")

        val vm = KnowFlickViewModel(application)
        assertEquals(tombstones, vm.model.store.tombstones)
        storeDir.deleteRecursively()
    }

    @Test
    fun A5_widgetFavoriteToggleReplaysIntoAppMemoryStore() {
        storeDir.deleteRecursively()
        val card = makeCard("bus-vm-1", "回灌卡")
        CardStorage.shared(storeDir).saveCards(listOf(card))
        WidgetCardRepository.setCurrentCardId(application, "bus-vm-1")

        val vm = KnowFlickViewModel(application)
        val before = vm.model.store.cards.single { it.id == "bus-vm-1" }.isFavorite

        // 微件翻转（磁盘态已变）→ 总线事件 → VM 回灌内存态
        val updated = WidgetCardRepository.toggleFavorite(application)
        assertNotNull(updated)

        val looper = shadowOf(Looper.getMainLooper())
        var flipped = false
        var attempts = 0
        while (attempts < 100 && !flipped) {
            looper.idle()
            val now = vm.model.store.cards.firstOrNull { it.id == "bus-vm-1" }
            flipped = now != null && now.isFavorite == !before
            if (!flipped) {
                Thread.sleep(20)
                attempts++
            }
        }
        assertTrue(flipped, "微件收藏翻转必须在时限内回灌 App 内存 store")
        storeDir.deleteRecursively()
    }
}

