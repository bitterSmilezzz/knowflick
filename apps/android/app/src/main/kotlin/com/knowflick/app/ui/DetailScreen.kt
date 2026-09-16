package com.knowflick.app.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.domain.CardThemeResolver
import com.knowflick.app.domain.KnowledgeCard

/** 详情页：整页摄影底图 + 遮罩 + 正文段落 + 延伸阅读 + 收藏切换 */
@Composable
fun DetailScreen(
    card: KnowledgeCard,
    isFavorite: Boolean,
    showAIMark: Boolean,
    isSpeakingState: Boolean,
    onToggleFavorite: () -> Unit,
    onToggleSpeech: () -> Unit,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val bg = rememberBackgroundImage(CardThemeResolver.forCard(card))

    // 系统返回键与屏内返回语义一致（否则返回键会直接退出应用）
    androidx.activity.compose.BackHandler { onBack() }

    Box(Modifier.fillMaxSize().background(Color(0xFF101012))) {
        Box(Modifier.fillMaxSize()) {
            if (bg != null) {
                Image(
                    bitmap = bg,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(
                            Brush.verticalGradient(
                                0f to Color.Black.copy(alpha = 0.55f),
                                0.35f to Color(0xE6141416),
                                1f to Color(0xFF101012),
                            ),
                        ),
                )
            }
        }

        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 54.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    card.category.ifBlank { "未分类" },
                    color = EditorialColor.aiAmber,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.width(12.dp))
                if (showAIMark && card.source == com.knowflick.app.domain.CardSource.AI) {
                    Text("AI 生成 · 请核实", color = Color(0xFFE4B45C), fontSize = 11.sp)
                }
            }
            Spacer(Modifier.height(10.dp))
            Text(
                card.headline,
                color = Color.White,
                fontSize = 24.sp,
                fontWeight = FontWeight.Black,
                fontFamily = FontFamily.Serif,
                lineHeight = 34.sp,
            )
            Spacer(Modifier.height(12.dp))
            Text(
                card.summary,
                color = Color.White.copy(alpha = 0.85f),
                fontSize = 16.sp,
                lineHeight = 24.sp,
                fontFamily = FontFamily.Serif,
            )
            Spacer(Modifier.height(26.dp))
            card.paragraphs.forEachIndexed { index, para ->
                if (index > 0) Spacer(Modifier.height(16.dp))
                Text(
                    para,
                    color = Color.White.copy(alpha = 0.78f),
                    fontSize = 13.5.sp,
                    lineHeight = 23.sp,
                )
            }
            if (card.links.isNotEmpty()) {
                Spacer(Modifier.height(30.dp))
                Text("延伸阅读", color = EditorialColor.aiAmber, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(10.dp))
                card.links.forEach { link ->
                    val linkUri = runCatching { Uri.parse(link.url) }.getOrNull()
                        ?.takeIf { it.scheme == "https" || it.scheme == "http" }
                    Text(
                        "◦ ${link.title}",
                        color = Color.White.copy(alpha = 0.65f),
                        fontSize = 12.sp,
                        lineHeight = 19.sp,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(
                                enabled = linkUri != null,
                                onClickLabel = "打开延伸阅读",
                            ) {
                                runCatching {
                                    context.startActivity(Intent(Intent.ACTION_VIEW, linkUri))
                                }
                            }
                            .padding(vertical = 8.dp),
                    )
                }
            }
        }

        // 顶栏浮动按钮：返回 / 朗读 / 收藏
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(
                onClick = onBack,
                modifier = Modifier.background(Color.White.copy(alpha = 0.12f), CircleShape),
            ) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回", tint = Color.White)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                IconButton(
                    onClick = { onToggleSpeech() },
                    modifier = Modifier.background(Color.White.copy(alpha = 0.12f), CircleShape),
                ) {
                    Icon(
                        if (isSpeakingState) Icons.Filled.Close else AppIcons.VolumeUp,
                        contentDescription = if (isSpeakingState) "停止朗读" else "朗读全文",
                        tint = if (isSpeakingState) EditorialColor.aiAmber else Color.White,
                    )
                }
                IconButton(
                    onClick = onToggleFavorite,
                    modifier = Modifier.background(Color.White.copy(alpha = 0.12f), CircleShape),
                ) {
                    Icon(
                        if (isFavorite) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                        contentDescription = "收藏或取消收藏",
                        tint = if (isFavorite) EditorialColor.likeGreen else Color.White,
                    )
                }
            }
        }
    }
}
