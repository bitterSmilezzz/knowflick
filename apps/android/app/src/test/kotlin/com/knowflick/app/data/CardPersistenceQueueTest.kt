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

    @Test
    fun B8_flushConfirmsAfterWriteCompletes() {
        val completed = CountDownLatch(1)
        val queue = CardPersistenceQueue(
            save = { CardSaveResult.Saved },
            onResult = { completed.countDown() },
        )

        assertTrue(queue.flush(listOf(card("同步落库"))), "快盘写入应在时限内确认落盘")
        assertTrue(completed.await(2, TimeUnit.SECONDS))
        queue.closeAfter(emptyList())
    }

    @Test
    fun B8_flushWaitsBoundedOnSlowDiskAndKeepsOrder() {
        val written = mutableListOf<String>()
        val firstBlocked = CountDownLatch(1)
        val release = CountDownLatch(1)
        val flushWriteDone = CountDownLatch(1)
        var writes = 0
        val queue = CardPersistenceQueue(
            save = { cards ->
                synchronized(written) { written += cards.single().headline }
                writes++
                when (writes) {
                    1 -> {
                        firstBlocked.countDown()
                        release.await(5, TimeUnit.SECONDS)
                    }
                    else -> flushWriteDone.countDown()
                }
                CardSaveResult.Saved
            },
        )

        // 先占住队列的慢写入，再 flush：必须排在慢写入之后（串行序），且有界等待不长时间阻塞
        assertTrue(queue.enqueue(listOf(card("慢写入"))))
        assertTrue(firstBlocked.await(2, TimeUnit.SECONDS))

        val started = System.nanoTime()
        val confirmed = queue.flush(listOf(card("同步落库")))
        val elapsedMs = (System.nanoTime() - started) / 1_000_000

        assertTrue(!confirmed, "慢盘超时不得谎报已确认落盘")
        assertTrue(elapsedMs < 2_000, "有界等待不应长时间阻塞调用方，实际 ${elapsedMs}ms")

        release.countDown()
        assertTrue(flushWriteDone.await(2, TimeUnit.SECONDS))
        assertEquals(listOf("慢写入", "同步落库"), synchronized(written) { written.toList() }, "flush 必须排在既有写入之后")
        queue.closeAfter(emptyList())
    }
}
