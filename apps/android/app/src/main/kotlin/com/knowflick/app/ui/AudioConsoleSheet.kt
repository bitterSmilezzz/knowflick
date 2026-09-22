package com.knowflick.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.speech.SpeechChannel
import com.knowflick.app.speech.SpeechController
import com.knowflick.app.speech.SpeechPreset
import java.util.Locale

/**
 * 全功能离线语音朗读控制台沉浸面板 (Audio Console Sheet)。
 * 提供出版物级的暗黑设计与完备的播控调度能力：
 * 1. 当前卡片大字标题、分类与金句摘要；
 * 2. 毫秒级进度条拖拽定位与时长显示；
 * 3. 大尺寸中央播控区：快退 5 秒、上一张、主播放/暂停、下一张、快进 5 秒；
 * 4. 听书档位（精读标准 / 温和真人 / 通勤清醒 / 睡前轻缓）一键改语速+音调+停顿；
 * 5. 语速多档调节（0.75x ~ 2.0x）；
 * 6. 语调微调（低沉 0.85x / 标准 1.0x / 清亮 1.15x）；
 * 7. 磨耳朵自动翻卡停顿间隔设置（0.8s / 1.5s / 3.0s）；
 * 8. 睡眠定时器倒计时关停（15/30/60 分钟），结束前 30 秒音量与语速一起淡出。
 */
@Composable
fun AudioConsoleSheet(
    controller: SpeechController,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val card = controller.currentCard ?: return
    val isSpeaking = controller.isSpeaking
    val isPaused = controller.isPaused
    val progress = controller.playbackProgress
    val currentMs = controller.currentPositionMs
    val durationMs = controller.durationMs
    val speed = controller.playbackSpeed
    val pitch = controller.playbackPitch
    val gap = controller.ambientGapSeconds
    val sleepSeconds = controller.sleepTimerRemainingSeconds
    val isAmbient = controller.isAmbientMode
    val activePreset = controller.activePreset
    // 只有走真人音色（云端/本地网关）时，「温和真人」「睡前轻缓」才名副其实
    val usesRealVoice = controller.settings.channelEnum != SpeechChannel.SYSTEM

    BackHandler(onBack = onClose)

    Box(
        modifier = modifier
            .fillMaxSize()
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = {},
            )
            .background(Color(0xF60E0E12))
            .statusBarsPadding()
            .navigationBarsPadding(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp, vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // 顶部下拉指示小横条
            Box(
                modifier = Modifier
                    .width(42.dp)
                    .height(4.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(Color.White.copy(alpha = 0.25f)),
            )

            Spacer(Modifier.height(10.dp))

            // 顶栏：标题与关闭按钮
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(
                        imageVector = AppIcons.Headphones,
                        contentDescription = null,
                        tint = EditorialColor.aiAmber,
                        modifier = Modifier.size(20.dp),
                    )
                    Text(
                        text = "语音听书控制台",
                        color = Color.White,
                        fontSize = 17.sp,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Serif,
                    )
                }

                IconButton(
                    onClick = onClose,
                    modifier = Modifier
                        .size(34.dp)
                        .background(Color.White.copy(alpha = 0.08f), CircleShape),
                ) {
                    Icon(
                        Icons.Filled.Close,
                        contentDescription = "关闭",
                        tint = Color.White.copy(alpha = 0.8f),
                        modifier = Modifier.size(18.dp),
                    )
                }
            }

            Spacer(Modifier.height(14.dp))

            // 可滚动控制台主体
            Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                // 1. 卡片精粹看板
                CardInfoCard(card = card, isSpeaking = isSpeaking)

                Spacer(Modifier.height(20.dp))

                // 2. 播放进度条与时间显示
                PlaybackProgressSection(
                    progress = progress,
                    currentMs = currentMs,
                    durationMs = durationMs,
                    onSeek = { ratio -> controller.seekToProgress(ratio, card) },
                )

                Spacer(Modifier.height(16.dp))

                // 3. 中央播控大按钮组 (⏪ -5s | ⏮ 上一张 | ▶ 播放/暂停 | ⏭ 下一张 | ⏩ +5s)
                PlaybackControlSection(
                    isSpeaking = isSpeaking,
                    isPaused = isPaused,
                    canPrevious = controller.onAdvancePreviousRequest != null,
                    onPrevious = { controller.advancePrevious() },
                    onTogglePlay = { controller.togglePlayPause(card) },
                    onNext = { controller.advanceNext() },
                    onRewind = { controller.seekRelative(-5) },
                    onForward = { controller.seekRelative(5) },
                )

                Spacer(Modifier.height(24.dp))

                // 4. 声音与音色高级调节面板
                AudioTuningSection(
                    speed = speed,
                    pitch = pitch,
                    ambientGap = gap,
                    sleepSeconds = sleepSeconds,
                    isAmbient = isAmbient,
                    activePreset = activePreset,
                    usesRealVoice = usesRealVoice,
                    fadeVolume = controller.sleepFadeVolume,
                    onPresetChange = { controller.applyPreset(it) },
                    onSpeedChange = { controller.setSpeed(it) },
                    onPitchChange = { controller.setPitch(it) },
                    onGapChange = { controller.setAmbientGap(it) },
                    onSleepTimerChange = { controller.setSleepTimer(it) },
                    onToggleAmbient = { controller.toggleAmbient(card) },
                )

                Spacer(Modifier.height(16.dp))
            }
        }
    }
}

/** 卡片信息概览卡 */
@Composable
private fun CardInfoCard(
    card: KnowledgeCard,
    isSpeaking: Boolean,
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(18.dp)),
        color = Color(0xFF16171E),
        shape = RoundedCornerShape(18.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(18.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                // 分类胶囊
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(EditorialColor.aiAmber.copy(alpha = 0.16f))
                        .border(1.dp, EditorialColor.aiAmber.copy(alpha = 0.35f), RoundedCornerShape(8.dp))
                        .padding(horizontal = 8.dp, vertical = 3.dp),
                ) {
                    Text(
                        text = card.category,
                        color = EditorialColor.aiAmber,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }

                // 动态律动指示
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    AudioWaveformBars(isPlaying = isSpeaking)
                    Text(
                        text = if (isSpeaking) "正在朗读" else "已暂停",
                        color = if (isSpeaking) EditorialColor.likeGreen else Color.White.copy(alpha = 0.45f),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }

            Spacer(Modifier.height(12.dp))

            Text(
                text = card.headline,
                color = Color.White,
                fontSize = 17.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Serif,
                lineHeight = 24.sp,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )

            if (card.paragraphs.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = card.paragraphs.first(),
                    color = Color.White.copy(alpha = 0.65f),
                    fontSize = 12.5.sp,
                    lineHeight = 18.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/** 播放进度与时间轴 */
@Composable
private fun PlaybackProgressSection(
    progress: Float,
    currentMs: Long,
    durationMs: Long,
    onSeek: (Float) -> Unit,
) {
    var isDragging by remember { mutableStateOf(false) }
    var dragProgress by remember { mutableFloatStateOf(0f) }

    val displayProgress = if (isDragging) dragProgress else progress
    val displayCurrentMs = if (isDragging) (dragProgress * durationMs.coerceAtLeast(1L)).toLong() else currentMs

    Column(modifier = Modifier.fillMaxWidth()) {
        Slider(
            value = displayProgress.coerceIn(0f, 1f),
            onValueChange = {
                isDragging = true
                dragProgress = it
            },
            onValueChangeFinished = {
                isDragging = false
                onSeek(dragProgress)
            },
            colors = SliderDefaults.colors(
                thumbColor = EditorialColor.aiAmber,
                activeTrackColor = EditorialColor.aiAmber,
                inactiveTrackColor = Color.White.copy(alpha = 0.16f),
            ),
            modifier = Modifier.fillMaxWidth(),
        )

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                text = formatDuration(displayCurrentMs),
                color = Color.White.copy(alpha = 0.6f),
                fontSize = 11.sp,
                fontFamily = FontFamily.Monospace,
            )
            Text(
                text = formatDuration(durationMs),
                color = Color.White.copy(alpha = 0.6f),
                fontSize = 11.sp,
                fontFamily = FontFamily.Monospace,
            )
        }
    }
}

/** 中央播控按钮群 */
@Composable
private fun PlaybackControlSection(
    isSpeaking: Boolean,
    isPaused: Boolean,
    canPrevious: Boolean,
    onPrevious: () -> Unit,
    onTogglePlay: () -> Unit,
    onNext: () -> Unit,
    onRewind: () -> Unit,
    onForward: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceEvenly,
    ) {
        // 快退 5 秒
        IconButton(
            onClick = onRewind,
            modifier = Modifier
                .size(44.dp)
                .background(Color.White.copy(alpha = 0.06f), CircleShape),
        ) {
            Icon(
                imageVector = AppIcons.FastRewind,
                contentDescription = "快退 5 秒",
                tint = Color.White.copy(alpha = 0.85f),
                modifier = Modifier.size(20.dp),
            )
        }

        // 上一张
        IconButton(
            onClick = onPrevious,
            enabled = canPrevious,
            modifier = Modifier
                .size(48.dp)
                .background(Color.White.copy(alpha = 0.08f), CircleShape),
        ) {
            Icon(
                imageVector = AppIcons.SkipPrevious,
                contentDescription = "上一张",
                tint = if (canPrevious) Color.White else Color.White.copy(alpha = 0.25f),
                modifier = Modifier.size(22.dp),
            )
        }

        // 主播放/暂停 (64dp 大圆钮)
        Box(
            modifier = Modifier
                .size(64.dp)
                .shadow(16.dp, CircleShape)
                .clip(CircleShape)
                .background(EditorialColor.aiAmber)
                .clickable(onClick = onTogglePlay),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = if (isSpeaking) AppIcons.Pause else AppIcons.PlayArrow,
                contentDescription = if (isSpeaking) "暂停" else "播放",
                tint = Color.Black,
                modifier = Modifier.size(32.dp),
            )
        }

        // 下一张
        IconButton(
            onClick = onNext,
            modifier = Modifier
                .size(48.dp)
                .background(Color.White.copy(alpha = 0.08f), CircleShape),
        ) {
            Icon(
                imageVector = AppIcons.SkipNext,
                contentDescription = "下一张",
                tint = Color.White,
                modifier = Modifier.size(22.dp),
            )
        }

        // 快进 5 秒
        IconButton(
            onClick = onForward,
            modifier = Modifier
                .size(44.dp)
                .background(Color.White.copy(alpha = 0.06f), CircleShape),
        ) {
            Icon(
                imageVector = AppIcons.FastForward,
                contentDescription = "快进 5 秒",
                tint = Color.White.copy(alpha = 0.85f),
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

/** 声音调节面板 (语速 / 语调 / 磨耳朵停顿 / 定时器) */
@Composable
private fun AudioTuningSection(
    speed: Float,
    pitch: Float,
    ambientGap: Double,
    sleepSeconds: Int?,
    isAmbient: Boolean,
    activePreset: SpeechPreset?,
    usesRealVoice: Boolean,
    fadeVolume: Float,
    onPresetChange: (SpeechPreset) -> Unit,
    onSpeedChange: (Float) -> Unit,
    onPitchChange: (Float) -> Unit,
    onGapChange: (Double) -> Unit,
    onSleepTimerChange: (Int) -> Unit,
    onToggleAmbient: () -> Unit,
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(18.dp)),
        color = Color(0xFF16171E),
        shape = RoundedCornerShape(18.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            // 1. 磨耳朵连续听书开关
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Column {
                    Text(
                        text = "磨耳朵连续听书",
                        color = Color.White,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        text = "单张播完后自动朗读下一张卡片",
                        color = Color.White.copy(alpha = 0.45f),
                        fontSize = 11.5.sp,
                    )
                }

                Switch(
                    checked = isAmbient,
                    onCheckedChange = { onToggleAmbient() },
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = Color.Black,
                        checkedTrackColor = EditorialColor.aiAmber,
                        uncheckedThumbColor = Color.White.copy(alpha = 0.6f),
                        uncheckedTrackColor = Color.White.copy(alpha = 0.15f),
                    ),
                )
            }

            Box(Modifier.fillMaxWidth().height(1.dp).background(Color.White.copy(alpha = 0.08f)))

            // 2. 听书档位：一键把语速/音调/停顿（睡前档还含睡眠定时）调到某个场景
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("听书档位", color = Color.White, fontSize = 13.5.sp, fontWeight = FontWeight.Medium)
                    Text(
                        activePreset?.label ?: "自定义",
                        color = EditorialColor.aiAmber,
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    SpeechPreset.entries.forEach { preset ->
                        PillButton(
                            text = preset.label,
                            isSelected = activePreset?.id == preset.id,
                            modifier = Modifier.weight(1f),
                            onClick = { onPresetChange(preset) },
                        )
                    }
                }

                Text(
                    text = activePreset?.scene?.takeIf { !it.isBlank() }
                        ?: "手调过语速或音调后的自定义组合",
                    color = Color.White.copy(alpha = 0.45f),
                    fontSize = 11.5.sp,
                )
                if (activePreset?.prefersRealVoice == true && !usesRealVoice) {
                    Text(
                        text = "当前是系统音色，这一档只能近似；在设置里接上云端真人语音（如 CosyVoice）才更像真人朗读。",
                        color = EditorialColor.warningOrange,
                        fontSize = 11.5.sp,
                        lineHeight = 16.sp,
                    )
                }
            }

            Box(Modifier.fillMaxWidth().height(1.dp).background(Color.White.copy(alpha = 0.08f)))

            // 3. 朗读语速快捷调节
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("朗读语速", color = Color.White, fontSize = 13.5.sp, fontWeight = FontWeight.Medium)
                    Text(
                        "${speed}x",
                        color = EditorialColor.aiAmber,
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Monospace,
                    )
                }

                val speedOptions = floatArrayOf(0.75f, 1.0f, 1.25f, 1.5f, 2.0f)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    speedOptions.forEach { s ->
                        val isSelected = kotlin.math.abs(s - speed) < 0.06f
                        PillButton(
                            text = "${s}x",
                            isSelected = isSelected,
                            modifier = Modifier.weight(1f),
                            onClick = { onSpeedChange(s) },
                        )
                    }
                }
            }

            Box(Modifier.fillMaxWidth().height(1.dp).background(Color.White.copy(alpha = 0.08f)))

            // 4. 语调微调
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("音调微调", color = Color.White, fontSize = 13.5.sp, fontWeight = FontWeight.Medium)
                    val pitchDesc = when {
                        pitch < 0.95f -> "低沉"
                        pitch > 1.05f -> "清亮"
                        else -> "自然"
                    }
                    Text(
                        pitchDesc,
                        color = EditorialColor.aiAmber,
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    PillButton(
                        text = "低沉 0.85x",
                        isSelected = kotlin.math.abs(pitch - 0.85f) < 0.05f,
                        modifier = Modifier.weight(1f),
                        onClick = { onPitchChange(0.85f) },
                    )
                    PillButton(
                        text = "标准 1.0x",
                        isSelected = kotlin.math.abs(pitch - 1.0f) < 0.05f,
                        modifier = Modifier.weight(1f),
                        onClick = { onPitchChange(1.0f) },
                    )
                    PillButton(
                        text = "清亮 1.15x",
                        isSelected = kotlin.math.abs(pitch - 1.15f) < 0.05f,
                        modifier = Modifier.weight(1f),
                        onClick = { onPitchChange(1.15f) },
                    )
                }
            }

            Box(Modifier.fillMaxWidth().height(1.dp).background(Color.White.copy(alpha = 0.08f)))

            // 5. 磨耳朵自动翻卡停顿间隔
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("翻卡停顿间隔", color = Color.White, fontSize = 13.5.sp, fontWeight = FontWeight.Medium)
                    Text(
                        "${ambientGap} 秒",
                        color = EditorialColor.aiAmber,
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    PillButton(
                        text = "紧凑 0.8s",
                        isSelected = kotlin.math.abs(ambientGap - 0.8) < 0.1,
                        modifier = Modifier.weight(1f),
                        onClick = { onGapChange(0.8) },
                    )
                    PillButton(
                        text = "适中 1.5s",
                        isSelected = kotlin.math.abs(ambientGap - 1.5) < 0.1,
                        modifier = Modifier.weight(1f),
                        onClick = { onGapChange(1.5) },
                    )
                    PillButton(
                        text = "充裕 3.0s",
                        isSelected = kotlin.math.abs(ambientGap - 3.0) < 0.1,
                        modifier = Modifier.weight(1f),
                        onClick = { onGapChange(3.0) },
                    )
                }
            }

            Box(Modifier.fillMaxWidth().height(1.dp).background(Color.White.copy(alpha = 0.08f)))

            // 6. 睡眠定时器
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("睡眠定时", color = Color.White, fontSize = 13.5.sp, fontWeight = FontWeight.Medium)
                    Text(
                        if (sleepSeconds != null && sleepSeconds > 0) {
                            "剩余 ${formatDuration(sleepSeconds * 1000L)}" +
                                if (fadeVolume < 0.99f) " · 淡出中" else ""
                        } else "未开启",
                        color = if (sleepSeconds != null) EditorialColor.aiAmber else Color.White.copy(alpha = 0.45f),
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Monospace,
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    PillButton(
                        text = "关闭",
                        isSelected = sleepSeconds == null,
                        modifier = Modifier.weight(1f),
                        onClick = { onSleepTimerChange(0) },
                    )
                    PillButton(
                        text = "15 分钟",
                        isSelected = sleepSeconds != null && kotlin.math.abs(sleepSeconds - 900) < 60,
                        modifier = Modifier.weight(1f),
                        onClick = { onSleepTimerChange(15) },
                    )
                    PillButton(
                        text = "30 分钟",
                        isSelected = sleepSeconds != null && kotlin.math.abs(sleepSeconds - 1800) < 60,
                        modifier = Modifier.weight(1f),
                        onClick = { onSleepTimerChange(30) },
                    )
                    PillButton(
                        text = "60 分钟",
                        isSelected = sleepSeconds != null && kotlin.math.abs(sleepSeconds - 3600) < 60,
                        modifier = Modifier.weight(1f),
                        onClick = { onSleepTimerChange(60) },
                    )
                }
            }
        }
    }
}

@Composable
private fun PillButton(
    text: String,
    isSelected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(if (isSelected) EditorialColor.aiAmber else Color.White.copy(alpha = 0.07f))
            .border(
                1.dp,
                if (isSelected) EditorialColor.aiAmber else Color.White.copy(alpha = 0.12f),
                RoundedCornerShape(12.dp),
            )
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            color = if (isSelected) Color.Black else Color.White.copy(alpha = 0.8f),
            fontSize = 11.5.sp,
            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
            textAlign = TextAlign.Center,
        )
    }
}

private fun formatDuration(millis: Long): String {
    val totalSeconds = (millis / 1000).coerceAtLeast(0)
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    return String.format(Locale.US, "%02d:%02d", minutes, seconds)
}
