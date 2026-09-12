package com.knowflick.app

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.knowflick.app.data.AppModel
import com.knowflick.app.data.CardStorage
import com.knowflick.app.data.SeedLoader
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * 应用级状态持有者：卡库持久化 + 卡堆状态机 + 重组触发器。
 * 每次意图操作后 version 自增驱动 Compose 重组；落盘经 IO 调度器节流合并。
 */
class KnowFlickViewModel(application: Application) : AndroidViewModel(application) {
    val model: AppModel = AppModel(
        storage = CardStorage(File(application.filesDir, "store")),
        seedCards = SeedLoader(application).load(),
    )

    /** 重组触发器：store 为普通类，操作后递增使 Compose 重新读取派生状态 */
    var version by mutableIntStateOf(0)
        private set

    private var persistScheduled = false

    init {
        model.bootstrap()
    }

    fun mutate(action: () -> Unit) {
        action()
        version++
        schedulePersist()
    }

    private fun schedulePersist() {
        if (persistScheduled) return
        persistScheduled = true
        viewModelScope.launch(Dispatchers.IO) {
            Thread.sleep(350)   // 与 macOS 端 350ms 节流合并口径一致
            persistScheduled = false
            model.persistNow()
        }
    }

    fun flushNow() {
        model.persistNow()
    }
}
