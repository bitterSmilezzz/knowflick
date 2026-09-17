package com.knowflick.app.speech

import android.content.Context
import android.media.MediaPlayer
import android.media.PlaybackParams
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.knowflick.app.domain.KnowledgeCard
import java.io.File
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 语音播放控制器：三通道（系统 TTS / 云端 / 本地网关）+ 磨耳朵连续模式 + Mini Player 灵动播控台。
 *
 * 具备以下核心能力：
 * 1. 播放 / 暂停 / 恢复状态机（对齐标准音频播放器规范）；
 * 2. 当前朗读卡片实体（currentCard）、实时进度（playbackProgress）与时长（currentPositionMs / durationMs）；
 * 3. 动态语速（0.75x ~ 2.0x）与语调（0.8x ~ 1.2x）即时生效；
 * 4. 快进 / 快退（±5 秒）与进度条拖拽定位；
 * 5. 磨耳朵模式下上一张 / 下一张切卡；
 * 6. 睡眠定时器（倒计时关停）；
 * 7. 远程通道失败自动回退系统 TTS（与 macOS 口径一致）。
 */
class SpeechController(
    private val context: Context,
    private val remoteClient: RemoteSpeechClient = RemoteSpeechClient(),
) {
    // ---------- 配置 ----------
    var settings: SpeechSettings = SpeechSettings()
        set(value) {
            field = value
            playbackSpeed = value.speed
            playbackPitch = value.pitch
            ambientGapSeconds = value.ambientGapSeconds
            updateEngineSpeedAndPitch()
        }
    var apiKey: String = ""

    /** 磨耳朵：本张播完后请求下一张（返回 null 表示队列耗尽，自动退出） */
    var onAdvanceRequest: (() -> KnowledgeCard?)? = null

    /** 磨耳朵：请求上一张卡片 */
    var onAdvancePreviousRequest: (() -> KnowledgeCard?)? = null

    /** 设置发生变动时的回调（用于外部持久化） */
    var onSettingsChanged: ((SpeechSettings) -> Unit)? = null

    var ambientGapSeconds: Double = 1.5

    // ---------- 观察状态（Compose 响应式） ----------
    var isSpeaking by mutableStateOf(false)
        private set

    var isPaused by mutableStateOf(false)
        private set

    var speakingCardId by mutableStateOf<String?>(null)
        private set

    var currentCard by mutableStateOf<KnowledgeCard?>(null)
        private set

    var isAmbientMode by mutableStateOf(false)
        private set

    var playbackProgress by mutableFloatStateOf(0f)
        private set

    var currentPositionMs by mutableLongStateOf(0L)
        private set

    var durationMs by mutableLongStateOf(0L)
        private set

    var playbackSpeed by mutableFloatStateOf(1.0f)
        private set

    var playbackPitch by mutableFloatStateOf(1.0f)
        private set

    var sleepTimerRemainingSeconds by mutableStateOf<Int?>(null)
        private set

    /** 最近一次播放错误（UI 展示后由调用方清空） */
    var lastError by mutableStateOf<String?>(null)

    // ---------- 内部引擎与协程 ----------
    private val mainHandler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var pendingCard: KnowledgeCard? = null
    private var mediaPlayer: MediaPlayer? = null
    private var remoteJob: Job? = null
    private var ambientJob: Job? = null
    private var progressJob: Job? = null
    private var sleepTimerJob: Job? = null
    private val activeScope: CoroutineScope get() = scope

    // TTS 估算进度相关参数（中文常速约 4 字/秒）
    private var ttsFullText: String = ""
    private var ttsStartTimeMs: Long = 0L
    private var ttsPausedAccumulatedMs: Long = 0L
    private var ttsEstimatedTotalDurationMs: Long = 0L

    // ---------- 对外播控接口 ----------

    fun ensureTts() {
        if (tts != null) return
        tts = TextToSpeech(context.applicationContext) { status ->
            if (status != TextToSpeech.SUCCESS) {
                failSystemTts("系统语音引擎不可用")
            } else {
                val languageResult = tts?.setLanguage(Locale.CHINA)
                if (languageResult == TextToSpeech.LANG_MISSING_DATA ||
                    languageResult == TextToSpeech.LANG_NOT_SUPPORTED
                ) {
                    failSystemTts("系统语音缺少中文引擎")
                } else {
                    ttsReady = true
                    updateEngineSpeedAndPitch()
                    pendingCard?.let { card ->
                        pendingCard = null
                        if (isSpeaking && speakingCardId == card.id) speak(card)
                    }
                }
            }
        }
    }

    /** 切换某张卡片的播放/停止（兼容老版入口） */
    fun toggle(card: KnowledgeCard) {
        if ((isSpeaking || isPaused) && speakingCardId == card.id) {
            togglePlayPause(card)
        } else {
            speak(card)
        }
    }

    /** 播放或暂停切换 */
    fun togglePlayPause(card: KnowledgeCard? = null) {
        when {
            isSpeaking -> pause()
            isPaused -> resume()
            card != null -> speak(card)
            currentCard != null -> speak(currentCard!!)
            else -> {
                val next = onAdvanceRequest?.invoke()
                if (next != null) speak(next)
            }
        }
    }

    /** 播放卡片（按当前语音配置选择通道；远程失败回退系统 TTS） */
    fun speak(card: KnowledgeCard) {
        stopPlayback(keepAmbient = true, keepCard = false)
        lastError = null
        currentCard = card
        speakingCardId = card.id
        isSpeaking = true
        isPaused = false
        playbackProgress = 0f
        currentPositionMs = 0L

        when (val decision = SpeechChannelPolicy.decide(settings, apiKey)) {
            is SpeechChannelPolicy.Decision.SystemTts -> speakWithSystemTts(card)
            is SpeechChannelPolicy.Decision.Remote -> {
                remoteJob = activeScope.launch { speakWithRemote(card, decision) }
            }
            is SpeechChannelPolicy.Decision.Invalid -> {
                lastError = decision.reason
                speakWithSystemTts(card)
            }
        }
    }

    /** 暂停当前播放 */
    fun pause() {
        if (!isSpeaking) return
        isSpeaking = false
        isPaused = true
        stopProgressTracker()

        // MediaPlayer 通道
        mediaPlayer?.let { player ->
            runCatching {
                if (player.isPlaying) {
                    player.pause()
                    currentPositionMs = player.currentPosition.toLong()
                }
            }
        }

        // 系统 TTS 通道
        if (mediaPlayer == null && tts != null) {
            val now = System.currentTimeMillis()
            ttsPausedAccumulatedMs += (now - ttsStartTimeMs)
            runCatching { tts?.stop() }
        }
    }

    /** 恢复当前暂停的播放 */
    fun resume() {
        if (!isPaused) return
        val card = currentCard ?: return
        isSpeaking = true
        isPaused = false

        // MediaPlayer 通道
        mediaPlayer?.let { player ->
            runCatching {
                player.start()
                startProgressTracker()
            }.onFailure {
                // 若恢复失败，重新开始播放
                speak(card)
            }
            return
        }

        // 系统 TTS 通道：从当前进度对应文本位置继续发音
        speakWithSystemTts(card, resumeFromProgress = playbackProgress)
    }

    /** 完全停止播放并重置状态 */
    fun stop() {
        stopAmbientInternal()
        stopPlayback(keepAmbient = false, keepCard = false)
        speakingCardId = null
        currentCard = null
        isSpeaking = false
        isPaused = false
        playbackProgress = 0f
        currentPositionMs = 0L
        durationMs = 0L
    }

    /** 相对快进快退（单位秒，负数快退，正数快进） */
    fun seekRelative(offsetSeconds: Int) {
        val card = currentCard ?: return
        val totalMs = durationMs.coerceAtLeast(1000L)
        val targetMs = (currentPositionMs + offsetSeconds * 1000L).coerceIn(0L, totalMs)
        val targetRatio = (targetMs.toFloat() / totalMs.toFloat()).coerceIn(0f, 1f)
        seekToProgress(targetRatio, card)
    }

    /** 拖动进度条定位至指定百分比 (0.0f ~ 1.0f) */
    fun seekToProgress(ratio: Float, card: KnowledgeCard? = currentCard) {
        val targetCard = card ?: currentCard ?: return
        val clampedRatio = ratio.coerceIn(0f, 1f)
        playbackProgress = clampedRatio

        mediaPlayer?.let { player ->
            runCatching {
                val total = player.duration
                if (total > 0) {
                    val targetPos = (clampedRatio * total).toInt()
                    player.seekTo(targetPos)
                    currentPositionMs = targetPos.toLong()
                }
            }
            return
        }

        // 系统 TTS 模式
        val totalMs = durationMs.coerceAtLeast(1000L)
        currentPositionMs = (clampedRatio * totalMs).toLong()
        if (isSpeaking) {
            speakWithSystemTts(targetCard, resumeFromProgress = clampedRatio)
        } else if (isPaused) {
            ttsPausedAccumulatedMs = currentPositionMs
        }
    }

    /** 切换语速 (0.75x ~ 2.0x 动态即时生效) */
    fun setSpeed(speed: Float) {
        val clamped = speed.coerceIn(0.5f, 3.0f)
        playbackSpeed = clamped
        settings = settings.copy(speed = clamped)
        onSettingsChanged?.invoke(settings)
        updateEngineSpeedAndPitch()
    }

    /** 在 0.75x -> 1.0x -> 1.25x -> 1.5x -> 2.0x 间循环切换 */
    fun cycleSpeed() {
        val speeds = floatArrayOf(0.75f, 1.0f, 1.25f, 1.5f, 2.0f)
        val cur = playbackSpeed
        val idx = speeds.indexOfFirst { kotlin.math.abs(it - cur) < 0.08f }
        val next = if (idx >= 0) speeds[(idx + 1) % speeds.size] else 1.0f
        setSpeed(next)
    }

    /** 设置语调 (0.8x ~ 1.2x) */
    fun setPitch(pitch: Float) {
        val clamped = pitch.coerceIn(0.5f, 2.0f)
        playbackPitch = clamped
        settings = settings.copy(pitch = clamped)
        onSettingsChanged?.invoke(settings)
        updateEngineSpeedAndPitch()
    }

    /** 设置磨耳朵卡片切换停顿间隔（秒） */
    fun setAmbientGap(gap: Double) {
        val clamped = gap.coerceIn(0.2, 10.0)
        ambientGapSeconds = clamped
        settings = settings.copy(ambientGapSeconds = clamped)
        onSettingsChanged?.invoke(settings)
    }

    /** 设定睡眠定时器（分钟，<= 0 表示关闭） */
    fun setSleepTimer(minutes: Int) {
        sleepTimerJob?.cancel()
        if (minutes <= 0) {
            sleepTimerRemainingSeconds = null
            return
        }
        val totalSeconds = minutes * 60
        sleepTimerRemainingSeconds = totalSeconds
        sleepTimerJob = activeScope.launch {
            var rem = totalSeconds
            while (isActive && rem > 0) {
                delay(1000L)
                rem--
                sleepTimerRemainingSeconds = rem
            }
            if (isActive && rem <= 0) {
                sleepTimerRemainingSeconds = null
                stop()
            }
        }
    }

    /** 切到下一张卡片 */
    fun advanceNext() {
        val next = onAdvanceRequest?.invoke()
        if (next != null) {
            speak(next)
        } else {
            stop()
        }
    }

    /** 返回上一张卡片 */
    fun advancePrevious() {
        val prev = onAdvancePreviousRequest?.invoke()
        if (prev != null) {
            speak(prev)
        }
    }

    /** 磨耳朵：开启连续播报（从当前卡开始），再点一次退出 */
    fun toggleAmbient(current: KnowledgeCard?) {
        if (isAmbientMode) {
            stopAmbientInternal()
            stopPlayback(keepAmbient = false, keepCard = true)
            isSpeaking = false
            isPaused = false
            return
        }
        val start = current ?: currentCard ?: onAdvanceRequest?.invoke()
        if (start == null) {
            lastError = "没有可播放的卡片"
            return
        }
        isAmbientMode = true
        speak(start)
    }

    /** 朗读自定义纯文本（例如卡片 AI 伴学助手的回复） */
    fun speakText(text: String) {
        if (text.isBlank()) return
        stopPlayback(keepAmbient = false, keepCard = false)
        lastError = null
        speakingCardId = "text_${System.currentTimeMillis()}"
        isSpeaking = true
        isPaused = false
        ensureTts()
        if (!ttsReady) return
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, speakingCardId)
    }

    // ---------- 通道实现 ----------

    private fun speakWithSystemTts(card: KnowledgeCard, resumeFromProgress: Float = 0f) {
        ensureTts()
        if (!ttsReady) {
            pendingCard = card
            return
        }
        val fullText = buildSpokenText(card)
        ttsFullText = fullText

        // 中文平均语速 4.2 字/秒，经 speed 加权
        val charsPerSecond = (4.2f * playbackSpeed).coerceAtLeast(1.0f)
        val totalDurationMs = ((fullText.length / charsPerSecond) * 1000L).toLong().coerceAtLeast(1500L)
        durationMs = totalDurationMs

        // 若从进度继续，截取未朗读文本发音
        val startCharIndex = (resumeFromProgress.coerceIn(0f, 0.95f) * fullText.length).toInt()
        val speakSubText = if (startCharIndex > 0) fullText.substring(startCharIndex) else fullText

        ttsPausedAccumulatedMs = (resumeFromProgress * totalDurationMs).toLong()
        ttsStartTimeMs = System.currentTimeMillis()
        ttsEstimatedTotalDurationMs = totalDurationMs

        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit
            override fun onError(utteranceId: String?) {
                mainHandler.post {
                    if (utteranceId == card.id && speakingCardId == card.id) {
                        failSystemTts("系统语音播放失败")
                    }
                }
            }
            override fun onDone(utteranceId: String?) {
                mainHandler.post {
                    if (utteranceId == card.id && speakingCardId == card.id) {
                        playbackProgress = 1.0f
                        currentPositionMs = durationMs
                        onPlaybackFinished()
                    }
                }
            }
        })

        val result = tts?.speak(speakSubText, TextToSpeech.QUEUE_FLUSH, null, card.id)
        if (result == TextToSpeech.ERROR) {
            failSystemTts("系统语音播放失败")
        } else {
            startProgressTracker()
        }
    }

    private suspend fun speakWithRemote(card: KnowledgeCard, decision: SpeechChannelPolicy.Decision.Remote) {
        try {
            val bytes = remoteClient.synthesize(settings, apiKey, buildSpokenText(card), decision)
            kotlinx.coroutines.currentCoroutineContext().ensureActive()

            val file = File(context.cacheDir, "knowflick_speech_${card.id}.mp3")
            withContext(Dispatchers.IO) { file.writeBytes(bytes) }

            runCatching {
                context.cacheDir.listFiles { f -> f.name.startsWith("knowflick_speech_") && f != file }
                    ?.filter { it.lastModified() < System.currentTimeMillis() - 60 * 60 * 1000L }
                    ?.forEach { it.delete() }
            }

            mainHandler.post {
                if ((!isSpeaking && !isPaused) || speakingCardId != card.id) return@post
                runCatching {
                    mediaPlayer?.release()
                    mediaPlayer = MediaPlayer().apply {
                        setDataSource(file.absolutePath)
                        setOnCompletionListener {
                            playbackProgress = 1.0f
                            currentPositionMs = durationMs
                            onPlaybackFinished()
                        }
                        setOnErrorListener { player, _, _ ->
                            runCatching { player.release() }
                            if (mediaPlayer === player) mediaPlayer = null
                            lastError = "音频播放失败，已回退系统语音"
                            if (speakingCardId == card.id) speakWithSystemTts(card)
                            true
                        }
                        setOnPreparedListener { player ->
                            durationMs = player.duration.toLong()
                            applyMediaPlayerSpeed(player, playbackSpeed)
                            if (isSpeaking) {
                                player.start()
                                startProgressTracker()
                            }
                        }
                        prepareAsync()
                    }
                }.onFailure {
                    lastError = "音频播放失败，已回退系统语音"
                    if (speakingCardId == card.id) speakWithSystemTts(card)
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: SpeechError) {
            lastError = e.message
            mainHandler.post {
                if (speakingCardId == card.id) speakWithSystemTts(card)
            }
        } catch (e: Exception) {
            lastError = "语音服务不可用：${e.message}，已回退系统语音"
            mainHandler.post {
                if (speakingCardId == card.id) speakWithSystemTts(card)
            }
        }
    }

    private fun startProgressTracker() {
        stopProgressTracker()
        progressJob = activeScope.launch {
            while (isActive && isSpeaking) {
                if (mediaPlayer != null) {
                    val player = mediaPlayer
                    if (player != null && player.isPlaying) {
                        currentPositionMs = player.currentPosition.toLong()
                        val dur = player.duration.toLong()
                        if (dur > 0) {
                            durationMs = dur
                            playbackProgress = (currentPositionMs.toFloat() / dur.toFloat()).coerceIn(0f, 1f)
                        }
                    }
                } else if (tts != null && ttsEstimatedTotalDurationMs > 0) {
                    val now = System.currentTimeMillis()
                    val elapsed = (now - ttsStartTimeMs) + ttsPausedAccumulatedMs
                    currentPositionMs = elapsed.coerceAtMost(ttsEstimatedTotalDurationMs)
                    playbackProgress = (currentPositionMs.toFloat() / ttsEstimatedTotalDurationMs.toFloat()).coerceIn(0f, 1f)
                }
                delay(100L)
            }
        }
    }

    private fun stopProgressTracker() {
        progressJob?.cancel()
        progressJob = null
    }

    private fun updateEngineSpeedAndPitch() {
        runCatching {
            tts?.setSpeechRate(playbackSpeed)
            tts?.setPitch(playbackPitch)
        }
        mediaPlayer?.let { player ->
            applyMediaPlayerSpeed(player, playbackSpeed)
        }
    }

    private fun applyMediaPlayerSpeed(player: MediaPlayer, speed: Float) {
        runCatching {
            val params = player.playbackParams ?: PlaybackParams()
            params.speed = speed
            player.playbackParams = params
        }
    }

    private fun buildSpokenText(card: KnowledgeCard): String = buildString {
        append(card.headline)
        append("。")
        card.paragraphs.forEach {
            append(it)
            append("。")
        }
    }

    // ---------- 磨耳朵推进 ----------

    private fun onPlaybackFinished() {
        stopProgressTracker()
        stopPlayback(keepAmbient = true, keepCard = true)
        isSpeaking = false
        isPaused = false
        if (!isAmbientMode) return

        ambientJob?.cancel()
        ambientJob = activeScope.launch {
            delay((ambientGapSeconds.coerceIn(0.0, 60.0) * 1000).toLong())
            if (!isAmbientMode) return@launch
            val next = onAdvanceRequest?.invoke()
            if (next == null) {
                stopAmbientInternal()
            } else {
                speak(next)
            }
        }
    }

    private fun stopPlayback(keepAmbient: Boolean, keepCard: Boolean = false) {
        if (!keepAmbient) ambientJob?.cancel()
        stopProgressTracker()
        remoteJob?.cancel()
        remoteJob = null
        pendingCard = null
        runCatching { tts?.stop() }
        runCatching {
            mediaPlayer?.let {
                if (it.isPlaying) it.stop()
                it.release()
            }
            mediaPlayer = null
        }
        if (!keepCard) {
            currentCard = null
        }
    }

    private fun stopAmbientInternal() {
        isAmbientMode = false
        ambientJob?.cancel()
        ambientJob = null
    }

    fun release() {
        stopAmbientInternal()
        stopProgressTracker()
        sleepTimerJob?.cancel()
        stopPlayback(keepAmbient = false, keepCard = false)
        runCatching { tts?.shutdown() }
        tts = null
        ttsReady = false
        scope.cancel()
    }

    private fun failSystemTts(message: String) {
        lastError = message
        pendingCard = null
        stopAmbientInternal()
        speakingCardId = null
        isSpeaking = false
        isPaused = false
        stopProgressTracker()
    }
}
