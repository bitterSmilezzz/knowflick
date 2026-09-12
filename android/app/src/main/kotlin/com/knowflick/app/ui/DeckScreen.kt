package com.knowflick.app.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.Bookmarks
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Sync
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.SwipeDirection
import kotlin.math.abs

/**
 * 沉浸刷卡界面：3 张可见卡堆 + 拖拽划走 + 磁吸回弹 + 底部意图按钮。
 *
 * 手势模型：输入追踪（rawDrag，同步更新）与渲染动画（offsetAnim，弹簧追赶）解耦，
 * 松手判定读取同步位移，杜绝「动画未追上输入」的竞态；划走的卡片进入独立飞出层
 * （与 macOS FlyingCardOverlay 同构），底层新顶卡从零位移就位。
 */
@Composable
fun DeckScreen(
    store: com.knowflick.app.domain.CardStore,
    version: Int,
    showAIMark: Boolean,
    onOpenDetail: (KnowledgeCard) -> Unit,
    onOpenStats: () -> Unit,
    onOpenFavorites: () -> Unit,
    onOpenSettings: () -> Unit = {},
    onGenerateRequest: () -> Unit = {},
    isGenerating: Boolean = false,
    notice: String? = null,
    modifier: Modifier = Modifier,
) {
    val haptics = androidx.compose.ui.platform.LocalHapticFeedback.current

    var rawDrag by remember { mutableStateOf(Offset.Zero) }
    var thresholdCrossed by remember { mutableStateOf(false) }
    var flyingCard by remember { mutableStateOf<KnowledgeCard?>(null) }
    var flyingDirection by remember { mutableStateOf<SwipeDirection?>(null) }
    var flyingStart by remember { mutableStateOf(Offset.Zero) }

    // 渲染层动画：把位移弹簧式逼近 rawDrag（输入与渲染解耦）
    val offsetAnim = remember { Animatable(Offset.Zero, Offset.VectorConverter) }
    LaunchedEffect(Unit) {
        while (true) {
            if (offsetAnim.value != rawDrag) {
                offsetAnim.animateTo(rawDrag, spring(stiffness = Spring.StiffnessMedium, dampingRatio = 0.85f))
            } else {
                kotlinx.coroutines.delay(16)
            }
        }
    }

    val topCard = store.topCard
    val stack = store.deck.take(3)

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
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Serif,
                )
                Spacer(Modifier.weight(1f))
                if (isGenerating) {
                    androidx.compose.material3.CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                }
                IconButton(onClick = {
                    if (!isGenerating) onGenerateRequest()
                }) {
                    Icon(Icons.Filled.AddCircle, contentDescription = "AI 生成新知识", tint = EditorialColor.aiAmber)
                }
                IconButton(onClick = onOpenFavorites) {
                    Icon(Icons.Filled.Bookmarks, contentDescription = "收藏阁", tint = MaterialTheme.colorScheme.onBackground)
                }
                IconButton(onClick = onOpenStats) {
                    Icon(Icons.Filled.BarChart, contentDescription = "学习统计", tint = MaterialTheme.colorScheme.onBackground)
                }
                IconButton(onClick = onOpenSettings) {
                    Icon(Icons.Filled.Settings, contentDescription = "AI 服务设置", tint = MaterialTheme.colorScheme.onBackground)
                }
                IconButton(onClick = {
                    topCard?.let { card ->
                        flyingCard = card
                        flyingDirection = SwipeDirection.SKIP
                        flyingStart = Offset.Zero
                        store.swipe(card, SwipeDirection.SKIP)
                    }
                }) {
                    Icon(Icons.Filled.Sync, contentDescription = "换一批", tint = MaterialTheme.colorScheme.onBackground)
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
                    // 底层卡：最深的先绘制；变换按真实堆叠位置计算
                    //（此前 asReversed 的索引被直接当作深度，导致最深卡全尺寸渲染、图章阶梯外漏）
                    stack.asReversed().forEachIndexed { reverseIndex, card ->
                        val position = stack.size - 1 - reverseIndex   // 0 = 顶卡
                        val isTop = position == 0
                        val depth = position
                        val layerAlpha = if (flyingCard != null && isTop) 0f else 1f
                        val cardModifier = if (isTop && flyingCard == null) {
                            Modifier
                                .fillMaxSize()
                                .testTag("deck_top_card")
                                .graphicsLayer {
                                    translationX = offsetAnim.value.x
                                    translationY = offsetAnim.value.y
                                    rotationZ = offsetAnim.value.x / 22f
                                }
                                .pointerInput(topCard.id) {
                                    detectDragGestures(
                                        onDragEnd = {
                                            if (abs(rawDrag.x) > 220f) {
                                                val direction = if (rawDrag.x > 0) SwipeDirection.RIGHT else SwipeDirection.LEFT
                                                // 划走的卡片移入飞出层；同步复位底层位移，新顶卡从零就位
                                                flyingCard = topCard
                                                flyingDirection = direction
                                                flyingStart = rawDrag
                                                store.swipe(topCard, direction)
                                                rawDrag = Offset.Zero
                                                thresholdCrossed = false
                                            } else {
                                                rawDrag = Offset.Zero
                                                thresholdCrossed = false
                                            }
                                        },
                                        onDragCancel = {
                                            rawDrag = Offset.Zero
                                            thresholdCrossed = false
                                        },
                                    ) { change, drag ->
                                        change.consume()
                                        rawDrag += drag
                                        val crossed = abs(rawDrag.x) > 260f && !thresholdCrossed
                                        if (crossed) {
                                            thresholdCrossed = true
                                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                        } else if (abs(rawDrag.x) < 200f) {
                                            thresholdCrossed = false
                                        }
                                    }
                                }
                        } else {
                            Modifier
                                .fillMaxSize()
                                .graphicsLayer {
                                    scaleX = 1f - depth * 0.028f
                                    scaleY = 1f - depth * 0.028f
                                    translationY = depth * 24f
                                    alpha = layerAlpha
                                }
                        }
                        CardFace(card = card, showAIMark = showAIMark, modifier = cardModifier, isTop = isTop)
                    }

                    // 飞出层：从划走时刻的位移出发，独立飞离淡出
                    flyingCard?.let { card ->
                        val start = flyingStart
                        val fly = remember(card.id) { Animatable(start, Offset.VectorConverter) }
                        LaunchedEffect(card.id) {
                            val direction = flyingDirection
                            val targetX = when (direction) {
                                SwipeDirection.LEFT -> -900f
                                SwipeDirection.RIGHT -> 900f
                                else -> start.x * 1.6f
                            }
                            val targetY = if (direction == SwipeDirection.SKIP) start.y else start.y + 90f
                            fly.animateTo(Offset(targetX, targetY), spring(stiffness = Spring.StiffnessMediumLow))
                            flyingCard = null
                            flyingDirection = null
                        }
                        Box(
                            Modifier
                                .fillMaxSize()
                                .graphicsLayer {
                                    translationX = fly.value.x
                                    translationY = fly.value.y
                                    alpha = (1f - (abs(fly.value.x) / 900f)).coerceIn(0f, 1f)
                                },
                        ) {
                            CardFace(card = card, showAIMark = showAIMark, Modifier.fillMaxSize(), isTop = true)
                        }
                    }
                }
            }

            if (notice != null) {
                Text(
                    notice,
                    color = EditorialColor.aiAmber,
                    fontSize = 11.sp,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
                )
            }
            // 底部意图按钮
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 44.dp, vertical = 14.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IntentButton(icon = Icons.Filled.Close, tint = EditorialColor.dislikeRed, label = "不喜欢") {
                    topCard?.let { card ->
                        flyingCard = card
                        flyingDirection = SwipeDirection.LEFT
                        flyingStart = Offset.Zero
                        store.swipe(card, SwipeDirection.LEFT)
                    }
                }
                IntentButton(
                    icon = if (topCard?.isFavorite == true) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                    tint = EditorialColor.likeGreen,
                    size = 54,
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
    size: Int = 48,
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
        Text(label, color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.55f), fontSize = 10.sp)
    }
}

@Composable
private fun EmptyState(onRestart: () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            "已刷完全部卡片",
            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.8f),
            fontSize = 18.sp,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.height(10.dp))
        Text(
            "换一批已读知识重新探索，或稍后配置 AI 生成新卡",
            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.45f),
            fontSize = 12.sp,
        )
        Spacer(Modifier.height(22.dp))
        TextButton(onClick = onRestart) {
            Text("重新探索全部卡片 ↻", color = EditorialColor.aiAmber, fontSize = 13.sp)
        }
    }
}
