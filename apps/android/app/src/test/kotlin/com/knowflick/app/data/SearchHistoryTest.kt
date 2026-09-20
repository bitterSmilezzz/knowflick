package com.knowflick.app.data

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import com.knowflick.app.KnowFlickViewModel
import java.io.File
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@Config(sdk = [35])
@RunWith(RobolectricTestRunner::class)
class SearchHistoryTest {

    private val baseDir = File(System.getProperty("java.io.tmpdir"), "knowflick-search-test-" + System.nanoTime())
    private val storage = CardStorage(baseDir)
    private val application: Application = ApplicationProvider.getApplicationContext()

    @AfterTest
    fun cleanup() {
        baseDir.deleteRecursively()
    }

    @Test
    fun cardStorage_searchHistoryRoundTrip() {
        val history = listOf("量子力学", "中子星", "相对论")
        storage.saveSearchHistory(history)

        val loaded = storage.loadSearchHistory()
        assertEquals(history, loaded)
    }

    @Test
    fun cardStorage_nonExistentHistoryYieldsEmptyList() {
        val loaded = storage.loadSearchHistory()
        assertTrue(loaded.isEmpty())
    }

    @Test
    fun cardStorage_corruptedHistoryYieldsEmptyList() {
        val file = File(baseDir, "search_history.json")
        file.parentFile?.mkdirs()
        file.writeText("{ not a valid json array }")

        val loaded = storage.loadSearchHistory()
        assertTrue(loaded.isEmpty())
    }

    @Test
    fun viewModel_addSearchHistory_placesOnTopAndDeduplicates() {
        val vm = KnowFlickViewModel(application)
        vm.clearSearchHistory()

        vm.addSearchHistory("引力波")
        vm.addSearchHistory("量子力学")
        assertEquals(listOf("量子力学", "引力波"), vm.searchHistory)

        // 再次添加已存在的词，应移到最前面
        vm.addSearchHistory("引力波")
        assertEquals(listOf("引力波", "量子力学"), vm.searchHistory)
    }

    @Test
    fun viewModel_addSearchHistory_capsAtEightItems() {
        val vm = KnowFlickViewModel(application)
        vm.clearSearchHistory()

        for (i in 1..10) {
            vm.addSearchHistory("关键词 $i")
        }

        assertEquals(8, vm.searchHistory.size)
        // 最近加入的 "关键词 10" 应在首位，"关键词 3" 应在末位
        assertEquals("关键词 10", vm.searchHistory.first())
        assertEquals("关键词 3", vm.searchHistory.last())
        assertFalse(vm.searchHistory.contains("关键词 1"))
        assertFalse(vm.searchHistory.contains("关键词 2"))
    }

    @Test
    fun viewModel_addSearchHistory_ignoresBlank() {
        val vm = KnowFlickViewModel(application)
        vm.clearSearchHistory()

        vm.addSearchHistory("  ")
        vm.addSearchHistory("")
        assertTrue(vm.searchHistory.isEmpty())
    }

    @Test
    fun viewModel_removeAndClearSearchHistory() {
        val vm = KnowFlickViewModel(application)
        vm.clearSearchHistory()

        vm.addSearchHistory("词 A")
        vm.addSearchHistory("词 B")
        vm.addSearchHistory("词 C")
        assertEquals(listOf("词 C", "词 B", "词 A"), vm.searchHistory)

        vm.removeSearchHistory("词 B")
        assertEquals(listOf("词 C", "词 A"), vm.searchHistory)

        vm.clearSearchHistory()
        assertTrue(vm.searchHistory.isEmpty())
    }
}
