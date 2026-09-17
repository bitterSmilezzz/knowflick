package com.knowflick.app.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.speech.SpeechController

/**
 * 悬浮灵动 Mini Player 播放条 (Ambient Audio Player Bar)。
 * 对齐 macOS AmbientAudioPlayerBar 设计规范与交互手感：
 * 1. 悬浮暗黑毛玻璃胶囊形态；
 * 2. 动态声浪波形条 (AudioWaveformBars)；
 * 3. 实时卡片标题与百分比进度；
 * 4. 上一张 / 播放暂停 / 下一张 / 语速循环快捷操作；
 * 5. 点击主体展开全功能语音控制台 (AudioConsoleSheet)。
 */
@Composable
fun AmbientAudioPlayerBar(
    controller: SpeechController,
    onOpenConsole: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val card = controller.currentCard
    val isVisible = card != null && (controller.isSpeaking || controller.isPaused || controller.isAmbientMode)

    AnimatedVisibility(
        visible = isVisible,
        enter = slideInVertically(initialOffsetY = { it }) + fadeIn(),
        exit = slideOutVertically(targetOffsetY = { it }) + fadeOut(),
        modifier = modifier,
    ) {
        if (card == null) return@AnimatedVisibility

        val isSpeaking = controller.isSpeaking
        val progress = controller.playbackProgress
        val speed = controller.playbackSpeed

        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 6.dp)
                .shadow(16.dp, RoundedCornerShape(26.dp))
                .clip(RoundedCornerShape(26.dp))
                .border(1.dp, Color.White.copy(alpha = 0.16f), RoundedCornerShape(26.dp))
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onOpenConsole,
                ),
            color = Color(0xF216171C),
            shape = RoundedCornerShape(26.dp),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // 1. 声浪柱与模式徽标
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    AudioWaveformBars(isPlaying = isSpeaking)

                    val badgeText = if (controller.isAmbientMode) "磨耳朵" else card.category
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(10.dp))
                            .background(EditorialColor.aiAmber.copy(alpha = 0.15f))
                            .border(1.dp, EditorialColor.aiAmber.copy(alpha = 0.35f), RoundedCornerShape(10.dp))
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                    ) {
                        Text(
                            text = badgeText,
                            color = EditorialColor.aiAmber,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }

                Spacer(Modifier.width(8.dp))

                // 2. 当前标题与进度
                Row(
                    modifier = Modifier.weight(1f),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = card.headline,
                        color = Color.White,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        fontFamily = FontFamily.Serif,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )

                    Spacer(Modifier.width(4.dp))

                    Text(
                        text = "${(progress * 100).toInt()}%",
                        color = Color.White.copy(alpha = 0.55f),
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Monospace,
                    )
                }

                Spacer(Modifier.width(6.dp))

                // 3. 播控按钮组 (上一首 / 播放暂停 / 下一首 / 语速 / 关闭)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    // 上一张 (仅磨耳朵或有历史时可用)
                    IconButton(
                        onClick = { controller.advancePrevious() },
                        enabled = controller.onAdvancePreviousRequest != null,
                        modifier = Modifier.size(28.dp),
                    ) {
                        Icon(
                            imageVector = AppIcons.SkipPrevious,
                            contentDescription = "上一张",
                            tint = if (controller.onAdvancePreviousRequest != null) Color.White.copy(alpha = 0.8f) else Color.White.copy(alpha = 0.25f),
                            modifier = Modifier.size(16.dp),
                        )
                    }

                    // 播放 / 暂停 (核心大圆纽)
                    Box(
                        modifier = Modifier
                            .size(32.dp)
                            .shadow(6.dp, CircleShape)
                            .clip(CircleShape)
                            .background(EditorialColor.aiAmber)
                            .clickable { controller.togglePlayPause(card) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = if (isSpeaking) AppIcons.Pause else AppIcons.PlayArrow,
                            contentDescription = if (isSpeaking) "暂停" else "继续播放",
                            tint = Color.Black,
                            modifier = Modifier.size(18.dp),
                        )
                    }

                    // 下一张
                    IconButton(
                        onClick = { controller.advanceNext() },
                        modifier = Modifier.size(28.dp),
                    ) {
                        Icon(
                            imageVector = AppIcons.SkipNext,
                            contentDescription = "下一张",
                            tint = Color.White.copy(alpha = 0.8f),
                            modifier = Modifier.size(16.dp),
                        )
                    }

                    // 语速切换胶囊 (0.75x -> 1.0x -> 1.25x -> 1.5x -> 2.0x)
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .background(Color.White.copy(alpha = 0.08f))
                            .border(1.dp, Color.White.copy(alpha = 0.15f), RoundedCornerShape(12.dp))
                            .clickable { controller.cycleSpeed() }
                            .padding(horizontal = 6.dp, vertical = 3.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = formatSpeedText(speed),
                            color = EditorialColor.aiAmber,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace,
                        )
                    }

                    // 退出/停止
                    IconButton(
                        onClick = { controller.stop() },
                        modifier = Modifier.size(24.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Filled.Close,
                            contentDescription = "关闭",
                            tint = Color.White.copy(alpha = 0.5f),
                            modifier = Modifier.size(14.dp),
                        )
                    }
                }
            }
        }
    }
}

/**
 * 动效声浪条 (Audio Waveform Bars)。
 * 5 根竖条，播放时实时波浪律动，暂停时静止回缩至 4dp 基准线。
 */
@Composable
fun AudioWaveformBars(
    isPlaying: Boolean,
    modifier: Modifier = Modifier,
) {
    val transition = rememberInfiniteTransition(label = "waveform")
    val animPhase1 by transition.animateFloat(
        initialValue = 0.3f,
        targetValue = 1.0f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 380, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "bar1",
    )
    val animPhase2 by transition.animateFloat(
        initialValue = 0.8f,
        targetValue = 0.2f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 440, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "bar2",
    )
    val animPhase3 by transition.animateFloat(
        initialValue = 0.4f,
        targetValue = 0.95f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 320, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "bar3",
    )
    val animPhase4 by transition.animateFloat(
        initialValue = 0.7f,
        targetValue = 0.3f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 410, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "bar4",
    )
    val animPhase5 by transition.animateFloat(
        initialValue = 0.25f,
        targetValue = 0.85f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 360, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "bar5",
    )

    val ratios = if (isPlaying) {
        floatArrayOf(animPhase1, animPhase2, animPhase3, animPhase4, animPhase5)
    } else {
        floatArrayOf(0.25f, 0.25f, 0.25f, 0.25f, 0.25f)
    }

    Row(
        modifier = modifier.height(18.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ratios.forEach { ratio ->
            val barHeight = (4.dp + (14.dp * ratio)).coerceIn(4.dp, 18.dp)
            Box(
                modifier = Modifier
                    .width(2.5.dp)
                    .height(barHeight)
                    .clip(RoundedCornerShape(1.5.dp))
                    .background(EditorialColor.likeGreen),
            )
        }
    }
}

private fun formatSpeedText(speed: Float): String = when {
    kotlin.math.abs(speed - 0.75f) < 0.05f -> "0.75x"
    kotlin.math.abs(speed - 1.0f) < 0.05f -> "1.0x"
    kotlin.math.abs(speed - 1.25f) < 0.05f -> "1.25x"
    kotlin.math.abs(speed - 1.5f) < 0.05f -> "1.5x"
    kotlin.math.abs(speed - 2.0f) < 0.05f -> "2.0x"
    else -> String.format(java.util.Locale.US, "%.1fx", speed)
}
