package com.knowflick.app.ui.common

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import java.util.Random
import java.util.concurrent.Executors
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin

/**
 * 拟真物理纸质音效引擎 (Procedural Soundscapes & Audio FX)
 *
 * 采用轻量程序化 16-bit PCM 波形合成技术，0 外部音频资源体积开销（0 KB APK 增量），
 * 具备毫秒级瞬态响应，并严格遵循系统静音模式与用户配置开关。
 */
object AudioEffectHelper {

    private const val SAMPLE_RATE = 44100
    private val executor = Executors.newSingleThreadExecutor()

    /** 全局拟真物理音效开关 */
    var isEnabled: Boolean = true

    // 预合成的 PCM 内存静态音频片段
    private val paperSlideTrack: AudioTrack? by lazy { createStaticTrack(generatePaperSlidePcm()) }
    private val cardFlipTrack: AudioTrack? by lazy { createStaticTrack(generateCardFlipPcm()) }
    private val masteryChimeTrack: AudioTrack? by lazy { createStaticTrack(generateMasteryChimePcm()) }
    private val clickTrack: AudioTrack? by lazy { createStaticTrack(generateClickPcm()) }

    private fun isSystemMuted(context: Context): Boolean {
        return try {
            val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
            val mode = audioManager?.ringerMode ?: AudioManager.RINGER_MODE_NORMAL
            mode != AudioManager.RINGER_MODE_NORMAL
        } catch (_: Exception) {
            false
        }
    }

    private fun playTrack(context: Context, trackProvider: () -> AudioTrack?) {
        if (!isEnabled || isSystemMuted(context)) return
        executor.execute {
            try {
                // 首次 PCM 合成与 AudioTrack 初始化也留在音频线程，避免第一次划卡卡顿。
                val track = trackProvider() ?: return@execute
                if (track.playState == AudioTrack.PLAYSTATE_PLAYING) {
                    track.stop()
                }
                track.reloadStaticData()
                track.play()
            } catch (_: Exception) {
                // 容错处理音频通道异常
            }
        }
    }

    /**
     * 播放纸张轻微沙沙摩擦滑动音效（用于卡片拖拽与滑动）
     */
    fun playPaperSlide(context: Context) {
        playTrack(context) { paperSlideTrack }
    }

    /**
     * 播放轻脆卡片翻折/弹出音效（用于卡片翻面与测验翻转）
     */
    fun playCardFlip(context: Context) {
        playTrack(context) { cardFlipTrack }
    }

    /**
     * 播放悦耳掌握成就泛音（用于右划掌握与评级良好/容易）
     */
    fun playMasteryChime(context: Context) {
        playTrack(context) { masteryChimeTrack }
    }

    /**
     * 播放轻快机械点击音效（用于常规按键确认）
     */
    fun playClick(context: Context) {
        playTrack(context) { clickTrack }
    }

    // ---------- 程序化波形合成算法 ----------

    private fun createStaticTrack(pcmData: ShortArray): AudioTrack? {
        return try {
            val attributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()

            val format = AudioFormat.Builder()
                .setSampleRate(SAMPLE_RATE)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .build()

            val track = AudioTrack(
                attributes,
                format,
                pcmData.size * 2,
                AudioTrack.MODE_STATIC,
                AudioManager.AUDIO_SESSION_ID_GENERATE
            )
            track.write(pcmData, 0, pcmData.size)
            track
        } catch (_: Exception) {
            null
        }
    }

    /**
     * 合成高品质纸张摩擦粉红噪声脉冲（约 85ms，模拟纸牌划过桌面的质感沙沙声）
     */
    private fun generatePaperSlidePcm(): ShortArray {
        val durationMs = 85
        val numSamples = (SAMPLE_RATE * (durationMs / 1000.0)).toInt()
        val pcm = ShortArray(numSamples)
        val random = Random(42)

        var b0 = 0.0
        var b1 = 0.0
        var b2 = 0.0

        for (i in 0 until numSamples) {
            val white = (random.nextDouble() * 2.0 - 1.0)
            // 简单粉红噪声滤波器
            b0 = 0.99886 * b0 + white * 0.0555179
            b1 = 0.99332 * b1 + white * 0.0750759
            b2 = 0.96900 * b2 + white * 0.1538520
            val pink = b0 + b1 + b2 + white * 0.5362

            // 包络：平滑上升（12ms）+ 指数渐逝衰减
            val t = i.toDouble() / numSamples
            val envelope = when {
                t < 0.15 -> t / 0.15
                else -> exp(-6.0 * (t - 0.15))
            }

            val sampleVal = (pink * envelope * 9000.0).coerceIn(-32767.0, 32767.0)
            pcm[i] = sampleVal.toInt().toShort()
        }
        return pcm
    }

    /**
     * 合成瞬态轻脆翻卡微鸣（约 25ms，快速下行滑音 1300Hz -> 320Hz）
     */
    private fun generateCardFlipPcm(): ShortArray {
        val durationMs = 25
        val numSamples = (SAMPLE_RATE * (durationMs / 1000.0)).toInt()
        val pcm = ShortArray(numSamples)

        var phase = 0.0
        for (i in 0 until numSamples) {
            val t = i.toDouble() / numSamples
            val freq = 1300.0 - 980.0 * (t * t)
            phase += 2.0 * PI * freq / SAMPLE_RATE

            val envelope = when {
                t < 0.08 -> t / 0.08
                else -> exp(-9.0 * (t - 0.08))
            }

            val sampleVal = (sin(phase) * envelope * 12000.0).coerceIn(-32767.0, 32767.0)
            pcm[i] = sampleVal.toInt().toShort()
        }
        return pcm
    }

    /**
     * 合成优雅双音和谐泛音（C5 523Hz + C6 1046Hz，自然指数尾音，约 180ms）
     */
    private fun generateMasteryChimePcm(): ShortArray {
        val durationMs = 180
        val numSamples = (SAMPLE_RATE * (durationMs / 1000.0)).toInt()
        val pcm = ShortArray(numSamples)

        val freq1 = 523.25 // C5
        val freq2 = 1046.50 // C6
        val freq3 = 1567.98 // G6 微弱泛音

        for (i in 0 until numSamples) {
            val t = i.toDouble() / SAMPLE_RATE
            val progress = i.toDouble() / numSamples

            val wave = 0.55 * sin(2.0 * PI * freq1 * t) +
                0.35 * sin(2.0 * PI * freq2 * t) +
                0.10 * sin(2.0 * PI * freq3 * t)

            val envelope = when {
                progress < 0.04 -> progress / 0.04
                else -> exp(-5.5 * (progress - 0.04))
            }

            val sampleVal = (wave * envelope * 14000.0).coerceIn(-32767.0, 32767.0)
            pcm[i] = sampleVal.toInt().toShort()
        }
        return pcm
    }

    /**
     * 合成短促微机械确认敲击音（约 15ms）
     */
    private fun generateClickPcm(): ShortArray {
        val durationMs = 15
        val numSamples = (SAMPLE_RATE * (durationMs / 1000.0)).toInt()
        val pcm = ShortArray(numSamples)

        var phase = 0.0
        val freq = 880.0

        for (i in 0 until numSamples) {
            val progress = i.toDouble() / numSamples
            phase += 2.0 * PI * freq / SAMPLE_RATE

            val envelope = when {
                progress < 0.1 -> progress / 0.1
                else -> exp(-12.0 * (progress - 0.1))
            }

            val sampleVal = (sin(phase) * envelope * 11000.0).coerceIn(-32767.0, 32767.0)
            pcm[i] = sampleVal.toInt().toShort()
        }
        return pcm
    }
}
