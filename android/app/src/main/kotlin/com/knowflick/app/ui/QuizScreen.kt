package com.knowflick.app.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.data.CategoryStampColor
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.QuizRating
import com.knowflick.app.domain.QuizSession

/**
 * 知识测验（主动回忆）：正面主张 → 点击/空格翻面看解析 → 三档自评写回熟练度。
 * 与 macOS QuizView 同语义：评分经 AppStore 记账，到期队列随评分刷新。
 */
@Composable
fun QuizScreen(
    session: QuizSession,
    onRate: (QuizRating) -> Unit,
    onNextRound: () -> Unit,
    onExit: () -> Unit,
) {
    androidx.activity.compose.BackHandler { onExit() }

    var flipped by remember(session) { mutableStateOf(false) }
    val card = session.current

    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        // 顶栏：退出 + 进度
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onExit) {
                Icon(Icons.Filled.Close, contentDescription = "退出测验", tint = MaterialTheme.colorScheme.onBackground)
            }
            Text(
                "知识测验",
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 17.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Serif,
            )
            Spacer(Modifier.weight(1f))
            Text(
                if (session.isFinished) "完成" else "${session.index + 1} / ${session.total}",
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
                fontSize = 13.sp,
                fontFamily = FontFamily.Monospace,
            )
        }
        LinearProgressIndicator(
            progress = { if (session.total == 0) 1f else session.index.toFloat() / session.total },
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp),
        )

        if (card == null) {
            QuizSummary(session = session, onNextRound = onNextRound, onExit = onExit)
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
private fun RowScope.RatingButton(label: String, tint: androidx.compose.ui.graphics.Color, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .weight(1f)
            .clip(RoundedCornerShape(10.dp))
            .background(tint.copy(alpha = if (enabled) 0.9f else 0.25f))
            .clickable(enabled = enabled) { onClick() }
            .padding(vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = androidx.compose.ui.graphics.Color(0xFF121212), fontSize = 12.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun QuizSummary(session: QuizSession, onNextRound: () -> Unit, onExit: () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            "本轮完成",
            color = MaterialTheme.colorScheme.onBackground,
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
            fontFamily = FontFamily.Serif,
        )
        Spacer(Modifier.height(16.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(26.dp)) {
            SummaryCell("掌握", session.summary[QuizRating.MASTERED] ?: 0, EditorialColor.likeGreen)
            SummaryCell("犹豫", session.summary[QuizRating.HESITANT] ?: 0, EditorialColor.aiAmber)
            SummaryCell("遗忘", session.summary[QuizRating.FORGOT] ?: 0, EditorialColor.dislikeRed)
        }
        Spacer(Modifier.height(28.dp))
        TextButton(onClick = onNextRound) {
            Text("再测一组 ↻", color = EditorialColor.aiAmber, fontSize = 15.sp, fontWeight = FontWeight.Bold)
        }
        TextButton(onClick = onExit) {
            Text("返回卡堆", color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f), fontSize = 13.sp)
        }
    }
}

@Composable
private fun SummaryCell(label: String, value: Int, tint: androidx.compose.ui.graphics.Color) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value.toString(), color = tint, fontSize = 26.sp, fontWeight = FontWeight.Black, fontFamily = FontFamily.Monospace)
        Text(label, color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.55f), fontSize = 11.sp)
    }
}
