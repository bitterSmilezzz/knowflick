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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.graph.GraphNode
import com.knowflick.app.domain.graph.KnowledgeGraphData
import com.knowflick.app.domain.graph.KnowledgeGraphEngine
import com.knowflick.app.domain.graph.RelationKind
import com.knowflick.app.ui.EditorialColor
import com.knowflick.app.ui.common.AudioEffectHelper
import com.knowflick.app.ui.common.HapticFeedbackHelper
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
    var selectedCategory by remember { mutableStateOf<String?>(null) }
    var searchQuery by remember { mutableStateOf("") }
    var showSearch by remember { mutableStateOf(false) }

    // 视口变换参数
    var scale by remember { mutableFloatStateOf(1f) }
    var panX by remember { mutableFloatStateOf(0f) }
    var panY by remember { mutableFloatStateOf(0f) }

    // 异步构建星图拓扑
    LaunchedEffect(cards) {
        val snapshot = cards.toList()
        graphData = withContext(Dispatchers.Default) {
            KnowledgeGraphEngine.buildGraph(snapshot, width = 1400f, height = 1400f)
        }
        selectedNode = null
    }

    val cardMap = remember(cards) { cards.associateBy { it.id } }
    val categories = remember(cards) { cards.map { it.category }.distinct().sorted() }
    val nodeMap = remember(graphData) { graphData.nodes.associateBy { it.cardId } }
    val labelPaint = remember { android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG) }
    val currentScale by rememberUpdatedState(scale)
    val currentPanX by rememberUpdatedState(panX)
    val currentPanY by rememberUpdatedState(panY)

    // 与选中节点相连的所有节点 ID 集合
    val connectedCardIds = remember(selectedNode, graphData) {
        val sel = selectedNode ?: return@remember emptySet<String>()
        val set = HashSet<String>()
        set.add(sel.cardId)
        for (edge in graphData.edges) {
            if (edge.sourceId == sel.cardId) set.add(edge.targetId)
            if (edge.targetId == sel.cardId) set.add(edge.sourceId)
        }
        set
    }

    val isDark = MaterialTheme.colorScheme.background.red < 0.2f
    val bgColor = if (isDark) Color(0xFF0F1014) else Color(0xFFF7F5F0)
    val canvasCenter = remember { Offset(600f, 600f) }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(bgColor)
    ) {
        // 主画布区（手势变换与星图渲染）
        Box(
            modifier = Modifier
                .fillMaxSize()
                .semantics {
                    contentDescription = "知识星图画布，共 ${graphData.nodes.size} 个知识节点；可双指缩放、拖动，轻点节点查看详情"
                }
                .pointerInput(graphData) {
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
                                    val zoomMotion = kotlin.math.abs(1 - zoom) * centroidSize
                                    val panMotion = pan.getDistance()

                                    if (zoomMotion > touchSlop || panMotion > touchSlop) {
                                        pastTouchSlop = true
                                    }
                                }

                                if (pastTouchSlop) {
                                    if (zoomChange != 1f || panChange != Offset.Zero) {
                                        scale = (scale * zoomChange).coerceIn(0.45f, 3.2f)
                                        panX += panChange.x
                                        panY += panChange.y
                                        event.changes.forEach { it.consume() }
                                    }
                                }
                            }
                        } while (event.changes.any { it.pressed })

                        if (!pastTouchSlop) {
                            // 轻点触达节点
                            val tapOffset = down.position
                            val screenCenterX = size.width / 2f
                            val screenCenterY = size.height / 2f
                            val worldX = (tapOffset.x - screenCenterX - panX) / scale + canvasCenter.x
                            val worldY = (tapOffset.y - screenCenterY - panY) / scale + canvasCenter.y

                            var nearestNode: GraphNode? = null
                            var nearestDist = Float.MAX_VALUE
                            for (node in graphData.nodes) {
                                val dist = hypot(node.x - worldX, node.y - worldY)
                                if (dist < nearestDist && dist <= (node.radius + 80f)) {
                                    nearestDist = dist
                                    nearestNode = node
                                }
                            }

                            android.util.Log.d("KnowFlickGraph", "Tap at $tapOffset -> world ($worldX, $worldY), nearestDist=$nearestDist, hit=${nearestNode?.headline}")

                            if (nearestNode != null) {
                                HapticFeedbackHelper.click(context)
                                AudioEffectHelper.playClick(context)
                                selectedNode = nearestNode
                            } else {
                                selectedNode = null
                            }
                        }
                    }
                }
        ) {
            Canvas(modifier = Modifier.fillMaxSize()) {
                val screenCenterX = size.width / 2f
                val screenCenterY = size.height / 2f

                // 绘制背景微弱放射光芒
                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(
                            EditorialColor.aiAmber.copy(alpha = if (isDark) 0.08f else 0.04f),
                            Color.Transparent,
                        ),
                        center = Offset(screenCenterX + panX, screenCenterY + panY),
                        radius = 450f * scale,
                    )
                )

                // 绘制星图连线（引力光索）
                for (edge in graphData.edges) {
                    val src = nodeMap[edge.sourceId] ?: continue
                    val dst = nodeMap[edge.targetId] ?: continue

                    val srcScreenX = screenCenterX + panX + (src.x - canvasCenter.x) * scale
                    val srcScreenY = screenCenterY + panY + (src.y - canvasCenter.y) * scale
                    val dstScreenX = screenCenterX + panX + (dst.x - canvasCenter.x) * scale
                    val dstScreenY = screenCenterY + panY + (dst.y - canvasCenter.y) * scale

                    val isConnectedToSelected = selectedNode != null &&
                        (edge.sourceId == selectedNode!!.cardId || edge.targetId == selectedNode!!.cardId)
                    val isDimmed = selectedNode != null && !isConnectedToSelected

                    val edgeColor = when (edge.kind) {
                        RelationKind.DISCIPLINE_DEEPEN -> EditorialColor.likeGreen
                        RelationKind.CROSS_DISCIPLINE -> EditorialColor.aiAmber
                        RelationKind.CONCEPT_BRIDGE -> EditorialColor.detailBlue
                        RelationKind.SERENDIPITY -> EditorialColor.warningOrange
                    }

                    val alpha = when {
                        isConnectedToSelected -> 0.85f
                        isDimmed -> 0.04f
                        else -> (edge.weight * 0.35f).coerceIn(0.12f, 0.45f)
                    }

                    val strokeWidth = if (isConnectedToSelected) 2.2f * scale else 1.0f * scale

                    drawLine(
                        color = edgeColor.copy(alpha = alpha),
                        start = Offset(srcScreenX, srcScreenY),
                        end = Offset(dstScreenX, dstScreenY),
                        strokeWidth = strokeWidth,
                        cap = StrokeCap.Round,
                    )
                }

                // 绘制星图节点
                for (node in graphData.nodes) {
                    val screenX = screenCenterX + panX + (node.x - canvasCenter.x) * scale
                    val screenY = screenCenterY + panY + (node.y - canvasCenter.y) * scale

                    // 视口剔除（超出屏幕边界则跳过渲染）
                    if (screenX < -50 || screenX > size.width + 50 || screenY < -50 || screenY > size.height + 50) {
                        continue
                    }

                    val isSelected = selectedNode?.cardId == node.cardId
                    val isConnected = connectedCardIds.contains(node.cardId)
                    val isCategoryMatched = selectedCategory == null || node.category == selectedCategory
                    val isSearchMatched = searchQuery.isEmpty() ||
                        node.headline.contains(searchQuery, ignoreCase = true) ||
                        node.category.contains(searchQuery, ignoreCase = true)

                    val isHighlighted = isSelected || isConnected || (selectedNode == null && isCategoryMatched && isSearchMatched)
                    val isDimmed = !isHighlighted

                    val nodeAlpha = if (isDimmed) 0.18f else 1.0f
                    val baseRadius = node.radius * scale
                    val nodeColor = getNodeColor(node.category)

                    // 选中态光环扩散
                    if (isSelected) {
                        drawCircle(
                            color = nodeColor.copy(alpha = 0.25f),
                            radius = baseRadius * 2.2f,
                            center = Offset(screenX, screenY),
                        )
                        drawCircle(
                            color = nodeColor.copy(alpha = 0.45f),
                            radius = baseRadius * 1.6f,
                            center = Offset(screenX, screenY),
                            style = Stroke(width = 1.5f * scale),
                        )
                    }

                    // 掌握度外环
                    if (node.masteryLevel >= 2) {
                        drawCircle(
                            color = EditorialColor.likeGreen.copy(alpha = nodeAlpha),
                            radius = baseRadius + 3f * scale,
                            center = Offset(screenX, screenY),
                            style = Stroke(width = 1.6f * scale),
                        )
                    }

                    // 核心实体圆
                    drawCircle(
                        color = nodeColor.copy(alpha = nodeAlpha),
                        radius = baseRadius,
                        center = Offset(screenX, screenY),
                    )

                    // 节点中心白色高光微核
                    drawCircle(
                        color = Color.White.copy(alpha = if (isDimmed) 0.3f else 0.9f),
                        radius = (baseRadius * 0.38f).coerceAtLeast(1.5f),
                        center = Offset(screenX, screenY),
                    )

                    // 在合适缩放比下绘制节点微标题文字
                    if (scale >= 0.75f && !isDimmed) {
                        labelPaint.color = if (isDark) 0xFFEDE9E1.toInt() else 0xFF2B2824.toInt()
                        labelPaint.textSize = (11f * scale).coerceIn(10f, 18f)
                        labelPaint.textAlign = android.graphics.Paint.Align.CENTER
                        labelPaint.isFakeBoldText = isSelected
                        val shortTitle = if (node.headline.length > 8) {
                            node.headline.take(7) + "…"
                        } else {
                            node.headline
                        }
                        drawContext.canvas.nativeCanvas.drawText(
                            shortTitle,
                            screenX,
                            screenY + baseRadius + 14f * scale,
                            labelPaint
                        )
                    }
                }
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
                    scale = 1f
                    panX = 0f
                    panY = 0f
                    selectedNode = null
                    selectedCategory = null
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
                    isSelected = selectedCategory == null,
                    onClick = {
                        selectedCategory = null
                        HapticFeedbackHelper.tick(context)
                    },
                )
                for (cat in categories) {
                    GraphFilterChip(
                        text = cat,
                        isSelected = selectedCategory == cat,
                        onClick = {
                            selectedCategory = if (selectedCategory == cat) null else cat
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
