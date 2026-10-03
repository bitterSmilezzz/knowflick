package com.knowflick.app.widget

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * 进程级微件→应用事件通道（A5 残留收口）。
 *
 * 微件 toggleFavorite 经 [com.knowflick.app.data.CardStorage.shared] 落库后，App 的内存态
 * （CardStore）并不知情，其后续整库持久化会把磁盘上的微件改动反向覆盖。此总线在落库成功后
 * 发射被改动的卡片 id，由 KnowFlickViewModel 收集并按 id 重读磁盘、更新内存 store。
 *
 * - VM 不在（进程仅因微件存活）时没有收集者，发射被丢弃——磁盘态即真相，行为正确；
 * - 缓冲 64 条 + DROP_OLDEST：收集者短暂忙碌时事件不丢，极端积压只保最新。
 */
object WidgetSyncBus {

    private val _favoriteChanges = MutableSharedFlow<String>(
        extraBufferCapacity = 64,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )

    /** 被微件改动的卡片 id 流（当前只有收藏翻转） */
    val favoriteChanges: SharedFlow<String> = _favoriteChanges.asSharedFlow()

    /** 落库成功后由微件仓储调用；无收集者时安全丢弃 */
    fun emitFavoriteChanged(cardId: String) {
        _favoriteChanges.tryEmit(cardId)
    }
}
