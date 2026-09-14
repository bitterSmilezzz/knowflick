package com.knowflick.app.data

import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class CardPersistenceQueueTest {
    private fun card(headline: String) =
        KnowledgeCard.create("测试", headline, "摘要", "正文", source = CardSource.IMPORTED)

    @Test
    fun enqueueReturnsWithoutWaitingForSlowDisk() {
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val completed = CountDownLatch(1)
        val queue = CardPersistenceQueue(
            save = {
                started.countDown()
                release.await(5, TimeUnit.SECONDS)
                CardSaveResult.Saved
            },
            onResult = { completed.countDown() },
        )

        val before = System.nanoTime()
        assertTrue(queue.enqueue(listOf(card("慢盘"))))
        val elapsedMs = (System.nanoTime() - before) / 1_000_000

        assertTrue(elapsedMs < 200, "入队不应等待磁盘，实际 ${elapsedMs}ms")
        assertTrue(started.await(2, TimeUnit.SECONDS))
        release.countDown()
        assertTrue(completed.await(2, TimeUnit.SECONDS))
        queue.closeAfter(emptyList())
    }

    @Test
    fun snapshotsAreWrittenInSubmissionOrder() {
        val written = mutableListOf<String>()
        val completed = CountDownLatch(3)
        val queue = CardPersistenceQueue(
            save = { cards ->
                synchronized(written) { written += cards.single().headline }
                completed.countDown()
                CardSaveResult.Saved
            },
        )

        queue.enqueue(listOf(card("第一版")))
        queue.enqueue(listOf(card("第二版")))
        queue.closeAfter(listOf(card("最终版")))

        assertTrue(completed.await(2, TimeUnit.SECONDS))
        assertEquals(listOf("第一版", "第二版", "最终版"), synchronized(written) { written.toList() })
    }
}
