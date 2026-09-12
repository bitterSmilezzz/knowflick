package com.knowflick.app.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Bookmarks
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.SwipeDirection
import kotlin.math.abs
import kotlinx.coroutines.launch

/**
 * 沉浸刷卡界面：3 张可见卡堆 + 拖拽划走 + 磁吸回弹 + 底部意图按钮。
 * 拖拽飞出阈值 300px（约 85pt 的 3x 缩放口径）；skip 由「换一批」表达，不计喜好。
 */
@Composable
fun DeckScreen(
    store: com.knowflick.app.domain.CardStore,
    version: Int,
    showAIMark: Boolean,
    onOpenDetail: (KnowledgeCard) -> Unit,
    onOpenStats: () -> Unit,
    onOpenFavorites: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val haptics = androidx.compose.ui.platform.LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val dragX = remember { Animatable(0f) }
    val dragY = remember { Animatable(0f) }
    var thresholdCrossed by remember { mutableStateOf(false) }
    var flyingCard by remember { mutableStateOf<KnowledgeCard?>(null) }
    var flyingDirection by remember { mutableStateOf<SwipeDirection?>(null) }

    val topCard = store.topCard
    val stack = store.deck.take(3)

    fun resetDrag() {
        thresholdCrossed = false
        scope.launch {
            dragX.animateTo(0f, spring(dampingRatio = Spring.DampingRatioMediumBouncy))
            dragY.animateTo(0f, spring(dampingRatio = Spring.DampingRatioMediumBouncy))
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        Column(Modifier.fillMaxSize()) {
            // 顶栏
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 18.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "KnowFlick",
                    color = EditorialColor.aiAmber,
                    fontSize = 19.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Serif,
                )
                Spacer(Modifier.weight(1f))
                IconButton(onClick = onOpenFavorites) {
                    Icon(Icons.Filled.Bookmarks, contentDescription = "收藏阁", tint = MaterialTheme.colorScheme.onBackground)
                }
                IconButton(onClick = onOpenStats) {
                    Icon(Icons.Filled.BarChart, contentDescription = "学习统计", tint = MaterialTheme.colorScheme.onBackground)
                }
                TextButton(onClick = {
                    topCard?.let { card ->
                        store.swipe(card, SwipeDirection.SKIP)
                    }
                }) {
                    Text("换一批", color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.7f), fontSize = 13.sp)
                }
            }

            // 卡堆
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = 22.dp),
                contentAlignment = Alignment.Center,
            ) {
                if (topCard == null) {
                    EmptyState(onRestart = { store.clearHistory() })
                } else {
                    // 底层两张静态卡（缩放 + 下移）
                    stack.asReversed().forEachIndexed { index, card ->
                        val isTop = index == 0
                        val depth = index
                        val layerAlpha = if (flyingCard != null && isTop) 0f else 1f
                        val cardModifier = if (isTop && flyingCard == null) {
                            Modifier
                                .fillMaxSize()
                                .graphicsLayer {
                                    translationX = dragX.value
                                    translationY = dragY.value
                                    rotationZ = dragX.value / 22f
                                }
                                .pointerInput(topCard.id) {
                                    detectDragGestures(
                                        onDragEnd = {
                                            if (abs(dragX.value) > 300f) {
                                                val direction = if (dragX.value > 0) SwipeDirection.RIGHT else SwipeDirection.LEFT
                                                store.swipe(topCard, direction)
                                            }
                                            resetDrag()
                                        },
                                        onDragCancel = { resetDrag() },
                                    ) { change, drag ->
                                        change.consume()
                                        scope.launch {
                                            dragX.animateTo(dragX.value + drag.x, spring(stiffness = Spring.StiffnessHigh))
                                            dragY.animateTo(dragY.value + drag.y, spring(stiffness = Spring.StiffnessHigh))
                                        }
                                        val crossed = abs(dragX.value) > 260f && !thresholdCrossed
                                        if (crossed) {
                                            thresholdCrossed = true
                                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                        } else if (abs(dragX.value) < 200f) {
                                            thresholdCrossed = false
                                        }
                                    }
                                }
                        } else {
                            Modifier
                                .fillMaxSize()
                                .graphicsLayer {
                                    scaleX = 1f - depth * 0.045f
                                    scaleY = 1f - depth * 0.045f
                                    translationY = depth * 46f
                                    alpha = layerAlpha
                                }
                        }
                        CardFace(card = card, showAIMark = showAIMark, modifier = cardModifier, isTop = isTop)
                    }

                    // 飞出层：底层顶卡透明后，划走的卡片独立飞离淡出
                    flyingCard?.let { card ->
                        val direction = flyingDirection
                        LaunchedEffect(card.id) {
                            val target = if (direction == SwipeDirection.LEFT) -900f else 900f
                            val drift = if (direction == SwipeDirection.SKIP) 0f else 90f
                            dragY.snapTo(drift)
                            dragX.animateTo(target, spring(stiffness = Spring.StiffnessMediumLow))
                            flyingCard = null
                            flyingDirection = null
                            dragX.snapTo(0f)
                            dragY.snapTo(0f)
                        }
                        Box(
                            Modifier
                                .fillMaxSize()
                                .graphicsLayer {
                                    translationX = dragX.value
                                    translationY = dragY.value
                                    alpha = (1f - (abs(dragX.value) / 900f)).coerceIn(0f, 1f)
                                },
                        ) {
                            CardFace(card = card, showAIMark = showAIMark, Modifier.fillMaxSize(), isTop = true)
                        }
                    }
                }
            }

            // 底部意图按钮
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 40.dp, vertical = 18.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IntentButton(icon = Icons.Filled.Close, tint = EditorialColor.dislikeRed, label = "不喜欢") {
                    topCard?.let { store.swipe(it, SwipeDirection.LEFT) }
                }
                IntentButton(
                    icon = if (topCard?.isFavorite == true) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                    tint = EditorialColor.likeGreen,
                    size = 62,
                    label = "收藏",
                ) {
                    topCard?.let { store.toggleFavorite(it) }
                }
                IntentButton(icon = Icons.AutoMirrored.Filled.ArrowForward, tint = MaterialTheme.colorScheme.onBackground, label = "详情") {
                    topCard?.let(onOpenDetail)
                }
            }
        }
    }
}

@Composable
private fun IntentButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    tint: androidx.compose.ui.graphics.Color,
    size: Int = 56,
    label: String,
    onClick: () -> Unit,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        IconButton(
            onClick = onClick,
            modifier = Modifier
                .size(size.dp)
                .background(MaterialTheme.colorScheme.surface, CircleShape),
        ) {
            Icon(icon, contentDescription = label, tint = tint)
        }
        Spacer(Modifier.height(4.dp))
        Text(label, color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.55f), fontSize = 11.sp)
    }
}

@Composable
private fun EmptyState(onRestart: () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
    ) {
        Text(
            "已刷完全部卡片",
            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.8f),
            fontSize = 20.sp,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.height(10.dp))
        Text(
            "换一批已读知识重新探索，或稍后配置 AI 生成新卡",
            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.45f),
            fontSize = 13.sp,
        )
        Spacer(Modifier.height(22.dp))
        TextButton(onClick = onRestart) {
            Text("重新探索全部卡片 ↻", color = EditorialColor.aiAmber, fontSize = 14.sp)
        }
    }
}
