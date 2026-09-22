package com.knowflick.app.ui.graph

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroidSize
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.ui.unit.IntSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.SubjectRegistry
import com.knowflick.app.domain.graph.GraphBounds
import com.knowflick.app.domain.graph.GraphNode
import com.knowflick.app.domain.graph.KnowledgeGraphData
import com.knowflick.app.domain.graph.KnowledgeGraphEngine
import com.knowflick.app.domain.graph.RelationKind
import com.knowflick.app.ui.EditorialColor
import com.knowflick.app.ui.common.AudioEffectHelper
import com.knowflick.app.ui.common.HapticFeedbackHelper
import kotlin.math.abs
import kotlin.math.hypot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 知识全景星图交互界面 (Interactive Knowledge Graph Screen)
 */
@Composable
fun KnowledgeGraphScreen(
    cards: List<KnowledgeCard>,
    onBack: () -> Unit,
    onSelectCard: (KnowledgeCard) -> Unit,
    onPromoteToTop: (KnowledgeCard) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    var graphData by remember { mutableStateOf(KnowledgeGraphData(emptyList(), emptyList())) }
    var selectedNode by remember { mutableStateOf<GraphNode?>(null) }
    var shard by remember { mutableStateOf<GraphShard>(GraphShard.All) }
    var searchQuery by remember { mutableStateOf("") }
    var showSearch by remember { mutableStateOf(false) }

    // 视口变换：刻意**不放进组合状态**。手势每帧写它，只让画布重绘，不触发整棵 Composable 树重组。
    val viewport = remember { GraphViewport() }

    // 已建图的拓扑签名：划卡/收藏/复习只换 cards 数组，拓扑不变时既不建图也不赋值
    var builtSignature by remember { mutableLongStateOf(0L) }

    // 分片输入：默认只看一个学科（构图成本 ~O(n²)，全库 2400 张要 18s，一个学科 <1.5s）
    val shardCards = remember(cards, shard) { shard.select(cards) }

    // 异步构建星图拓扑
    LaunchedEffect(shardCards) {
        val snapshot = shardCards.toList()
        val signature = withContext(Dispatchers.Default) {
            KnowledgeGraphEngine.graphSignature(snapshot, GRAPH_WORLD_SIZE, GRAPH_WORLD_SIZE)
        }
        if (signature == builtSignature) return@LaunchedEffect
        builtSignature = signature
        graphData = withContext(Dispatchers.Default) {
            KnowledgeGraphEngine.buildGraph(snapshot, width = GRAPH_WORLD_SIZE, height = GRAPH_WORLD_SIZE)
        }
        selectedNode = null
    }

    val cardMap = remember(cards) { cards.associateBy { it.id } }
    val shards = remember(cards) { SubjectRegistry.subjectSummaries(cards) }

    // 逐帧只读数组的扁平布局：世界坐标、预取色、预截断标签、边的下标对
    val layout = remember(graphData) { GraphLayout(graphData) }
    val labelPaint = remember { android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG) }

    // 分类 + 检索词的命中掩码：逐帧 contains 会让每根手指移动都跑一遍字符串比较
    val matched = remember(searchQuery, layout) { layout.matchedFlags(searchQuery) }
    // 与选中节点相连的节点掩码
    val connected = remember(selectedNode, layout) { layout.connectivityFlags(selectedNode?.cardId) }

    var canvasSize by remember { mutableStateOf(IntSize.Zero) }

    // 换片 / 首次量到尺寸后自适应
    LaunchedEffect(graphData, canvasSize) {
        if (graphData.nodes.isEmpty() || canvasSize == IntSize.Zero) return@LaunchedEffect
        viewport.setViewportSize(canvasSize.width.toFloat(), canvasSize.height.toFloat())
        viewport.fitTo(KnowledgeGraphEngine.boundsOf(graphData.nodes))
    }

    val isDark = MaterialTheme.colorScheme.background.red < 0.2f
    val bgColor = MaterialTheme.colorScheme.background
    val glowBrush = remember(isDark) {
        Brush.radialGradient(
            colors = listOf(
                EditorialColor.aiAmber.copy(alpha = if (isDark) 0.08f else 0.04f),
                Color.Transparent,
            ),
            center = Offset(GRAPH_WORLD_CENTER, GRAPH_WORLD_CENTER),
            radius = 450f,
        )
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(bgColor)
    ) {
        // 主画布区（手势变换与星图渲染）
        Box(
            modifier = Modifier
                .fillMaxSize()
                .onSizeChanged { canvasSize = it }
                .semantics {
                    contentDescription = "知识星图画布，共 ${graphData.nodes.size} 个知识节点；可双指缩放、拖动，轻点节点查看详情"
                }
                .pointerInput(layout) {
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        var zoom = 1f
                        var pan = Offset.Zero
                        var pastTouchSlop = false
                        val touchSlop = viewConfiguration.touchSlop

                        do {
                            val event = awaitPointerEvent()
                            val canceled = event.changes.any { it.isConsumed }
                            if (!canceled) {
                                val zoomChange = event.calculateZoom()
                                val panChange = event.calculatePan()

                                if (!pastTouchSlop) {
                                    zoom *= zoomChange
                                    pan += panChange
                                    val centroidSize = event.calculateCentroidSize(useCurrent = false)
                                    val zoomMotion = abs(1 - zoom) * centroidSize
                                    val panMotion = pan.getDistance()

                                    if (zoomMotion > touchSlop || panMotion > touchSlop) {
                                        pastTouchSlop = true
                                    }
                                }

                                if (pastTouchSlop && (zoomChange != 1f || panChange != Offset.Zero)) {
                                    viewport.transformBy(zoomChange, panChange)
                                    event.changes.forEach { it.consume() }
                                }
                            }
                        } while (event.changes.any { it.pressed })

                        if (!pastTouchSlop) {
                            // 轻点触达节点：屏幕坐标反算世界坐标后取最近节点
                            val hit = layout.nodeAt(
                                tapX = down.position.x,
                                tapY = down.position.y,
                                scale = viewport.scale,
                                panX = viewport.panX,
                                panY = viewport.panY,
                                viewWidth = size.width.toFloat(),
                                viewHeight = size.height.toFloat(),
                            )
                            if (hit >= 0) {
                                HapticFeedbackHelper.click(context)
                                AudioEffectHelper.playClick(context)
                                selectedNode = graphData.nodes[hit]
                            } else {
                                selectedNode = null
                            }
                        }
                    }
                }
        ) {
            Canvas(modifier = Modifier.fillMaxSize()) {
                // 读视口状态只发生在本 lambda 内：手势期间仅重绘这张画布
                val scale = viewport.scale
                val panX = viewport.panX
                val panY = viewport.panY

                // 世界→屏幕一次性写进画布变换，节点与连线全程按世界坐标绘制
                val tx = size.width / 2f + panX - GRAPH_WORLD_CENTER * scale
                val ty = size.height / 2f + panY - GRAPH_WORLD_CENTER * scale
                val left = -tx / scale - GRAPH_CULL_MARGIN
                val right = (size.width - tx) / scale + GRAPH_CULL_MARGIN
                val top = -ty / scale - GRAPH_CULL_MARGIN
                val bottom = (size.height - ty) / scale + GRAPH_CULL_MARGIN

                val canvasHandle = drawContext.canvas
                canvasHandle.save()
                canvasHandle.translate(tx, ty)
                canvasHandle.scale(scale, scale)

                // 背景微弱放射光芒（画刷按 isDark 缓存，不再每帧重建 shader 与颜色表）
                drawCircle(brush = glowBrush, radius = 450f, center = Offset(GRAPH_WORLD_CENTER, GRAPH_WORLD_CENTER))

                val selectedIndex = layout.indexOfCard(selectedNode?.cardId)

                // 引力光索
                for (e in layout.edges.indices) {
                    val src = layout.edgeSrc[e]
                    val dst = layout.edgeDst[e]
                    if (src < 0 || dst < 0) continue

                    val srcX = layout.xs[src]
                    val srcY = layout.ys[src]
                    val dstX = layout.xs[dst]
                    val dstY = layout.ys[dst]

                    // 视口剔除：两端都在视野同一侧则跳过
                    if ((srcX < left && dstX < left) || (srcX > right && dstX > right) ||
                        (srcY < top && dstY < top) || (srcY > bottom && dstY > bottom)
                    ) {
                        continue
                    }

                    val isConnectedToSelected = selectedIndex >= 0 && (src == selectedIndex || dst == selectedIndex)
                    val isDimmed = selectedIndex >= 0 && !isConnectedToSelected
                    val alpha = when {
                        isConnectedToSelected -> 0.85f
                        isDimmed -> 0.04f
                        else -> (layout.edgeWeights[e] * 0.35f).coerceIn(0.12f, 0.45f)
                    }

                    drawLine(
                        color = layout.edgeColors[e].copy(alpha = alpha),
                        start = Offset(srcX, srcY),
                        end = Offset(dstX, dstY),
                        strokeWidth = if (isConnectedToSelected) 2.2f else 1.0f,
                        cap = StrokeCap.Round,
                    )
                }

                // 标签可读性取决于「屏上有多少个点」，而不是缩放倍率本身：
                // 自适应之后小分片的 scale 很小但屏幕很空，按旧规则会一个字都不写。
                var visibleCount = 0
                for (i in 0 until layout.count) {
                    val nodeX = layout.xs[i]
                    val nodeY = layout.ys[i]
                    if (nodeX >= left && nodeX <= right && nodeY >= top && nodeY <= bottom) visibleCount++
                }
                val labelsAllowed = scale >= 0.75f || visibleCount <= LABELS_WHEN_SPARSE

                labelPaint.textAlign = android.graphics.Paint.Align.CENTER
                // 字号在屏幕空间保持 10~18sp，故世界空间要除以 scale
                labelPaint.textSize = (11f * scale).coerceIn(10f, 18f) / scale
                labelPaint.color = if (isDark) 0xFFEDE9E1.toInt() else 0xFF2B2824.toInt()

                // 星图节点
                for (i in 0 until layout.count) {
                    val nodeX = layout.xs[i]
                    val nodeY = layout.ys[i]
                    if (nodeX < left || nodeX > right || nodeY < top || nodeY > bottom) continue

                    val isSelected = i == selectedIndex
                    val isConnected = selectedIndex >= 0 && connected[i]
                    val isHighlighted = if (selectedIndex >= 0) isSelected || isConnected else matched[i]
                    val isDimmed = !isHighlighted

                    val nodeAlpha = if (isDimmed) 0.18f else 1.0f
                    val baseRadius = layout.radii[i]
                    val nodeColor = layout.colors[i]

                    if (isSelected) {
                        drawCircle(
                            color = nodeColor.copy(alpha = 0.25f),
                            radius = baseRadius * 2.2f,
                            center = Offset(nodeX, nodeY),
                        )
                        drawCircle(
                            color = nodeColor.copy(alpha = 0.45f),
                            radius = baseRadius * 1.6f,
                            center = Offset(nodeX, nodeY),
                            style = Stroke(width = 1.5f),
                        )
                    }

                    if (layout.mastery[i] >= 2) {
                        drawCircle(
                            color = EditorialColor.likeGreen.copy(alpha = nodeAlpha),
                            radius = baseRadius + 3f,
                            center = Offset(nodeX, nodeY),
                            style = Stroke(width = 1.6f),
                        )
                    }

                    drawCircle(
                        color = nodeColor.copy(alpha = nodeAlpha),
                        radius = baseRadius,
                        center = Offset(nodeX, nodeY),
                    )

                    drawCircle(
                        color = if (isDimmed) Color.White.copy(alpha = 0.3f) else Color.White.copy(alpha = 0.9f),
                        radius = (baseRadius * 0.38f).coerceAtLeast(1.5f),
                        center = Offset(nodeX, nodeY),
                    )

                    // LOD：缩得远时只给选中/相连的节点写字，避免文字堆叠与 drawText 风暴
                    val shouldDrawText = !isDimmed && (labelsAllowed || isSelected || isConnected)
                    if (shouldDrawText) {
                        labelPaint.isFakeBoldText = isSelected
                        drawContext.canvas.nativeCanvas.drawText(
                            layout.labels[i],
                            nodeX,
                            nodeY + baseRadius + 14f,
                            labelPaint
                        )
                    }
                }

                canvasHandle.restore()
            }
        }

        // 顶栏控制条
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(bgColor.copy(alpha = 0.92f))
                .padding(top = 8.dp)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack) {
                    Icon(
                        Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "返回",
                        tint = MaterialTheme.colorScheme.onBackground,
                    )
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        "知识全景星图",
                        fontSize = 17.sp,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Serif,
                        color = MaterialTheme.colorScheme.onBackground,
                    )
                    Text(
                        "${graphData.nodes.size} 知识星宿 · ${graphData.edges.size} 关联引力",
                        fontSize = 11.5.sp,
                        color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
                    )
                }

                // 搜索切换按钮
                IconButton(onClick = { showSearch = !showSearch }) {
                    Icon(
                        if (showSearch) Icons.Default.Close else Icons.Default.Search,
                        contentDescription = "搜索星图",
                        tint = MaterialTheme.colorScheme.onBackground,
                    )
                }

                // 视口复位重置
                IconButton(onClick = {
                    viewport.fitTo(KnowledgeGraphEngine.boundsOf(graphData.nodes))
                    selectedNode = null
                    shard = GraphShard.All
                    searchQuery = ""
                    HapticFeedbackHelper.tick(context)
                }) {
                    Icon(
                        Icons.Default.Refresh,
                        contentDescription = "复位视口",
                        tint = MaterialTheme.colorScheme.onBackground,
                    )
                }
            }

            // 展开搜索栏
            AnimatedVisibility(visible = showSearch) {
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    placeholder = { Text("搜索星宿标题或分类…", fontSize = 13.sp) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 4.dp),
                    shape = RoundedCornerShape(12.dp),
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = EditorialColor.aiAmber,
                        unfocusedBorderColor = MaterialTheme.colorScheme.outline,
                    ),
                )
            }

            // 学科横向筛选胶囊
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                GraphFilterChip(
                    text = "全景星系",
                    isSelected = shard is GraphShard.All,
                    onClick = {
                        shard = GraphShard.All
                        HapticFeedbackHelper.tick(context)
                    },
                )
                for (summary in shards) {
                    val option = GraphShard.Subject(summary.slug)
                    GraphFilterChip(
                        text = "${summary.name} (${summary.count})",
                        isSelected = shard == option,
                        onClick = {
                            // 再点一次回到全景，与 mac 端一致
                            shard = if (shard == option) GraphShard.All else option
                            HapticFeedbackHelper.tick(context)
                        },
                    )
                }
            }
        }

        // 底部选中卡片微卡片详情浮层
        AnimatedVisibility(
            visible = selectedNode != null,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(16.dp),
            enter = slideInVertically { it } + fadeIn(),
            exit = slideOutVertically { it } + fadeOut(),
        ) {
            val node = selectedNode
            val card = node?.let { cardMap[it.cardId] }
            if (card != null) {
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.surface,
                    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                    shadowElevation = 8.dp,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp)
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(EditorialColor.aiAmber.copy(alpha = 0.14f))
                                    .padding(horizontal = 7.dp, vertical = 2.5.dp)
                            ) {
                                Text(
                                    card.category,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = EditorialColor.aiAmber,
                                )
                            }
                            Spacer(Modifier.width(8.dp))
                            if (card.masteryLevel >= 2) {
                                Text(
                                    "★ 熟练掌握",
                                    fontSize = 11.sp,
                                    color = EditorialColor.likeGreen,
                                    fontWeight = FontWeight.Medium,
                                )
                            }
                            Spacer(Modifier.weight(1f))
                            Text(
                                "引力关联 ${node.connectionsCount} 处",
                                fontSize = 11.sp,
                                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.5f),
                            )
                        }

                        Spacer(Modifier.height(8.dp))

                        Text(
                            card.headline,
                            fontSize = 15.5.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Serif,
                            color = MaterialTheme.colorScheme.onBackground,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )

                        Spacer(Modifier.height(4.dp))

                        Text(
                            card.summary,
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.75f),
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            lineHeight = 18.sp,
                        )

                        Spacer(Modifier.height(12.dp))

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.End,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            TextButton(
                                onClick = {
                                    HapticFeedbackHelper.click(context)
                                    onPromoteToTop(card)
                                },
                                colors = ButtonDefaults.textButtonColors(
                                    contentColor = EditorialColor.aiAmber,
                                )
                            ) {
                                Text("置顶进入卡堆", fontSize = 13.sp)
                            }
                            Spacer(Modifier.width(8.dp))
                            TextButton(
                                onClick = {
                                    HapticFeedbackHelper.click(context)
                                    onSelectCard(card)
                                },
                                shape = RoundedCornerShape(8.dp),
                                colors = ButtonDefaults.textButtonColors(
                                    containerColor = EditorialColor.aiAmber.copy(alpha = 0.12f),
                                    contentColor = EditorialColor.aiAmber,
                                )
                            ) {
                                Text("查看完整知识", fontSize = 13.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * 星图分片选择。`All` 与 `Subject(null)` 必须可区分：后者是「未分级」那一片，
 * 用 null 兼表两义会把未分级卡藏进全景里无法单独查看。
 */
private sealed interface GraphShard {
    data object All : GraphShard
    data class Subject(val slug: String?) : GraphShard

    fun select(cards: List<KnowledgeCard>): List<KnowledgeCard> = when (this) {
        All -> cards
        is Subject -> SubjectRegistry.cardsIn(cards, slug)
    }
}

@Composable
private fun GraphFilterChip(
    text: String,
    isSelected: Boolean,
    onClick: () -> Unit,
) {
    val borderColor = if (isSelected) EditorialColor.aiAmber else MaterialTheme.colorScheme.outline
    val bgColor = if (isSelected) EditorialColor.aiAmber.copy(alpha = 0.14f) else MaterialTheme.colorScheme.surface
    val textColor = if (isSelected) EditorialColor.aiAmber else MaterialTheme.colorScheme.onBackground.copy(alpha = 0.8f)

    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(bgColor)
            .border(1.dp, borderColor, RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 4.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            fontSize = 12.sp,
            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
            color = textColor,
        )
    }
}

private fun getNodeColor(category: String): Color = when (category) {
    "物理" -> Color(0xFF5B8FF9)
    "天文" -> Color(0xFF6C63FF)
    "数学" -> Color(0xFF00B4D8)
    "化学" -> Color(0xFF48CAE4)
    "生物" -> Color(0xFF2EC4B6)
    "脑科学" -> Color(0xFFE76F51)
    "心理" -> Color(0xFFF4A261)
    "哲学" -> Color(0xFF9D4EDD)
    "历史" -> Color(0xFFD4A373)
    "AI", "AI Agent", "AI 开发" -> EditorialColor.aiAmber
    "编程", "Rust", "Python" -> Color(0xFF38B000)
    "投资理财", "中级会计" -> Color(0xFF2A9D8F)
    else -> Color(0xFF8D99AE)
}

// ---------------------------------------------------------------- 绘制支撑
//
// 星图的视口与扁平布局：两者都不参与组合状态的读写扩散，
// 因此手势期间的成本只有「一张画布重绘」，没有整树重组与逐帧分配。

/** 世界画布边长与圆心（与构图引擎调用参数一致） */
private const val GRAPH_WORLD_SIZE = 1400f
private const val GRAPH_WORLD_CENTER = 700f
private const val GRAPH_MIN_SCALE = 0.45f
private const val GRAPH_MAX_SCALE = 3.2f
private const val GRAPH_CULL_MARGIN = 80f

/** 屏上节点数不超过这个数量时，即使缩得远也照样写字（此时不会糊成一团） */
private const val LABELS_WHEN_SPARSE = 40

/**
 * 星图视口（缩放 + 平移）。
 *
 * 状态只在 Draw 阶段与手势回调里读写：手势每帧写它只会让画布重绘，
 * 不会让整棵 Composable 树（顶栏、胶囊筛选、底部预览卡）跟着重组。
 */
private class GraphViewport {
    var scale by mutableFloatStateOf(1f)
        private set
    var panX by mutableFloatStateOf(0f)
        private set
    var panY by mutableFloatStateOf(0f)
        private set

    /** 视口尺寸：由 onSizeChanged 写入，只在自适应计算里读，不参与组合 */
    var viewWidth = 0f
        private set
    var viewHeight = 0f
        private set

    fun setViewportSize(width: Float, height: Float) {
        viewWidth = width
        viewHeight = height
    }

    fun transformBy(zoomChange: Float, panChange: Offset) {
        scale = (scale * zoomChange).coerceIn(GRAPH_MIN_SCALE, GRAPH_MAX_SCALE)
        panX += panChange.x
        panY += panChange.y
    }

    fun reset() {
        scale = 1f
        panX = 0f
        panY = 0f
    }

    /**
     * 自适应：把整片星图缩放居中到视口内。
     * 手机屏宽只有世界画布的约两成，不自适应就等于「进图只看到左上角一块」。
     */
    fun fitTo(bounds: GraphBounds?) {
        if (bounds == null || viewWidth <= 0f || viewHeight <= 0f) {
            reset()
            return
        }
        val fit = KnowledgeGraphEngine.fitToViewport(
            minX = bounds.minX, minY = bounds.minY, maxX = bounds.maxX, maxY = bounds.maxY,
            viewWidth = viewWidth, viewHeight = viewHeight,
        )
        scale = fit.scale
        // 绘制层约定 screen = viewCenter + pan + (world - center) * scale，反解等效 pan
        panX = fit.offsetX - viewWidth / 2f + GRAPH_WORLD_CENTER * fit.scale
        panY = fit.offsetY - viewHeight / 2f + GRAPH_WORLD_CENTER * fit.scale
    }
}

/**
 * 一次成型的绘制布局：世界坐标、颜色、截断标签、边端点下标都压进定长数组。
 *
 * 建图之后每帧绘制只剩数组访问——原先每帧要查两次 HashMap、截一次字符串、
 * 跑一次分类色 when 分支，手指移动时就是每帧数百次分配。
 */
private class GraphLayout(data: KnowledgeGraphData) {
    val count = data.nodes.size
    val xs = FloatArray(count)
    val ys = FloatArray(count)
    val radii = FloatArray(count)
    val mastery = IntArray(count)
    val colors = Array(count) { Color.Unspecified }
    val labels = Array(count) { "" }
    private val lowerTitles = Array(count) { "" }
    private val lowerCategories = Array(count) { "" }
    private val categories = Array(count) { "" }
    private val indexByCardId = HashMap<String, Int>(count * 2 + 1)

    val edges = data.edges
    val edgeSrc = IntArray(data.edges.size) { -1 }
    val edgeDst = IntArray(data.edges.size) { -1 }
    val edgeWeights = FloatArray(data.edges.size)
    val edgeColors = Array(data.edges.size) { Color.Unspecified }

    init {
        for (i in 0 until count) {
            val node = data.nodes[i]
            xs[i] = node.x
            ys[i] = node.y
            radii[i] = node.radius
            mastery[i] = node.masteryLevel
            colors[i] = getNodeColor(node.category)
            labels[i] = if (node.headline.length > 8) node.headline.take(7) + "…" else node.headline
            lowerTitles[i] = node.headline.lowercase()
            categories[i] = node.category
            lowerCategories[i] = node.category.lowercase()
            indexByCardId[node.cardId] = i
        }
        for (e in data.edges.indices) {
            val edge = data.edges[e]
            val src = indexByCardId[edge.sourceId]
            val dst = indexByCardId[edge.targetId]
            if (src == null || dst == null) continue
            edgeSrc[e] = src
            edgeDst[e] = dst
            edgeWeights[e] = edge.weight
            edgeColors[e] = when (edge.kind) {
                RelationKind.DISCIPLINE_DEEPEN -> EditorialColor.likeGreen
                RelationKind.CROSS_DISCIPLINE -> EditorialColor.aiAmber
                RelationKind.CONCEPT_BRIDGE -> EditorialColor.detailBlue
                RelationKind.SERENDIPITY -> EditorialColor.warningOrange
            }
        }
    }

    fun indexOfCard(cardId: String?): Int = if (cardId == null) -1 else indexByCardId[cardId] ?: -1

    /** 检索词命中掩码（逐帧 contains 的替代）。学科过滤在构图输入阶段完成，不在这里做。 */
    fun matchedFlags(query: String): BooleanArray {
        val trimmed = query.trim().lowercase()
        if (trimmed.isEmpty()) return BooleanArray(count) { true }
        return BooleanArray(count) { i -> lowerTitles[i].contains(trimmed) || lowerCategories[i].contains(trimmed) }
    }

    /** 与选中节点直接相连的掩码（含自身） */
    fun connectivityFlags(cardId: String?): BooleanArray {
        val flags = BooleanArray(count)
        val selected = indexOfCard(cardId)
        if (selected < 0) return flags
        flags[selected] = true
        for (e in edgeSrc.indices) {
            if (edgeSrc[e] == selected) flags[edgeDst[e]] = true
            else if (edgeDst[e] == selected) flags[edgeSrc[e]] = true
        }
        return flags
    }

    /** 轻点命中：屏幕坐标反算世界坐标，取阈值内最近节点下标，未命中返回 -1 */
    fun nodeAt(
        tapX: Float,
        tapY: Float,
        scale: Float,
        panX: Float,
        panY: Float,
        viewWidth: Float,
        viewHeight: Float,
    ): Int {
        val worldX = (tapX - viewWidth / 2f - panX) / scale + GRAPH_WORLD_CENTER
        val worldY = (tapY - viewHeight / 2f - panY) / scale + GRAPH_WORLD_CENTER
        var nearest = -1
        var nearestDist = Float.MAX_VALUE
        for (i in 0 until count) {
            val dist = hypot(xs[i] - worldX, ys[i] - worldY)
            if (dist <= radii[i] + 80f && dist < nearestDist) {
                nearestDist = dist
                nearest = i
            }
        }
        return nearest
    }
}
