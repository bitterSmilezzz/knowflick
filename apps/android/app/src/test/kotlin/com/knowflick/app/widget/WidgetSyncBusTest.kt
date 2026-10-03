package com.knowflick.app.widget

import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** A5：进程级微件→应用事件通道 */
class WidgetSyncBusTest {

    @Test
    fun subscriberReceivesEmittedCardIds() = runTest {
        val received = mutableListOf<String>()
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            WidgetSyncBus.favoriteChanges.collect { received += it }
        }

        WidgetSyncBus.emitFavoriteChanged("card-a")
        WidgetSyncBus.emitFavoriteChanged("card-b")
        runCurrent()

        job.cancel()
        assertEquals(listOf("card-a", "card-b"), received)
    }

    @Test
    fun emitWithoutSubscriberIsSafe() {
        // VM 不在时无收集者：发射必须安全丢弃（磁盘态即真相），不得抛错
        WidgetSyncBus.emitFavoriteChanged("nobody-listening")
        assertTrue(true)
    }
}
