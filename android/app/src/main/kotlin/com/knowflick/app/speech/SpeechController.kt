package com.knowflick.app.speech

import android.content.Context
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.knowflick.app.domain.KnowledgeCard
import java.io.File
import java.util.Locale
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * 语音播放控制器：三通道（系统 TTS / 云端 / 本地网关）+ 磨耳朵连续模式。
 * 远程通道失败自动回退系统 TTS（与 macOS 口径一致）；播放完成驱动磨耳朵推进。
 */
class SpeechController(
    private val context: Context,
    private val remoteClient: RemoteSpeechClient = RemoteSpeechClient(),
) {
    // ---------- 配置 ----------
    var settings: SpeechSettings = SpeechSettings()
    var apiKey: String = ""

    /** 磨耳朵：本张播完后请求下一张（返回 null 表示队列耗尽，自动退出） */
    var onAdvanceRequest: (() -> KnowledgeCard?)? = null
    var ambientGapSeconds: Double = 1.5

    // ---------- 观察状态（Compose） ----------
    var isSpeaking by mutableStateOf(false)
        private set
    var speakingCardId by mutableStateOf<String?>(null)
        private set
    var isAmbientMode by mutableStateOf(false)
        private set

    /** 最近一次播放错误（UI 展示后由调用方清空） */
    var lastError by mutableStateOf<String?>(null)

    private val mainHandler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(Dispatchers.Main)
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var pendingCard: KnowledgeCard? = null
    private var mediaPlayer: MediaPlayer? = null
    private var ambientJob: Job? = null
    private val activeScope: CoroutineScope get() = scope

    // ---------- 对外接口 ----------

    fun ensureTts() {
        if (tts != null) return
        tts = TextToSpeech(context.applicationContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.language = Locale.CHINA
                ttsReady = true
                pendingCard?.let { card ->
                    pendingCard = null
                    speak(card)
                }
            } else {
                lastError = "系统语音引擎不可用"
            }
        }
    }

    fun toggle(card: KnowledgeCard) {
        if (isSpeaking && speakingCardId == card.id) stop() else speak(card)
    }

    /** 播放卡片（按当前语音配置选择通道；远程失败回退系统 TTS） */
    fun speak(card: KnowledgeCard) {
        stopPlayback(keepAmbient = true)
        lastError = null
        speakingCardId = card.id
        isSpeaking = true
        when (val decision = SpeechChannelPolicy.decide(settings, apiKey)) {
            is SpeechChannelPolicy.Decision.SystemTts -> speakWithSystemTts(card)
            is SpeechChannelPolicy.Decision.Remote -> {
                activeScope.launch { speakWithRemote(card, decision) }
            }
            is SpeechChannelPolicy.Decision.Invalid -> {
                lastError = decision.reason
                speakWithSystemTts(card)   // 配置无效不阻断：回退系统语音
            }
        }
    }

    fun stop() {
        stopAmbientInternal()
        stopPlayback(keepAmbient = false)
        speakingCardId = null
        isSpeaking = false
    }

    /** 磨耳朵：开启连续播报（从当前卡开始），再点一次退出 */
    fun toggleAmbient(current: KnowledgeCard?) {
        if (isAmbientMode) {
            stopAmbientInternal()
            stopPlayback(keepAmbient = false)
            speakingCardId = null
            isSpeaking = false
            return
        }
        val start = current ?: onAdvanceRequest?.invoke()
        if (start == null) {
            lastError = "没有可播放的卡片"
            return
        }
        isAmbientMode = true
        speak(start)
    }

    fun toggleFavoriteNoop() = Unit

    // ---------- 通道实现 ----------

    private fun speakWithSystemTts(card: KnowledgeCard) {
        ensureTts()
        if (!ttsReady) {
            pendingCard = card
            return
        }
        val text = buildSpokenText(card)
        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit
            override fun onError(utteranceId: String?) {
                mainHandler.post { onPlaybackFinished() }
            }
            override fun onDone(utteranceId: String?) {
                mainHandler.post { onPlaybackFinished() }
            }
        })
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, card.id)
    }

    private suspend fun speakWithRemote(card: KnowledgeCard, decision: SpeechChannelPolicy.Decision.Remote) {
        try {
            val bytes = remoteClient.synthesize(settings, apiKey, buildSpokenText(card), decision)
            val file = File(context.cacheDir, "knowflick_speech.mp3")
            file.writeBytes(bytes)
            mainHandler.post {
                runCatching {
                    mediaPlayer?.release()
                    mediaPlayer = MediaPlayer().apply {
                        setDataSource(file.absolutePath)
                        setOnCompletionListener { onPlaybackFinished() }
                        setOnErrorListener { _, _, _ ->
                            lastError = "音频播放失败，已回退系统语音"
                            mainHandler.post { speakWithSystemTts(card) }
                            true
                        }
                        prepare()
                        start()
                    }
                }.onFailure {
                    lastError = "音频播放失败，已回退系统语音"
                    speakWithSystemTts(card)
                }
            }
        } catch (e: SpeechError) {
            lastError = e.message
            mainHandler.post { speakWithSystemTts(card) }   // 远程失败回退系统
        } catch (e: Exception) {
            // 明文策略拦截 / DNS / 超时等底层异常同样回退系统语音
            lastError = "语音服务不可用：${e.message}，已回退系统语音"
            mainHandler.post { speakWithSystemTts(card) }
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
        stopPlayback(keepAmbient = true)
        isSpeaking = false
        speakingCardId = null
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

    private fun stopPlayback(keepAmbient: Boolean) {
        if (!keepAmbient) ambientJob?.cancel()
        runCatching { tts?.stop() }
        runCatching {
            mediaPlayer?.let {
                if (it.isPlaying) it.stop()
                it.release()
            }
            mediaPlayer = null
        }
    }

    private fun stopAmbientInternal() {
        isAmbientMode = false
        ambientJob?.cancel()
        ambientJob = null
    }

    fun release() {
        stopAmbientInternal()
        stopPlayback(keepAmbient = false)
        runCatching { tts?.shutdown() }
        tts = null
        ttsReady = false
    }
}
