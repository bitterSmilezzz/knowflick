package com.knowflick.app.ui

import androidx.compose.runtime.Composable
import java.time.LocalDate
import java.time.ZoneId

/** 日期快照（含时区）：跨午夜 / 改系统时钟 / 换时区 / 回到前台后需要刷新 */
internal data class LearningDay(val date: LocalDate, val zone: ZoneId)

/**
 * 取「今天」的快照。**平台差异只在「怎么知道日期变了」**：
 * - Android（androidMain）：监听 `ACTION_DATE_CHANGED` / `TIME_CHANGED` / `TIMEZONE_CHANGED` 系统广播，
 *   外加生命周期回到前台时刷新一次；
 * - 桌面（jvmMain）：没有这类广播，改成轮询（间隔见实现，代价可忽略）。
 *
 * 共享界面只调这个函数，不碰 `BroadcastReceiver` / `Lifecycle`——按第一原则，
 * 平台边界收进 expect/actual，界面不各自实现「今天是怎么变的」。
 */
@Composable
internal expect fun rememberLearningDay(): LearningDay
