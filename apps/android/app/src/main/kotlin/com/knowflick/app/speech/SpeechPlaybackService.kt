package com.knowflick.app.speech

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.knowflick.app.MainActivity
import com.knowflick.app.R
import com.knowflick.app.domain.KnowledgeCard

/**
 * 知识卡片语音后台朗读与锁屏媒体播控服务：
 * 1. 采用 Android 原生 [MediaSession] 与 [Notification.MediaStyle]；
 * 2. 支持锁屏、控制中心与蓝牙外设展示正在朗读的卡片标题、分类与播放进度；
 * 3. 响应播放、暂停、上一张、下一张与停止控制；
 * 4. 声明前台服务类型 mediaPlayback，保障后台与熄屏播放稳定不被系统清理。
 */
class SpeechPlaybackService : Service() {

    private var mediaSession: MediaSession? = null
    private var notificationManager: NotificationManager? = null

    override fun onCreate() {
        super.onCreate()
        notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        createNotificationChannel()
        initMediaSession()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "知识朗读播控",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "正在朗读的知识卡片播控通知与锁屏控制台"
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            notificationManager?.createNotificationChannel(channel)
        }
    }

    private fun initMediaSession() {
        mediaSession = MediaSession(this, "KnowFlickSpeech").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() {
                    activeController?.resume()
                }

                override fun onPause() {
                    activeController?.pause()
                }

                override fun onSkipToNext() {
                    activeController?.advanceNext()
                }

                override fun onSkipToPrevious() {
                    activeController?.advancePrevious()
                }

                override fun onStop() {
                    activeController?.stop()
                }

                override fun onSeekTo(pos: Long) {
                    val duration = activeController?.durationMs ?: 0L
                    if (duration > 0) {
                        val progress = (pos.toFloat() / duration).coerceIn(0f, 1f)
                        activeController?.seekToProgress(progress)
                    }
                }
            })
            isActive = true
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        when (action) {
            ACTION_UPDATE -> updateState(
                headline = intent.getStringExtra(EXTRA_HEADLINE) ?: "正在朗读知识卡片",
                category = intent.getStringExtra(EXTRA_CATEGORY) ?: "KnowFlick",
                cardId = intent.getStringExtra(EXTRA_CARD_ID),
                isPlaying = intent.getBooleanExtra(EXTRA_IS_PLAYING, true),
                isAmbientMode = intent.getBooleanExtra(EXTRA_IS_AMBIENT, false),
                positionMs = intent.getLongExtra(EXTRA_POSITION_MS, 0L),
                durationMs = intent.getLongExtra(EXTRA_DURATION_MS, 0L),
            )
            ACTION_TOGGLE -> {
                if (activeController?.isSpeaking == true) {
                    if (activeController?.isPaused == true) activeController?.resume() else activeController?.pause()
                }
            }
            ACTION_NEXT -> activeController?.advanceNext()
            ACTION_PREV -> activeController?.advancePrevious()
            ACTION_STOP -> {
                activeController?.stop()
                stopForegroundInternal()
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    private fun updateState(
        headline: String,
        category: String,
        cardId: String?,
        isPlaying: Boolean,
        isAmbientMode: Boolean,
        positionMs: Long,
        durationMs: Long,
    ) {
        val session = mediaSession ?: return

        // 1. 更新 MediaSession 元数据
        val metadata = MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, headline)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, category)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, if (isAmbientMode) "KnowFlick · 磨耳朵连播" else "KnowFlick · 知识朗读")
            .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs.coerceAtLeast(0L))
            .build()
        session.setMetadata(metadata)

        // 2. 更新 PlaybackState
        val stateActions = PlaybackState.ACTION_PLAY or
            PlaybackState.ACTION_PAUSE or
            PlaybackState.ACTION_STOP or
            PlaybackState.ACTION_SEEK_TO or
            (if (isAmbientMode) PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS else 0L)

        val state = if (isPlaying) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED
        val playbackState = PlaybackState.Builder()
            .setActions(stateActions)
            .setState(state, positionMs, 1.0f)
            .build()
        session.setPlaybackState(playbackState)

        // 3. 构建媒体样式通知
        val notification = buildNotification(headline, category, cardId, isPlaying, isAmbientMode)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (_: Exception) {
            // Android 13+ 权限或系统限制保护
        }
    }

    private fun buildNotification(
        headline: String,
        category: String,
        cardId: String?,
        isPlaying: Boolean,
        isAmbientMode: Boolean,
    ): Notification {
        val clickIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            cardId?.let { putExtra("open_card_id", it) }
        }
        val contentPendingIntent = PendingIntent.getActivity(
            this,
            0,
            clickIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        // 播控动作 PendingIntents
        val toggleIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, SpeechPlaybackService::class.java).apply { action = ACTION_TOGGLE },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val prevIntent = PendingIntent.getService(
            this,
            2,
            Intent(this, SpeechPlaybackService::class.java).apply { action = ACTION_PREV },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val nextIntent = PendingIntent.getService(
            this,
            3,
            Intent(this, SpeechPlaybackService::class.java).apply { action = ACTION_NEXT },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val stopIntent = PendingIntent.getService(
            this,
            4,
            Intent(this, SpeechPlaybackService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val playPauseIcon = if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
        val playPauseTitle = if (isPlaying) "暂停" else "播放"

        val builder = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle(headline)
            .setContentText(category)
            .setSubText(if (isAmbientMode) "磨耳朵连续朗读" else "知识朗读")
            .setSmallIcon(android.R.drawable.stat_sys_headset)
            .setContentIntent(contentPendingIntent)
            .setDeleteIntent(stopIntent)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(isPlaying)

        if (isAmbientMode) {
            builder.addAction(
                Notification.Action.Builder(
                    android.graphics.drawable.Icon.createWithResource(this, android.R.drawable.ic_media_previous),
                    "上一张",
                    prevIntent,
                ).build(),
            )
            builder.addAction(
                Notification.Action.Builder(
                    android.graphics.drawable.Icon.createWithResource(this, playPauseIcon),
                    playPauseTitle,
                    toggleIntent,
                ).build(),
            )
            builder.addAction(
                Notification.Action.Builder(
                    android.graphics.drawable.Icon.createWithResource(this, android.R.drawable.ic_media_next),
                    "下一张",
                    nextIntent,
                ).build(),
            )
        } else {
            builder.addAction(
                Notification.Action.Builder(
                    android.graphics.drawable.Icon.createWithResource(this, playPauseIcon),
                    playPauseTitle,
                    toggleIntent,
                ).build(),
            )
            builder.addAction(
                Notification.Action.Builder(
                    android.graphics.drawable.Icon.createWithResource(this, android.R.drawable.ic_menu_close_clear_cancel),
                    "关闭",
                    stopIntent,
                ).build(),
            )
        }

        val sessionToken = mediaSession?.sessionToken
        if (sessionToken != null) {
            val mediaStyle = Notification.MediaStyle()
                .setMediaSession(sessionToken)
            if (isAmbientMode) {
                mediaStyle.setShowActionsInCompactView(0, 1, 2)
            } else {
                mediaStyle.setShowActionsInCompactView(0, 1)
            }
            builder.style = mediaStyle
        }

        return builder.build()
    }

    private fun stopForegroundInternal() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
    }

    override fun onDestroy() {
        mediaSession?.release()
        mediaSession = null
        stopForegroundInternal()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val CHANNEL_ID = "knowflick_speech_playback"
        const val NOTIFICATION_ID = 2026

        const val ACTION_UPDATE = "com.knowflick.app.speech.ACTION_UPDATE"
        const val ACTION_TOGGLE = "com.knowflick.app.speech.ACTION_TOGGLE"
        const val ACTION_NEXT = "com.knowflick.app.speech.ACTION_NEXT"
        const val ACTION_PREV = "com.knowflick.app.speech.ACTION_PREV"
        const val ACTION_STOP = "com.knowflick.app.speech.ACTION_STOP"

        const val EXTRA_HEADLINE = "extra_headline"
        const val EXTRA_CATEGORY = "extra_category"
        const val EXTRA_CARD_ID = "extra_card_id"
        const val EXTRA_IS_PLAYING = "extra_is_playing"
        const val EXTRA_IS_AMBIENT = "extra_is_ambient"
        const val EXTRA_POSITION_MS = "extra_position_ms"
        const val EXTRA_DURATION_MS = "extra_duration_ms"

        /** 全局当前活跃的控制器弱引用，供系统媒体会话按键直接操作 */
        var activeController: SpeechController? = null

        fun updateService(
            context: Context,
            card: KnowledgeCard?,
            isPlaying: Boolean,
            isAmbientMode: Boolean,
            positionMs: Long = 0L,
            durationMs: Long = 0L,
        ) {
            val intent = Intent(context, SpeechPlaybackService::class.java).apply {
                action = ACTION_UPDATE
                putExtra(EXTRA_HEADLINE, card?.headline ?: "正在朗读知识卡片")
                putExtra(EXTRA_CATEGORY, card?.category ?: "KnowFlick")
                putExtra(EXTRA_CARD_ID, card?.id)
                putExtra(EXTRA_IS_PLAYING, isPlaying)
                putExtra(EXTRA_IS_AMBIENT, isAmbientMode)
                putExtra(EXTRA_POSITION_MS, positionMs)
                putExtra(EXTRA_DURATION_MS, durationMs)
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (_: Exception) {
                // 忽略后台启动异常
            }
        }

        fun stopService(context: Context) {
            try {
                val intent = Intent(context, SpeechPlaybackService::class.java).apply {
                    action = ACTION_STOP
                }
                context.startService(intent)
            } catch (_: Exception) {
            }
        }
    }
}
