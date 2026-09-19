package com.knowflick.app.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.clip
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
    chatSession: com.knowflick.app.ai.CardChatSession? = null,
    isChatStreaming: Boolean = false,
    chatErrorMessage: String? = null,
    onOpenChat: () -> Unit = {},
    onCloseChat: () -> Unit = {},
    onSendChatMessage: (String) -> Unit = {},
    onCancelChatStreaming: () -> Unit = {},
    onClearChatSession: () -> Unit = {},
    onSpeakChatMessage: (String) -> Unit = {},
) {
    val context = LocalContext.current
    val bg = rememberBackgroundImage(CardThemeResolver.forCard(card))
    var showChatSheet by remember { mutableStateOf(false) }
    var showPosterSheet by remember { mutableStateOf(false) }

    // 系统返回键与屏内返回语义一致（弹窗展开时拦截返回键优先关闭弹窗）
    androidx.activity.compose.BackHandler(enabled = !showChatSheet && !showPosterSheet) { onBack() }

    Box(Modifier.fillMaxSize().background(Color(0xFF121215))) {
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
                                0f to Color.Black.copy(alpha = 0.50f),
                                0.30f to Color(0xD9141416),
                                1f to Color(0xFF121215),
                            ),
                        ),
                )
            }
        }

        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 22.dp, vertical = 56.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    card.category.ifBlank { "未分类" },
                    color = EditorialColor.aiAmber,
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = 0.8.sp,
                )
                Spacer(Modifier.width(10.dp))
                if (showAIMark && card.source == com.knowflick.app.domain.CardSource.AI) {
                    Text(
                        "AI 生成 · 请核实",
                        color = Color(0xFFF0CA7D),
                        fontSize = 10.5.sp,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }
            Spacer(Modifier.height(12.dp))
            Text(
                card.headline,
                color = Color.White,
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Serif,
                lineHeight = 34.sp,
                letterSpacing = (-0.3).sp,
            )
            Spacer(Modifier.height(14.dp))
            Text(
                card.summary,
                color = Color.White.copy(alpha = 0.88f),
                fontSize = 15.5.sp,
                lineHeight = 24.sp,
                fontFamily = FontFamily.Serif,
            )
            Spacer(Modifier.height(28.dp))
            card.paragraphs.forEachIndexed { idx, para ->
                if (idx > 0) Spacer(Modifier.height(18.dp))
                com.knowflick.app.ui.common.MarkdownText(
                    markdown = para,
                    color = Color.White.copy(alpha = 0.85f),
                    style = androidx.compose.ui.text.TextStyle(
                        fontSize = 14.sp,
                        lineHeight = 24.sp,
                        letterSpacing = 0.15.sp,
                    ),
                )
            }
            if (card.links.isNotEmpty()) {
                Spacer(Modifier.height(32.dp))
                Text(
                    "延伸阅读",
                    color = EditorialColor.aiAmber,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.6.sp,
                )
                Spacer(Modifier.height(12.dp))
                card.links.forEachIndexed { linkIdx, link ->
                    if (linkIdx > 0) Spacer(Modifier.height(8.dp))
                    val linkUri = runCatching { Uri.parse(link.url) }.getOrNull()
                        ?.takeIf { it.scheme == "https" || it.scheme == "http" }
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(Color.White.copy(alpha = 0.06f))
                            .border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(10.dp))
                            .clickable(
                                enabled = linkUri != null,
                                onClickLabel = "打开延伸阅读",
                            ) {
                                runCatching {
                                    context.startActivity(Intent(Intent.ACTION_VIEW, linkUri))
                                }
                            }
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Filled.Share,
                            contentDescription = null,
                            tint = EditorialColor.aiAmber.copy(alpha = 0.85f),
                            modifier = Modifier.size(14.dp),
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            link.title,
                            color = Color.White.copy(alpha = 0.82f),
                            fontSize = 12.5.sp,
                            lineHeight = 18.sp,
                            modifier = Modifier.weight(1f),
                        )
                        Spacer(Modifier.width(8.dp))
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                            contentDescription = null,
                            tint = Color.White.copy(alpha = 0.35f),
                            modifier = Modifier.size(13.dp),
                        )
                    }
                }
            }
            Spacer(Modifier.height(28.dp))
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(EditorialColor.aiAmber.copy(alpha = 0.10f))
                    .border(1.dp, EditorialColor.aiAmber.copy(alpha = 0.32f), RoundedCornerShape(14.dp))
                    .clickable {
                        showChatSheet = true
                        onOpenChat()
                    }
                    .padding(16.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = AppIcons.Sparkles,
                        contentDescription = null,
                        tint = EditorialColor.aiAmber,
                        modifier = Modifier.size(20.dp),
                    )
                    Spacer(Modifier.width(12.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text("AI 伴学深度追问", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(2.dp))
                        Text("探究底层机理、现实案例与跨学科碰撞", color = Color.White.copy(alpha = 0.65f), fontSize = 11.5.sp)
                    }
                    Icon(
                        imageVector = AppIcons.ArrowUp,
                        contentDescription = null,
                        tint = EditorialColor.aiAmber,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
            Spacer(Modifier.height(40.dp))
        }

        // 顶栏浮动按钮：返回 / 朗读 / 收藏 / AI 伴学（微透圆钮 + 1px 细发丝边框）
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(
                onClick = onBack,
                modifier = Modifier
                    .background(Color.White.copy(alpha = 0.12f), CircleShape)
                    .border(1.dp, Color.White.copy(alpha = 0.18f), CircleShape),
            ) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回", tint = Color.White)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                IconButton(
                    onClick = {
                        showChatSheet = true
                        onOpenChat()
                    },
                    modifier = Modifier
                        .background(Color.White.copy(alpha = 0.12f), CircleShape)
                        .border(1.dp, Color.White.copy(alpha = 0.18f), CircleShape),
                ) {
                    Icon(
                        AppIcons.Sparkles,
                        contentDescription = "AI 伴学追问",
                        tint = EditorialColor.aiAmber,
                    )
                }
                IconButton(
                    onClick = { onToggleSpeech() },
                    modifier = Modifier
                        .background(Color.White.copy(alpha = 0.12f), CircleShape)
                        .border(1.dp, Color.White.copy(alpha = 0.18f), CircleShape),
                ) {
                    Icon(
                        if (isSpeakingState) Icons.Filled.Close else AppIcons.VolumeUp,
                        contentDescription = if (isSpeakingState) "停止朗读" else "朗读全文",
                        tint = if (isSpeakingState) EditorialColor.aiAmber else Color.White,
                    )
                }
                IconButton(
                    onClick = { showPosterSheet = true },
                    modifier = Modifier
                        .background(Color.White.copy(alpha = 0.12f), CircleShape)
                        .border(1.dp, Color.White.copy(alpha = 0.18f), CircleShape),
                ) {
                    Icon(
                        Icons.Filled.Share,
                        contentDescription = "导出分享海报",
                        tint = Color.White,
                    )
                }
                IconButton(
                    onClick = onToggleFavorite,
                    modifier = Modifier
                        .background(Color.White.copy(alpha = 0.12f), CircleShape)
                        .border(1.dp, Color.White.copy(alpha = 0.18f), CircleShape),
                ) {
                    Icon(
                        if (isFavorite) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                        contentDescription = "收藏或取消收藏",
                        tint = if (isFavorite) EditorialColor.likeGreen else Color.White,
                    )
                }
            }
        }

        if (showChatSheet) {
            CardFollowUpChatSheet(
                card = card,
                session = chatSession,
                isStreaming = isChatStreaming,
                errorMessage = chatErrorMessage,
                onSendMessage = onSendChatMessage,
                onCancelStreaming = onCancelChatStreaming,
                onClearSession = onClearChatSession,
                onSpeakMessage = onSpeakChatMessage,
                onClose = {
                    showChatSheet = false
                    onCloseChat()
                },
            )
        }

        if (showPosterSheet) {
            CardPosterExportSheet(
                card = card,
                onClose = { showPosterSheet = false },
            )
        }
    }
}
