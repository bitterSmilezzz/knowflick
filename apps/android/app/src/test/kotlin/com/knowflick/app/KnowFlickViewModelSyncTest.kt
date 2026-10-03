package com.knowflick.app

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import com.knowflick.app.data.CardStorage
import com.knowflick.app.domain.Tombstone
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** VM 装配点（SYNC_PROTOCOL.md §4）：启动时从持久化层灌入墓碑表，合并写回走 CardStorage */
@Config(sdk = [35])
@RunWith(RobolectricTestRunner::class)
class KnowFlickViewModelSyncTest {

    private val application: Application = ApplicationProvider.getApplicationContext()
    private val storeDir: File get() = File(application.filesDir, "store")

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
}
