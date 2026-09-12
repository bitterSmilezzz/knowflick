package com.knowflick.app.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.data.ThemeKey
import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard

/**
 * 单张卡面：分类摄影底图 + 多阶暗化遮罩 + 宋体式衬线大标题。
 * 对齐 macOS 端 CardView / DynamicScrim 的视觉结构。
 */
@Composable
fun CardFace(
    card: KnowledgeCard,
    showAIMark: Boolean,
    modifier: Modifier = Modifier,
    isTop: Boolean = true,
) {
    val context = LocalContext.current
    val bg: ImageBitmap? = remember(card.id) { BackgroundImageCache.image(context, ThemeKey.forCard(card)) }

    Box(modifier = modifier.clip(RoundedCornerShape(18.dp))) {
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
                        0f to Color.Black.copy(alpha = 0.28f),
                        0.45f to Color.Black.copy(alpha = 0.45f),
                        1f to Color.Black.copy(alpha = 0.86f),
                    ),
                ),
        )

        Column(
            Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp, vertical = 20.dp),
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
                lineHeight = 34.sp,
            )
            Spacer(Modifier.height(14.dp))
            Text(
                card.summary,
                color = Color.White.copy(alpha = 0.82f),
                fontSize = 13.sp,
                lineHeight = 20.sp,
                maxLines = 4,
            )
            if (isTop) {
                Spacer(Modifier.height(18.dp))
                Text(
                    "点击卡片查看详情与来源 →",
                    color = Color.White.copy(alpha = 0.45f),
                    fontSize = 11.sp,
                )
            }
        }
    }
}

@Composable
private fun CategoryStamp(category: String) {
    Box(
        Modifier
            .background(Color.White.copy(alpha = 0.14f), RoundedCornerShape(7.dp))
            .padding(horizontal = 10.dp, vertical = 5.dp),
    ) {
        Text(
            category.ifBlank { "未分类" },
            color = Color.White.copy(alpha = 0.9f),
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            fontFamily = FontFamily.Serif,
        )
    }
}
