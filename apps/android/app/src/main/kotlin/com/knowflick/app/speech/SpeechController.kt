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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

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
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var pendingCard: KnowledgeCard? = null
    private var mediaPlayer: MediaPlayer? = null
    private var remoteJob: Job? = null
    private var ambientJob: Job? = null
    private val activeScope: CoroutineScope get() = scope

    // ---------- 对外接口 ----------

    fun ensureTts() {
        if (tts != null) return
        tts = TextToSpeech(context.applicationContext) { status ->
            if (status != TextToSpeech.SUCCESS) {
                failSystemTts("系统语音引擎不可用")
            } else {
                // 语言设置必须检查返回码：缺中文引擎时 setLanguage 返回
                // LANG_MISSING_DATA / LANG_NOT_SUPPORTED，此时若仍置 ttsReady = true，
                // 后续 speak() 会静默失败（无回调、无错误），用户只看到「点了没反应」。
                val languageResult = tts?.setLanguage(Locale.CHINA)
                if (languageResult == TextToSpeech.LANG_MISSING_DATA ||
                    languageResult == TextToSpeech.LANG_NOT_SUPPORTED
                ) {
                    failSystemTts("系统语音缺少中文引擎")
                } else {
                    ttsReady = true
                    pendingCard?.let { card ->
                        pendingCard = null
                        if (isSpeaking && speakingCardId == card.id) speak(card)
                    }
                }
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
                remoteJob = activeScope.launch { speakWithRemote(card, decision) }
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

    /** 朗读自定义纯文本（例如卡片 AI 伴学助手的回复） */
    fun speakText(text: String) {
        if (text.isBlank()) return
        stopPlayback(keepAmbient = false)
        lastError = null
        speakingCardId = "text_${System.currentTimeMillis()}"
        isSpeaking = true
        ensureTts()
        if (!ttsReady) return
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, speakingCardId)
    }

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
                mainHandler.post {
                    if (utteranceId == card.id && speakingCardId == card.id) {
                        failSystemTts("系统语音播放失败")
                    }
                }
            }
            override fun onDone(utteranceId: String?) {
                mainHandler.post {
                    if (utteranceId == card.id && speakingCardId == card.id) onPlaybackFinished()
                }
            }
        })
        val result = tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, card.id)
        if (result == TextToSpeech.ERROR) failSystemTts("系统语音播放失败")
    }

    private suspend fun speakWithRemote(card: KnowledgeCard, decision: SpeechChannelPolicy.Decision.Remote) {
        try {
            val bytes = remoteClient.synthesize(settings, apiKey, buildSpokenText(card), decision)
            kotlinx.coroutines.currentCoroutineContext().ensureActive()
            // 每个卡片用独立文件名：磨耳朵连续朗读时固定文件名会被下一张覆盖，
            // 而 MediaPlayer 可能仍在读上一个文件。
            // 直接用完整 card.id（UUID 字符串）而非 hashCode()：理论上不同卡片的哈希会碰撞，
            // 一旦碰撞就会在播放中覆盖正被读取的文件。
            val file = File(context.cacheDir, "knowflick_speech_${card.id}.mp3")
            withContext(Dispatchers.IO) { file.writeBytes(bytes) }
            // 清掉同一卡片的旧临时文件，避免缓存目录堆积
            runCatching {
                context.cacheDir.listFiles { f -> f.name.startsWith("knowflick_speech_") && f != file }
                    ?.filter { it.lastModified() < System.currentTimeMillis() - 60 * 60 * 1000L }
                    ?.forEach { it.delete() }
            }
            mainHandler.post {
                if (!isSpeaking || speakingCardId != card.id) return@post
                runCatching {
                    mediaPlayer?.release()
                    mediaPlayer = MediaPlayer().apply {
                        setDataSource(file.absolutePath)
                        setOnCompletionListener { onPlaybackFinished() }
                        setOnErrorListener { player, _, _ ->
                            runCatching { player.release() }
                            if (mediaPlayer === player) mediaPlayer = null
                            lastError = "音频播放失败，已回退系统语音"
                            if (isSpeaking && speakingCardId == card.id) speakWithSystemTts(card)
                            true
                        }
                        // 异步准备：prepare() 会同步解析容器/缓冲首帧，在主线程上执行会造成
                        // 可感知卡顿（磨耳朵连续朗读时每张卡触发一次）；错误路径仍由
                        // setOnErrorListener / onFailure 兜底回退系统语音。
                        setOnPreparedListener { player -> player.start() }
                        prepareAsync()
                    }
                }.onFailure {
                    lastError = "音频播放失败，已回退系统语音"
                    if (isSpeaking && speakingCardId == card.id) speakWithSystemTts(card)
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: SpeechError) {
            lastError = e.message
            mainHandler.post {
                if (isSpeaking && speakingCardId == card.id) speakWithSystemTts(card)
            }   // 远程失败回退系统
        } catch (e: Exception) {
            // 明文策略拦截 / DNS / 超时等底层异常同样回退系统语音
            lastError = "语音服务不可用：${e.message}，已回退系统语音"
            mainHandler.post {
                if (isSpeaking && speakingCardId == card.id) speakWithSystemTts(card)
            }
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
        scope.cancel()
    }

    private fun failSystemTts(message: String) {
        lastError = message
        pendingCard = null
        stopAmbientInternal()
        speakingCardId = null
        isSpeaking = false
    }
}
