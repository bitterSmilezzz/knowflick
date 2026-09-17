package com.knowflick.app.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.data.CategoryStampColor
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.QuizRating
import com.knowflick.app.domain.QuizSession
import com.knowflick.app.domain.QuizType

/**
 * 知识测验（主动回忆）：正面主张 → 点击/空格翻面看解析 → 三档自评写回熟练度。
 * 与 macOS QuizView 同语义：评分经 AppStore 记账，到期队列随评分刷新。
 */
@Composable
fun QuizScreen(
    session: QuizSession,
    onRate: (QuizRating) -> Unit,
    onNextRound: () -> Unit,
    onRetestWeakCards: (Map<String, QuizRating>) -> Unit = {},
    onExit: () -> Unit,
) {
    androidx.activity.compose.BackHandler { onExit() }

    val card = session.current
    var flipped by rememberSaveable(card?.id) { mutableStateOf(false) }

    val countMastered = session.allRatings.values.count { it == QuizRating.MASTERED }
    val countHesitant = session.allRatings.values.count { it == QuizRating.HESITANT }
    val countForgot = session.allRatings.values.count { it == QuizRating.FORGOT }

    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        // 顶栏：退出 + 题型标签 + 实时状态圆点 + 进度
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onExit) {
                Icon(
                    Icons.Filled.Close,
                    contentDescription = "退出测验",
                    tint = MaterialTheme.colorScheme.onBackground,
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    AppIcons.Sparkles,
                    contentDescription = null,
                    tint = EditorialColor.aiAmber,
                    modifier = Modifier.size(16.dp),
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    session.type.label,
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Serif,
                )
                if (!session.isFinished && session.total > 0) {
                    Spacer(Modifier.width(8.dp))
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(EditorialColor.aiAmber.copy(alpha = 0.16f))
                            .border(1.dp, EditorialColor.aiAmber.copy(alpha = 0.35f), RoundedCornerShape(6.dp))
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                    ) {
                        Text(
                            "${session.index + 1} / ${session.total}",
                            color = EditorialColor.aiAmber,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace,
                        )
                    }
                }
            }

            Spacer(Modifier.weight(1f))

            // 实时掌握度微缩计数指示器（对齐 macOS）
            if (!session.isFinished && session.allRatings.isNotEmpty()) {
                Row(
                    Modifier
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color.White.copy(alpha = 0.06f))
                        .border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(12.dp))
                        .padding(horizontal = 10.dp, vertical = 5.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(6.dp).background(EditorialColor.likeGreen, CircleShape))
                        Spacer(Modifier.width(4.dp))
                        Text(
                            "$countMastered",
                            color = Color.White.copy(alpha = 0.8f),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace,
                        )
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(6.dp).background(EditorialColor.aiAmber, CircleShape))
                        Spacer(Modifier.width(4.dp))
                        Text(
                            "$countHesitant",
                            color = Color.White.copy(alpha = 0.8f),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace,
                        )
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(6.dp).background(EditorialColor.dislikeRed, CircleShape))
                        Spacer(Modifier.width(4.dp))
                        Text(
                            "$countForgot",
                            color = Color.White.copy(alpha = 0.8f),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace,
                        )
                    }
                }
            }
        }

        LinearProgressIndicator(
            progress = { if (session.total == 0) 1f else session.index.toFloat() / session.total },
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp),
        )

        if (card == null) {
            QuizSummary(
                session = session,
                onNextRound = onNextRound,
                onRetestWeakCards = onRetestWeakCards,
                onExit = onExit,
            )
        } else {
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 12.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(MaterialTheme.colorScheme.surface)
                    .clickable { flipped = !flipped },
            ) {
                QuizCardFace(card = card, flipped = flipped)
            }
            // 三档自评（翻面后可用）
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                RatingButton("没想起来", EditorialColor.dislikeRed, enabled = flipped) { onRate(QuizRating.FORGOT) }
                RatingButton("犹豫想起", EditorialColor.aiAmber, enabled = flipped) { onRate(QuizRating.HESITANT) }
                RatingButton("熟练掌握", EditorialColor.likeGreen, enabled = flipped) { onRate(QuizRating.MASTERED) }
            }
            Text(
                if (flipped) "三档自评写回熟练度，到期队列随之刷新" else "点击卡片查看解析后再自评",
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.4f),
                fontSize = 11.sp,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
            )
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun QuizCardFace(card: KnowledgeCard, flipped: Boolean) {
    val rotation by animateFloatAsState(
        targetValue = if (flipped) 180f else 0f,
        animationSpec = tween(durationMillis = 380),
        label = "quizFlip",
    )
    val showingBack = rotation > 90f
    Box(
        Modifier
            .fillMaxSize()
            .graphicsLayer {
                rotationY = rotation
                cameraDistance = 12f * density
            },
    ) {
        if (!showingBack) {
            // 正面：分类 + 主张 + 摘要
            Column(Modifier.fillMaxSize().padding(24.dp)) {
                StampRow(card)
                Spacer(Modifier.weight(1f))
                Text(
                    card.headline,
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Black,
                    fontFamily = FontFamily.Serif,
                    lineHeight = 34.sp,
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    card.summary,
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.7f),
                    fontSize = 13.sp,
                    lineHeight = 20.sp,
                )
                Spacer(Modifier.weight(1f))
                Text("点击翻面查看解析 →", color = EditorialColor.aiAmber, fontSize = 11.sp)
            }
        } else {
            // 背面（镜像翻转后再翻回，保证文字正向）
            Column(
                Modifier
                    .fillMaxSize()
                    .graphicsLayer { rotationY = 180f }
                    .verticalScroll(rememberScrollState())
                    .padding(24.dp),
            ) {
                StampRow(card)
                Spacer(Modifier.height(16.dp))
                Text(
                    "解析",
                    color = EditorialColor.aiAmber,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(10.dp))
                card.paragraphs.forEachIndexed { index, para ->
                    if (index > 0) Spacer(Modifier.height(12.dp))
                    Text(
                        para,
                        color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.85f),
                        fontSize = 13.5.sp,
                        lineHeight = 23.sp,
                    )
                }
            }
        }
    }
}

@Composable
private fun StampRow(card: KnowledgeCard) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .background(CategoryStampColor.forCategory(card.category).copy(alpha = 0.15f), RoundedCornerShape(6.dp))
                .padding(horizontal = 8.dp, vertical = 3.dp),
        ) {
            Text(
                card.category.ifBlank { "未分类" },
                color = CategoryStampColor.forCategory(card.category),
                fontSize = 10.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
        Spacer(Modifier.weight(1f))
        Text(
            "复习 ${card.reviewCount} 次 · " + when (card.masteryLevel) {
                2 -> "已掌握 ★★"
                1 -> "学习中 ★☆"
                else -> "未测验 ☆☆"
            },
            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.45f),
            fontSize = 10.sp,
        )
    }
}

@Composable
private fun RowScope.RatingButton(label: String, tint: Color, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .weight(1f)
            .clip(RoundedCornerShape(10.dp))
            .background(tint.copy(alpha = if (enabled) 0.9f else 0.25f))
            .clickable(enabled = enabled) { onClick() }
            .padding(vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = Color(0xFF121212), fontSize = 12.sp, fontWeight = FontWeight.Bold)
    }
}

/**
 * 测验完成结算面板（对齐 macOS 视觉与行动流）
 */
@Composable
private fun QuizSummary(
    session: QuizSession,
    onNextRound: () -> Unit,
    onRetestWeakCards: (Map<String, QuizRating>) -> Unit,
    onExit: () -> Unit,
) {
    val countMastered = session.summary[QuizRating.MASTERED] ?: 0
    val countHesitant = session.summary[QuizRating.HESITANT] ?: 0
    val countForgot = session.summary[QuizRating.FORGOT] ?: 0
    val total = session.total
    val weakCount = countForgot + countHesitant

    val retentionRate = if (total == 0) 0 else {
        ((countMastered * 1.0 + countHesitant * 0.5) / total * 100).toInt().coerceIn(0, 100)
    }

    var animatedProgress by remember { mutableFloatStateOf(0f) }
    val animatedProgressVal by animateFloatAsState(
        targetValue = animatedProgress,
        animationSpec = tween(durationMillis = 900),
        label = "retentionRing",
    )

    LaunchedEffect(retentionRate) {
        animatedProgress = retentionRate / 100f
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(10.dp))

        // 顶端图标与标题
        Icon(
            AppIcons.Sparkles,
            contentDescription = null,
            tint = EditorialColor.aiAmber,
            modifier = Modifier.size(36.dp),
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "本轮记忆测验已完成",
            color = MaterialTheme.colorScheme.onBackground,
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
            fontFamily = FontFamily.Serif,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            "艾宾浩斯记忆模型表明，及时主动提取能显著提升神经突触的长期连接。",
            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.55f),
            fontSize = 11.5.sp,
            lineHeight = 17.sp,
            modifier = Modifier.padding(horizontal = 12.dp),
        )

        Spacer(Modifier.height(24.dp))

        // 记忆留存率环形进度展示
        Box(
            modifier = Modifier.size(130.dp),
            contentAlignment = Alignment.Center,
        ) {
            Canvas(modifier = Modifier.fillMaxSize()) {
                val strokeWidth = 10.dp.toPx()
                // 底环
                drawArc(
                    color = Color.White.copy(alpha = 0.08f),
                    startAngle = -90f,
                    sweepAngle = 360f,
                    useCenter = false,
                    style = Stroke(width = strokeWidth, cap = StrokeCap.Round),
                )
                // 进度弧
                if (animatedProgressVal > 0f) {
                    drawArc(
                        brush = Brush.sweepGradient(
                            listOf(
                                EditorialColor.aiAmber,
                                EditorialColor.likeGreen,
                                EditorialColor.aiAmber,
                            ),
                        ),
                        startAngle = -90f,
                        sweepAngle = animatedProgressVal * 360f,
                        useCenter = false,
                        style = Stroke(width = strokeWidth, cap = StrokeCap.Round),
                    )
                }
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    "$retentionRate%",
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 28.sp,
                    fontWeight = FontWeight.Black,
                    fontFamily = FontFamily.Monospace,
                )
                Text(
                    "记忆留存率",
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.5f),
                    fontSize = 10.5.sp,
                )
            }
        }

        Spacer(Modifier.height(24.dp))

        // 三分项指标卡片
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            SummaryStatCard(
                title = "熟练掌握",
                count = countMastered,
                total = total,
                tint = EditorialColor.likeGreen,
                modifier = Modifier.weight(1f),
            )
            SummaryStatCard(
                title = "犹豫想起",
                count = countHesitant,
                total = total,
                tint = EditorialColor.aiAmber,
                modifier = Modifier.weight(1f),
            )
            SummaryStatCard(
                title = "需要强化",
                count = countForgot,
                total = total,
                tint = EditorialColor.dislikeRed,
                modifier = Modifier.weight(1f),
            )
        }

        Spacer(Modifier.height(28.dp))

        // 底部行动按键组
        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            // 针对性重测弱项（有弱项卡片时优先呈现）
            if (weakCount > 0) {
                Button(
                    onClick = { onRetestWeakCards(session.allRatings) },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = EditorialColor.aiAmber),
                ) {
                    Text(
                        "针对性重测弱项 ($weakCount 题)",
                        color = Color.White,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }

            Button(
                onClick = onNextRound,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color.White.copy(alpha = 0.08f),
                    contentColor = MaterialTheme.colorScheme.onBackground,
                ),
            ) {
                Text(
                    "再测一组 ↻",
                    fontSize = 13.5.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }

            TextButton(onClick = onExit) {
                Text(
                    "完成并返回卡堆",
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.55f),
                    fontSize = 13.sp,
                )
            }
        }

        Spacer(Modifier.height(20.dp))
    }
}

@Composable
private fun SummaryStatCard(
    title: String,
    count: Int,
    total: Int,
    tint: Color,
    modifier: Modifier = Modifier,
) {
    val pct = if (total > 0) count * 100 / total else 0
    Box(
        modifier
            .clip(RoundedCornerShape(12.dp))
            .background(Color.White.copy(alpha = 0.04f))
            .border(1.dp, tint.copy(alpha = 0.25f), RoundedCornerShape(12.dp))
            .padding(vertical = 12.dp, horizontal = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                "$count",
                color = tint,
                fontSize = 20.sp,
                fontWeight = FontWeight.Black,
                fontFamily = FontFamily.Monospace,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                title,
                color = Color.White.copy(alpha = 0.7f),
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
            )
            Text(
                "$pct%",
                color = Color.White.copy(alpha = 0.4f),
                fontSize = 9.5.sp,
            )
        }
    }
}

