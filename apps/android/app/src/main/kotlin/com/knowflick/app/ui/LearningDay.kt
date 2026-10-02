package com.knowflick.app.ui

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import java.time.Duration
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import kotlinx.coroutines.delay

internal data class LearningDay(val date: LocalDate, val zone: ZoneId)

/** A date snapshot refreshed at midnight, clock changes and foreground return. */
@Composable
internal fun rememberLearningDay(): LearningDay {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    fun currentDay(): LearningDay {
        val zone = ZoneId.systemDefault()
        return LearningDay(LocalDate.now(zone), zone)
    }
    var day by remember { mutableStateOf(currentDay()) }
    var revision by remember { mutableIntStateOf(0) }
    DisposableEffect(context, lifecycle) {
        fun refresh() { day = currentDay(); revision++ }
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) { refresh() }
        }
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_DATE_CHANGED)
            addAction(Intent.ACTION_TIME_CHANGED)
            addAction(Intent.ACTION_TIMEZONE_CHANGED)
        }
        ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) refresh()
        }
        lifecycle.addObserver(observer)
        onDispose { context.unregisterReceiver(receiver); lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(revision) {
        while (true) {
            val now = ZonedDateTime.now()
            val tomorrow = now.toLocalDate().plusDays(1).atStartOfDay(now.zone)
            delay(Duration.between(now, tomorrow).toMillis().coerceAtLeast(1))
            day = currentDay()
        }
    }
    return day
}
