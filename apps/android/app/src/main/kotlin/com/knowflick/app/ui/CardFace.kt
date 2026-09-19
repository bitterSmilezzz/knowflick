package com.knowflick.app.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.domain.CardThemeResolver
import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard

/**
 * 单张卡面：分类摄影底图 + 多阶暗化遮罩 + 宋体式衬线大标题 + 交互滑动印章。
 * 对齐 macOS 端 CardView / DynamicScrim 的视觉结构。
 */
@Composable
fun CardFace(
    card: KnowledgeCard,
    showAIMark: Boolean,
    modifier: Modifier = Modifier,
    isTop: Boolean = true,
    swipeProgress: Float = 0f,
    isReviewMode: Boolean = false,
) {
    val bg = rememberBackgroundImage(CardThemeResolver.forCard(card))
    val cardShape = RoundedCornerShape(22.dp)

    Box(
        modifier = modifier
            .clip(cardShape)
            .border(
                1.dp,
                Color.White.copy(alpha = 0.15f),
                cardShape,
            ),
    ) {
        if (bg != null) {
            Image(
                bitmap = bg,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Box(Modifier.fillMaxSize().background(Color(0xFF161619)))
        }
        // 动态通透遮罩：顶部保留摄影通透光感，中下段提供舒适阅读微衬
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        0f to Color.Black.copy(alpha = 0.14f),
                        0.32f to Color.Black.copy(alpha = 0.28f),
                        0.64f to Color.Black.copy(alpha = 0.58f),
                        1f to Color.Black.copy(alpha = 0.82f),
                    ),
                ),
        )

        // 滑动意图实时反馈印章（向右收藏 / 向左略过）
        if (isTop && swipeProgress != 0f) {
            val isRight = swipeProgress > 0f
            val progress = kotlin.math.abs(swipeProgress)
            // 设定 0.28f 死区：微小拖动或轻微颤动不唤醒印章，在 [0.28f, 0.80f] 之间平滑渐变
            val stampAlpha = ((progress - 0.28f) / 0.52f).coerceIn(0f, 1f)
            if (stampAlpha > 0f) {
                val stampColor = if (isRight) EditorialColor.likeGreen else EditorialColor.dislikeRed
                val stampText = if (isRight) "♥ 收藏" else "✕ 略过"
                val stampRotation = if (isRight) -10f else 10f
                val stampScale = 0.88f + 0.12f * stampAlpha

                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(
                            start = if (!isRight) 44.dp else 0.dp,
                            end = if (isRight) 44.dp else 0.dp,
                            top = 96.dp,
                        ),
                    contentAlignment = if (isRight) Alignment.TopEnd else Alignment.TopStart,
                ) {
                    Box(
                        modifier = Modifier
                            .rotate(stampRotation)
                            .scale(stampScale)
                            .clip(RoundedCornerShape(8.dp))
                            .background(stampColor.copy(alpha = stampAlpha * 0.18f))
                            .border(1.5.dp, stampColor.copy(alpha = stampAlpha * 0.85f), RoundedCornerShape(8.dp))
                            .padding(horizontal = 14.dp, vertical = 5.dp),
                    ) {
                        Text(
                            text = stampText,
                            color = stampColor.copy(alpha = stampAlpha),
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 1.5.sp,
                        )
                    }
                }
            }
        }

        Column(
            Modifier
                .fillMaxSize()
                .padding(horizontal = 22.dp, vertical = 22.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CategoryStamp(category = card.category)
                if (showAIMark && card.source == CardSource.AI) {
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "AI 生成",
                        color = Color(0xFFF0CA7D),
                        fontSize = 10.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier
                            .background(Color(0x28C79A4B), RoundedCornerShape(6.dp))
                            .border(1.dp, Color(0x4DC79A4B), RoundedCornerShape(6.dp))
                            .padding(horizontal = 8.dp, vertical = 3.5.dp),
                    )
                }
                if (isReviewMode) {
                    val retrievability = remember(card.id, card.lastReviewedAt) {
                        com.knowflick.app.domain.spaced.SpacedRepetitionEngine.calculateRetrievability(card)
                    }
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "🧠 留存 $retrievability% · ${card.intervalDays}天间隔",
                        color = Color(0xFF86D2C4),
                        fontSize = 10.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier
                            .background(Color(0x2426A69A), RoundedCornerShape(6.dp))
                            .border(1.dp, Color(0x4426A69A), RoundedCornerShape(6.dp))
                            .padding(horizontal = 8.dp, vertical = 3.5.dp),
                    )
                }
            }
            Spacer(Modifier.weight(1f))
            Text(
                card.headline,
                color = Color.White,
                fontSize = 23.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Serif,
                lineHeight = 32.sp,
                letterSpacing = (-0.3).sp,
                style = TextStyle(
                    shadow = Shadow(
                        color = Color.Black.copy(alpha = 0.35f),
                        offset = Offset(0f, 1f),
                        blurRadius = 2f,
                    ),
                ),
            )
            Spacer(Modifier.height(12.dp))
            Text(
                card.summary,
                color = Color.White.copy(alpha = 0.88f),
                fontSize = 13.5.sp,
                lineHeight = 22.sp,
                letterSpacing = 0.1.sp,
                maxLines = 4,
            )
            if (isTop) {
                Spacer(Modifier.height(16.dp))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .background(Color.White.copy(alpha = 0.10f), RoundedCornerShape(14.dp))
                        .border(1.dp, Color.White.copy(alpha = 0.16f), RoundedCornerShape(14.dp))
                        .padding(horizontal = 12.dp, vertical = 5.dp),
                ) {
                    Text(
                        "点击卡片查看详情与来源 →",
                        color = Color.White.copy(alpha = 0.82f),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Normal,
                        letterSpacing = 0.2.sp,
                    )
                }
            }
        }
    }
}

@Composable
private fun CategoryStamp(category: String) {
    Box(
        Modifier
            .background(Color.White.copy(alpha = 0.14f), RoundedCornerShape(6.dp))
            .border(1.dp, Color.White.copy(alpha = 0.22f), RoundedCornerShape(6.dp))
            .padding(horizontal = 9.dp, vertical = 3.5.dp),
    ) {
        Text(
            category.ifBlank { "未分类" },
            color = Color.White.copy(alpha = 0.95f),
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
            fontFamily = FontFamily.Serif,
            letterSpacing = 0.8.sp,
        )
    }
}

