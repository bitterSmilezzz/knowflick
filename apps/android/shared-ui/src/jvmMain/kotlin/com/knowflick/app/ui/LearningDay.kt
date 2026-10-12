package com.knowflick.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.delay

/** 轮询间隔：桌面没有日期变更广播，30 秒检查一次日期是否翻页，代价可忽略。 */
private const val POLL_INTERVAL_MS = 30_000L

/**
 * 桌面实现：轮询「今天」。桌面上改系统时钟/时区、或程序跨夜长开，都能在下一次轮询时纠正。
 * 比 Android 的广播实现简单，但对桌面是够用的——真实差异（睡眠唤醒）也只是最多晚 30 秒。
 */
@Composable
internal actual fun rememberLearningDay(): LearningDay {
    fun currentDay(): LearningDay {
        val zone = ZoneId.systemDefault()
        return LearningDay(LocalDate.now(zone), zone)
    }

    var day by remember { mutableStateOf(currentDay()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(POLL_INTERVAL_MS)
            val now = currentDay()
            if (now.date != day.date || now.zone != day.zone) day = now
        }
    }
    return day
}
