package com.knowflick.app.ui

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import android.speech.tts.TextToSpeech
import com.knowflick.app.domain.KnowledgeCard
import java.util.Locale

/**
 * 语音朗读（系统 TTS 通道）：卡片全文播报，全局单实例挂接。
 * 云端 /audio/speech 与本地网关通道在后续里程碑接入（复用同一播放条 UI）。
 */
object SpeechController {
    private var tts: TextToSpeech? = null
    private var ready = false
    private var pendingPlay: KnowledgeCard? = null
    private var listener: (() -> Unit)? = null

    /** Compose 侧观察的朗读状态 */
    var isSpeakingState by androidx.compose.runtime.mutableStateOf(false)
        private set

    fun ensure(context: Context) {
        if (tts != null) return
        tts = TextToSpeech(context.applicationContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.language = Locale.CHINA
                tts?.setSpeechRate(1.0f)
                ready = true
                pendingPlay?.let { card ->
                    pendingPlay = null
                    speak(card)
                }
            }
        }
    }

    fun toggle(context: Context, card: KnowledgeCard) {
        ensure(context)
        if (isSpeakingState) {
            stop()
        } else {
            speak(card)
        }
    }

    fun speak(card: KnowledgeCard) {
        if (!ready) {
            pendingPlay = card
            return
        }
        val text = buildString {
            append(card.headline)
            append("。")
            card.paragraphs.forEach { append(it); append("。") }
        }
        currentSpeakingId = card.id
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, card.id)
        isSpeakingState = true
    }

    var currentSpeakingId: String? = null
        private set

    fun stop() {
        tts?.stop()
        isSpeakingState = false
        currentSpeakingId = null
    }

    fun setListener(l: (() -> Unit)?) {
        listener = l
    }
}
