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
) {
    val bg = rememberBackgroundImage(CardThemeResolver.forCard(card))
    val cardShape = RoundedCornerShape(20.dp)

    Box(
        modifier = modifier
            .clip(cardShape)
            .border(
                1.dp,
                Brush.verticalGradient(
                    listOf(
                        Color.White.copy(alpha = 0.25f),
                        Color.White.copy(alpha = 0.08f),
                    ),
                ),
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
            Box(Modifier.fillMaxSize().background(Color(0xFF232326)))
        }
        // 动态遮罩：上部轻度暗化 + 底部重渐变，保证文字对比度
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        0f to Color.Black.copy(alpha = 0.22f),
                        0.40f to Color.Black.copy(alpha = 0.40f),
                        0.72f to Color.Black.copy(alpha = 0.76f),
                        1f to Color.Black.copy(alpha = 0.92f),
                    ),
                ),
        )

        // 滑动意图实时反馈印章（向右收藏 / 向左略过）
        if (isTop && swipeProgress != 0f) {
            val isRight = swipeProgress > 0f
            val progress = kotlin.math.abs(swipeProgress)
            val stampAlpha = ((progress - 0.10f) / 0.40f).coerceIn(0f, 1f)
            if (stampAlpha > 0f) {
                val stampColor = if (isRight) EditorialColor.likeGreen else EditorialColor.dislikeRed
                val stampText = if (isRight) "♥ 收藏" else "✕ 略过"
                val stampRotation = if (isRight) -12f else 12f
                val stampScale = 0.85f + 0.15f * stampAlpha

                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(
                            start = if (!isRight) 48.dp else 0.dp,
                            end = if (isRight) 48.dp else 0.dp,
                            top = 100.dp,
                        ),
                    contentAlignment = if (isRight) Alignment.TopEnd else Alignment.TopStart,
                ) {
                    Box(
                        modifier = Modifier
                            .rotate(stampRotation)
                            .scale(stampScale)
                            .clip(RoundedCornerShape(10.dp))
                            .background(stampColor.copy(alpha = stampAlpha * 0.22f))
                            .border(2.dp, stampColor.copy(alpha = stampAlpha * 0.90f), RoundedCornerShape(10.dp))
                            .padding(horizontal = 14.dp, vertical = 6.dp),
                    ) {
                        Text(
                            text = stampText,
                            color = stampColor.copy(alpha = stampAlpha),
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Black,
                            letterSpacing = 2.sp,
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
                    Spacer(Modifier.width(10.dp))
                    Text(
                        "AI 生成",
                        color = Color(0xFFE4B45C),
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .background(Color(0x33C79A4B), RoundedCornerShape(6.dp))
                            .border(0.6.dp, Color(0x66C79A4B), RoundedCornerShape(6.dp))
                            .padding(horizontal = 8.dp, vertical = 3.dp),
                    )
                }
            }
            Spacer(Modifier.weight(1f))
            Text(
                card.headline,
                color = Color.White,
                fontSize = 24.sp,
                fontWeight = FontWeight.Black,
                fontFamily = FontFamily.Serif,
                lineHeight = 33.sp,
                style = TextStyle(
                    shadow = Shadow(
                        color = Color.Black.copy(alpha = 0.5f),
                        offset = Offset(0f, 2f),
                        blurRadius = 6f,
                    ),
                ),
            )
            Spacer(Modifier.height(14.dp))
            Text(
                card.summary,
                color = Color.White.copy(alpha = 0.85f),
                fontSize = 13.5.sp,
                lineHeight = 21.sp,
                maxLines = 4,
            )
            if (isTop) {
                Spacer(Modifier.height(18.dp))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .background(Color.White.copy(alpha = 0.12f), RoundedCornerShape(12.dp))
                        .border(0.6.dp, Color.White.copy(alpha = 0.20f), RoundedCornerShape(12.dp))
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                ) {
                    Text(
                        "点击卡片查看详情与来源 →",
                        color = Color.White.copy(alpha = 0.85f),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Medium,
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
            .background(Color.White.copy(alpha = 0.16f), RoundedCornerShape(8.dp))
            .border(0.6.dp, Color.White.copy(alpha = 0.28f), RoundedCornerShape(8.dp))
            .padding(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Text(
            category.ifBlank { "未分类" },
            color = Color.White.copy(alpha = 0.95f),
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            fontFamily = FontFamily.Serif,
            letterSpacing = 0.6.sp,
        )
    }
}

