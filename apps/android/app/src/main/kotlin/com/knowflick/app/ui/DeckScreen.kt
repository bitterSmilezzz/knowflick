package com.knowflick.app.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutLinearInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.MoreVert
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
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.domain.CardThemeResolver
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.SwipeDirection
import kotlin.math.abs
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** 划出判定阈值（dp）：约屏宽 20%，跨密度设备手感一致 */
private const val SWIPE_THRESHOLD_DP = 80f

/** 阈值回滞比例：回拖到阈值的 82% 以下才复位「已越过」标记，避免临界抖动 */
private const val THRESHOLD_HYSTERESIS_RATIO = 0.82f

/** 拖动位移 → 旋转角的除数（dp）：位移约 10dp 转 1° */
private const val ROTATION_DIVISOR_DP = 10f

/**
 * 沉浸刷卡界面：3 张可见卡堆 + 拖拽划走 + 磁吸回弹 + 底部意图按钮。
 *
 * 手势模型：拖动时直接读取 rawDrag，让卡片逐帧贴住手指；只有未达到阈值的松手才播放
 * 回弹。划走卡片进入独立飞出层，新顶卡在其下方同步显示，且每张卡按 id 保持组合身份。
 */
@Composable
fun DeckScreen(
    store: com.knowflick.app.domain.CardStore,
    /**
     * 待刷卡堆的显式快照。必须由调用方按 [version] 传入，不能用 store.deck 就地读取：
     * 卡堆是普通可变属性，Compose 观察不到它的变化；只有把内容作为参数传进来，
     * 参数比较才会发现差异并触发重组（否则「重新探索全部卡片」这类整表重置不会刷新界面）。
     */
    deck: List<KnowledgeCard>,
    version: Int,
    showAIMark: Boolean,
    onOpenDetail: (KnowledgeCard) -> Unit,
    onOpenStats: () -> Unit,
    onOpenFavorites: () -> Unit,
    onMutate: (() -> Unit) -> Unit,
    modifier: Modifier = Modifier,
    onOpenSettings: () -> Unit = {},
    onOpenQuiz: () -> Unit = {},
    onGenerateRequest: () -> Unit = {},
    isGenerating: Boolean = false,
    notice: String? = null,
    isAmbientMode: Boolean = false,
    onToggleAmbient: () -> Unit = {},
    /** 是否可撤销上一次刷卡（历史快照存在时为 true） */
    canUndo: Boolean = false,
    onUndo: () -> Unit = {},
) {
    val haptics = LocalHapticFeedback.current

    // 跨设备一致的手势标尺：全部由 dp 推导，与设备像素密度无关
    // （此前硬编码 220px/180px/28px：3.5x 密度机上阈值仅约 63dp，2x 机上却要划 110dp）
    val density = LocalDensity.current
    val swipeThresholdPx = with(density) { SWIPE_THRESHOLD_DP.dp.toPx() }
    val hysteresisPx = swipeThresholdPx * THRESHOLD_HYSTERESIS_RATIO
    val rotationDivisorPx = with(density) { ROTATION_DIVISOR_DP.dp.toPx() }
    // 飞出层宽度兜底：deckWidthPx 尚未测量时（防御分支）用屏宽，而非硬编码 900px
    val screenWidthPx = with(density) { LocalConfiguration.current.screenWidthDp.dp.toPx() }

    var rawDrag by remember { mutableStateOf(Offset.Zero) }
    var thresholdCrossed by remember { mutableStateOf(false) }
    var flyingCard by remember { mutableStateOf<KnowledgeCard?>(null) }
    var flyingDirection by remember { mutableStateOf<SwipeDirection?>(null) }
    var flyingStart by remember { mutableStateOf(Offset.Zero) }
    var deckWidthPx by remember { mutableIntStateOf(0) }

    val gestureScope = rememberCoroutineScope()
    val returnAnim = remember { Animatable(Offset.Zero, Offset.VectorConverter) }
    var isReturning by remember { mutableStateOf(false) }
    var returnJob by remember { mutableStateOf<Job?>(null) }

    fun returnToCenter() {
        val start = rawDrag
        thresholdCrossed = false
        returnJob?.cancel()
        returnJob = gestureScope.launch {
            returnAnim.snapTo(start)
            isReturning = true
            rawDrag = Offset.Zero
            try {
                returnAnim.animateTo(
                    Offset.Zero,
                    spring(stiffness = Spring.StiffnessMediumLow, dampingRatio = 0.78f),
                )
            } finally {
                isReturning = false
            }
        }
    }

    val topCard = deck.firstOrNull()
    val stack = deck.take(3)

    // 卡堆被划空时飞出层会被移出组合，其清理协程随之取消；这里兜住残留状态，
    // 否则重新探索后旧卡会作为飞出层重新入场。
    LaunchedEffect(topCard, deck.size) {
        if (deck.isEmpty() && flyingCard != null) {
            flyingCard = null
            flyingDirection = null
            flyingStart = Offset.Zero
            rawDrag = Offset.Zero
            thresholdCrossed = false
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
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = EditorialColor.aiAmber,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Serif,
                )
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
                    Icon(AppIcons.Bookmarks, contentDescription = "收藏阁", tint = MaterialTheme.colorScheme.onBackground)
                }
                var showMore by remember { mutableStateOf(false) }
                Box {
                    IconButton(onClick = { showMore = true }) {
                        Icon(Icons.Filled.MoreVert, contentDescription = "更多", tint = MaterialTheme.colorScheme.onBackground)
                    }
                    androidx.compose.material3.DropdownMenu(expanded = showMore, onDismissRequest = { showMore = false }) {
                        androidx.compose.material3.DropdownMenuItem(
                            text = { Text("撤销上一张", fontSize = 13.sp) },
                            enabled = canUndo,
                            onClick = { showMore = false; onUndo() },
                        )
                        androidx.compose.material3.DropdownMenuItem(
                            text = { Text("知识测验", fontSize = 13.sp) },
                            onClick = { showMore = false; onOpenQuiz() },
                        )
                        androidx.compose.material3.DropdownMenuItem(
                            text = { Text("学习统计", fontSize = 13.sp) },
                            onClick = { showMore = false; onOpenStats() },
                        )
                        androidx.compose.material3.DropdownMenuItem(
                            text = { Text("AI 服务设置", fontSize = 13.sp) },
                            onClick = { showMore = false; onOpenSettings() },
                        )
                    }
                }
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (isAmbientMode) EditorialColor.aiAmber.copy(alpha = 0.16f) else androidx.compose.ui.graphics.Color.Transparent)
                        .border(
                            1.dp,
                            if (isAmbientMode) EditorialColor.aiAmber.copy(alpha = 0.40f) else androidx.compose.ui.graphics.Color.Transparent,
                            RoundedCornerShape(12.dp),
                        ),
                ) {
                    IconButton(onClick = onToggleAmbient) {
                        Icon(
                            AppIcons.Headphones,
                            contentDescription = if (isAmbientMode) "退出磨耳朵" else "磨耳朵连续朗读",
                            tint = if (isAmbientMode) EditorialColor.aiAmber else MaterialTheme.colorScheme.onBackground,
                        )
                    }
                }
                IconButton(onClick = {
                    topCard?.let { card ->
                        flyingCard = card
                        flyingDirection = SwipeDirection.SKIP
                        flyingStart = Offset.Zero
                        onMutate { store.swipe(card, SwipeDirection.SKIP) }
                    }
                }) {
                    Icon(AppIcons.Sync, contentDescription = "换一批", tint = MaterialTheme.colorScheme.onBackground)
                }
            }

            // 卡堆
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = 22.dp)
                    .onSizeChanged { deckWidthPx = it.width },
                contentAlignment = Alignment.Center,
            ) {
                if (topCard == null) {
                    EmptyState(onRestart = { onMutate { store.clearHistory() } })
                } else {
                    // 底层卡：最深的先绘制；变换按真实堆叠位置计算
                    //（此前 asReversed 的索引被直接当作深度，导致最深卡全尺寸渲染、图章阶梯外漏）
                    stack.asReversed().forEachIndexed { reverseIndex, card ->
                        val position = stack.size - 1 - reverseIndex   // 0 = 顶卡
                        val isTop = position == 0
                        val depth = position
                        key(card.id) {
                            var cardModifier = Modifier
                                .fillMaxSize()
                                .graphicsLayer {
                                    if (isTop) {
                                        val drag = if (isReturning) returnAnim.value else rawDrag
                                        translationX = drag.x
                                        translationY = drag.y
                                        rotationZ = (drag.x / rotationDivisorPx).coerceIn(-14f, 14f)
                                    } else {
                                        // 手指接近划走阈值时，下一张同步升到顶层，释放瞬间不会跳变。
                                        val reveal = if (!isReturning && flyingCard == null) {
                                            (abs(rawDrag.x) / swipeThresholdPx).coerceIn(0f, 1f)
                                        } else {
                                            0f
                                        }
                                        val visualDepth = (depth - reveal).coerceAtLeast(0f)
                                        scaleX = 1f - visualDepth * 0.028f
                                        scaleY = 1f - visualDepth * 0.028f
                                        translationY = visualDepth * 24f
                                    }
                                }

                            if (isTop) {
                                cardModifier = cardModifier.testTag("deck_top_card")
                            }
                            if (isTop && flyingCard == null) {
                                cardModifier = cardModifier
                                    .clickable(onClickLabel = "查看详情") { onOpenDetail(card) }
                                    .pointerInput(card.id) {
                                        detectDragGestures(
                                            onDragStart = {
                                                val current = if (isReturning) returnAnim.value else rawDrag
                                                returnJob?.cancel()
                                                isReturning = false
                                                rawDrag = current
                                            },
                                            onDragEnd = {
                                                if (abs(rawDrag.x) > swipeThresholdPx) {
                                                    val direction = if (rawDrag.x > 0) SwipeDirection.RIGHT else SwipeDirection.LEFT
                                                    returnJob?.cancel()
                                                    isReturning = false
                                                    // 旧卡从手指释放位置继续飞出；新顶卡立即在下方显示。
                                                    flyingCard = card
                                                    flyingDirection = direction
                                                    flyingStart = rawDrag
                                                    onMutate { store.swipe(card, direction) }
                                                    rawDrag = Offset.Zero
                                                    thresholdCrossed = false
                                                } else {
                                                    returnToCenter()
                                                }
                                            },
                                            onDragCancel = {
                                                returnToCenter()
                                            },
                                        ) { change, drag ->
                                            change.consume()
                                            rawDrag += drag
                                            val crossed = abs(rawDrag.x) > swipeThresholdPx && !thresholdCrossed
                                            if (crossed) {
                                                thresholdCrossed = true
                                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                            } else if (abs(rawDrag.x) < hysteresisPx) {
                                                thresholdCrossed = false
                                            }
                                        }
                                    }
                            }
                            if (depth >= 2) {
                                // 最深卡只露出边缘：预解码下一张图，但不绘制整张大图、渐变和文字。
                                PreloadBackgroundImage(CardThemeResolver.forCard(card))
                                Box(
                                    cardModifier
                                        .clip(RoundedCornerShape(20.dp))
                                        .background(MaterialTheme.colorScheme.surface),
                                )
                            } else {
                                val currentDragX = if (isReturning) returnAnim.value.x else rawDrag.x
                                val swipeProgress = if (isTop && flyingCard == null) (currentDragX / swipeThresholdPx).coerceIn(-1f, 1f) else 0f
                                CardFace(
                                    card = card,
                                    showAIMark = showAIMark,
                                    modifier = cardModifier,
                                    isTop = isTop,
                                    swipeProgress = swipeProgress,
                                )
                            }
                        }
                    }

                    // 飞出层：从划走时刻的位移出发，独立飞离淡出
                    flyingCard?.let { card ->
                        val start = flyingStart
                        // 卡片宽度已测量则用实测值；未测量时（防御分支）退回屏宽，不再硬编码 900px
                        val renderWidthPx = if (deckWidthPx > 0) deckWidthPx.toFloat() else screenWidthPx
                        val fly = remember(card.id) { Animatable(start, Offset.VectorConverter) }
                        LaunchedEffect(card.id) {
                            val direction = flyingDirection
                            val width = renderWidthPx
                            val targetX = when (direction) {
                                SwipeDirection.LEFT -> -width * 1.15f
                                SwipeDirection.RIGHT -> width * 1.15f
                                SwipeDirection.SKIP, null -> width * 0.85f
                            }
                            val targetY = if (direction == SwipeDirection.SKIP) start.y else start.y + 90f
                            fly.animateTo(
                                Offset(targetX, targetY),
                                tween(durationMillis = 180, easing = FastOutLinearInEasing),
                            )
                            if (flyingCard?.id == card.id) {
                                flyingCard = null
                                flyingDirection = null
                            }
                        }
                        Box(
                            Modifier
                                .fillMaxSize()
                                .graphicsLayer {
                                    translationX = fly.value.x
                                    translationY = fly.value.y
                                    rotationZ = (fly.value.x / rotationDivisorPx).coerceIn(-18f, 18f)
                                    val travel = abs(fly.value.x - start.x)
                                    val total = abs(
                                        when (flyingDirection) {
                                            SwipeDirection.LEFT -> -renderWidthPx * 1.15f
                                            SwipeDirection.RIGHT -> renderWidthPx * 1.15f
                                            SwipeDirection.SKIP, null -> renderWidthPx * 0.85f
                                        } - start.x,
                                    ).coerceAtLeast(1f)
                                    // 旧卡在退场前半程淡出，避免 GPU 忙时它长时间盖住新顶卡，
                                    // 造成“切换后又闪回上一张”的观感。
                                    alpha = (1f - travel / (total * 0.55f)).coerceIn(0f, 1f)
                                },
                        ) {
                            CardFace(card = card, showAIMark = showAIMark, Modifier.fillMaxSize(), isTop = true, swipeProgress = 0f)
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
                    .padding(horizontal = 40.dp, vertical = 14.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IntentButton(
                    icon = Icons.Filled.Close,
                    tint = EditorialColor.dislikeRed,
                    size = 50,
                    label = "不喜欢",
                ) {
                    topCard?.let { card ->
                        flyingCard = card
                        flyingDirection = SwipeDirection.LEFT
                        flyingStart = Offset.Zero
                        onMutate { store.swipe(card, SwipeDirection.LEFT) }
                    }
                }
                IntentButton(
                    icon = if (topCard?.isFavorite == true) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                    tint = EditorialColor.likeGreen,
                    size = 58,
                    label = "收藏",
                    pulseTrigger = topCard?.isFavorite == true,
                ) {
                    topCard?.let { card -> onMutate { store.toggleFavorite(card) } }
                }
                IntentButton(
                    icon = Icons.AutoMirrored.Filled.ArrowForward,
                    tint = MaterialTheme.colorScheme.onBackground,
                    size = 50,
                    label = "详情",
                ) {
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
    size: Int = 50,
    label: String,
    pulseTrigger: Boolean = false,
    onClick: () -> Unit,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val isPressed by interactionSource.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (isPressed) 0.88f else 1.0f,
        animationSpec = spring(stiffness = Spring.StiffnessMedium, dampingRatio = 0.65f),
        label = "btnScale",
    )
    val pulseScale = remember { Animatable(1f) }
    LaunchedEffect(pulseTrigger) {
        if (pulseTrigger) {
            pulseScale.snapTo(1f)
            pulseScale.animateTo(
                1.26f,
                spring(stiffness = Spring.StiffnessHigh, dampingRatio = 0.5f),
            )
            pulseScale.animateTo(
                1.0f,
                spring(stiffness = Spring.StiffnessMedium, dampingRatio = 0.7f),
            )
        }
    }

    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            modifier = Modifier
                .size(size.dp)
                .scale(scale * pulseScale.value)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surface)
                .border(1.dp, MaterialTheme.colorScheme.onBackground.copy(alpha = 0.08f), CircleShape)
                .clickable(
                    interactionSource = interactionSource,
                    indication = androidx.compose.material3.ripple(bounded = true),
                    onClick = onClick,
                ),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                icon,
                contentDescription = label,
                tint = tint,
                modifier = Modifier.size((size * 0.48f).dp),
            )
        }
        Spacer(Modifier.height(5.dp))
        Text(
            label,
            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.60f),
            fontSize = 10.5.sp,
            fontWeight = FontWeight.Medium,
        )
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
