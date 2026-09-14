package com.knowflick.app.data

import com.knowflick.app.domain.KnowledgeCard
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/** 串行、非阻塞的卡库写入队列；后提交的快照一定在旧快照之后落盘。 */
internal class CardPersistenceQueue(
    private val save: (List<KnowledgeCard>) -> CardSaveResult,
    private val onResult: (CardSaveResult) -> Unit = {},
    private val executor: ExecutorService = Executors.newSingleThreadExecutor(),
) {
    private val lock = Any()
    private var accepting = true

    constructor(storage: CardStorage, onResult: (CardSaveResult) -> Unit = {}) :
        this(storage::saveCards, onResult)

    /** 只排队，不等待磁盘；用于交互操作和 Activity 生命周期回调。 */
    fun enqueue(snapshot: List<KnowledgeCard>): Boolean = synchronized(lock) {
        if (!accepting) return false
        return try {
            val immutableSnapshot = snapshot.toList()
            executor.execute { onResult(save(immutableSnapshot)) }
            true
        } catch (_: RejectedExecutionException) {
            false
        }
    }

    /**
     * 排队并在写入完成后回调；供 onPause 等生命周期收尾使用，
     * 让调用方可以（有限地）等待最后一批改动真正落盘。
     */
    fun enqueueAndWait(snapshot: List<KnowledgeCard>, onFinished: () -> Unit): Boolean = synchronized(lock) {
        if (!accepting) return false
        return try {
            val immutableSnapshot = snapshot.toList()
            executor.execute {
                try {
                    onResult(save(immutableSnapshot))
                } finally {
                    onFinished()
                }
            }
            true
        } catch (_: RejectedExecutionException) {
            false
        }
    }

    /** ViewModel 清理时追加最后快照，再让执行器自然排空并退出。 */
    fun closeAfter(snapshot: List<KnowledgeCard>) = synchronized(lock) {
        if (!accepting) return
        accepting = false
        val immutableSnapshot = snapshot.toList()
        try {
            executor.execute { save(immutableSnapshot) }
        } catch (_: RejectedExecutionException) {
            // 执行器已经关闭时没有可恢复的本地任务；此前入队的写入仍会完成。
        }
        executor.shutdown()
    }
}
