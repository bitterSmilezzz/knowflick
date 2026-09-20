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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.domain.CardThemeResolver
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.ui.common.HapticFeedbackHelper

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
    savedChatMessageIds: Set<String> = emptySet(),
    onOpenChat: () -> Unit = {},
    onCloseChat: () -> Unit = {},
    onSendChatMessage: (String) -> Unit = {},
    onCancelChatStreaming: () -> Unit = {},
    onClearChatSession: () -> Unit = {},
    onSpeakChatMessage: (String) -> Unit = {},
    onDeriveCardFromChat: (messageId: String, content: String) -> Unit = { _, _ -> },
    onExportChatMarkdown: () -> Unit = {},
    relatedCards: List<KnowledgeCard> = emptyList(),
    onSelectRelatedCard: (KnowledgeCard) -> Unit = {},
) {
    val context = LocalContext.current
    val bg = rememberBackgroundImage(CardThemeResolver.forCard(card))
    var showChatSheet by remember { mutableStateOf(false) }
    var showPosterSheet by remember { mutableStateOf(false) }

    val isDark = MaterialTheme.colorScheme.background.red < 0.2f
    val bgColor = MaterialTheme.colorScheme.background
    val textColorPrimary = MaterialTheme.colorScheme.onBackground
    val textColorSecondary = textColorPrimary.copy(alpha = if (isDark) 0.88f else 0.78f)
    val textColorTertiary = textColorPrimary.copy(alpha = if (isDark) 0.65f else 0.55f)

    // 系统返回键与屏内返回语义一致（弹窗展开时拦截返回键优先关闭弹窗）
    androidx.activity.compose.BackHandler(enabled = !showChatSheet && !showPosterSheet) { onBack() }

    Box(Modifier.fillMaxSize().background(bgColor)) {
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
                            if (isDark) {
                                Brush.verticalGradient(
                                    0f to Color.Black.copy(alpha = 0.50f),
                                    0.30f to Color(0xD9141416),
                                    1f to bgColor,
                                )
                            } else {
                                Brush.verticalGradient(
                                    0f to bgColor.copy(alpha = 0.35f),
                                    0.28f to bgColor.copy(alpha = 0.88f),
                                    1f to bgColor,
                                )
                            },
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
                color = textColorPrimary,
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Serif,
                lineHeight = 34.sp,
                letterSpacing = (-0.3).sp,
            )
            Spacer(Modifier.height(14.dp))
            Text(
                card.summary,
                color = textColorSecondary,
                fontSize = 15.5.sp,
                lineHeight = 24.sp,
                fontFamily = FontFamily.Serif,
            )
            Spacer(Modifier.height(28.dp))
            card.paragraphs.forEachIndexed { idx, para ->
                if (idx > 0) Spacer(Modifier.height(18.dp))
                com.knowflick.app.ui.common.MarkdownText(
                    markdown = para,
                    color = textColorSecondary,
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
                            .background(if (isDark) Color.White.copy(alpha = 0.06f) else MaterialTheme.colorScheme.surface)
                            .border(1.dp, if (isDark) Color.White.copy(alpha = 0.12f) else MaterialTheme.colorScheme.outline, RoundedCornerShape(10.dp))
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
                            color = textColorPrimary.copy(alpha = 0.85f),
                            fontSize = 12.5.sp,
                            lineHeight = 18.sp,
                            modifier = Modifier.weight(1f),
                        )
                        Spacer(Modifier.width(8.dp))
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                            contentDescription = null,
                            tint = textColorTertiary,
                            modifier = Modifier.size(13.dp),
                        )
                    }
                }
            }

            // 关联知识探索（推荐阅读同领域/关联知识卡片）
            if (relatedCards.isNotEmpty()) {
                Spacer(Modifier.height(32.dp))
                Text(
                    "关联知识探索",
                    color = EditorialColor.aiAmber,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.6.sp,
                )
                Spacer(Modifier.height(12.dp))
                relatedCards.forEach { related ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (isDark) Color.White.copy(alpha = 0.05f) else MaterialTheme.colorScheme.surface)
                            .border(1.dp, if (isDark) Color.White.copy(alpha = 0.10f) else MaterialTheme.colorScheme.outline, RoundedCornerShape(12.dp))
                            .clickable {
                                HapticFeedbackHelper.click(context)
                                onSelectRelatedCard(related)
                            }
                            .padding(14.dp),
                    ) {
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(EditorialColor.aiAmber.copy(alpha = 0.14f))
                                .padding(horizontal = 7.dp, vertical = 3.dp)
                        ) {
                            Text(
                                related.category,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                color = EditorialColor.aiAmber,
                            )
                        }
                        Spacer(Modifier.width(10.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                related.headline,
                                fontSize = 13.5.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Serif,
                                color = textColorPrimary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Spacer(Modifier.height(2.dp))
                            Text(
                                related.summary,
                                fontSize = 11.5.sp,
                                color = textColorTertiary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        Spacer(Modifier.width(8.dp))
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                            contentDescription = null,
                            tint = textColorTertiary,
                            modifier = Modifier.size(14.dp),
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                }
            }

            Spacer(Modifier.height(28.dp))
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(EditorialColor.aiAmber.copy(alpha = if (isDark) 0.10f else 0.08f))
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
                        Text("AI 伴学深度追问", color = textColorPrimary, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(2.dp))
                        Text("探究底层机理、现实案例与跨学科碰撞", color = textColorTertiary, fontSize = 11.5.sp)
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

        // 顶栏浮动按钮：返回 / 朗读 / 收藏 / AI 伴学（微透圆钮 + 1px 细发丝边框，自适应深浅纸质底色）
        val btnBg = if (isDark) Color.White.copy(alpha = 0.12f) else MaterialTheme.colorScheme.surface.copy(alpha = 0.88f)
        val btnBorder = if (isDark) Color.White.copy(alpha = 0.18f) else MaterialTheme.colorScheme.outline
        val btnIconTint = textColorPrimary

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
                    .background(btnBg, CircleShape)
                    .border(1.dp, btnBorder, CircleShape),
            ) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回", tint = btnIconTint)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                IconButton(
                    onClick = {
                        showChatSheet = true
                        onOpenChat()
                    },
                    modifier = Modifier
                        .background(btnBg, CircleShape)
                        .border(1.dp, btnBorder, CircleShape),
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
                        .background(btnBg, CircleShape)
                        .border(1.dp, btnBorder, CircleShape),
                ) {
                    Icon(
                        if (isSpeakingState) Icons.Filled.Close else AppIcons.VolumeUp,
                        contentDescription = if (isSpeakingState) "停止朗读" else "朗读全文",
                        tint = if (isSpeakingState) EditorialColor.aiAmber else btnIconTint,
                    )
                }
                IconButton(
                    onClick = { showPosterSheet = true },
                    modifier = Modifier
                        .background(btnBg, CircleShape)
                        .border(1.dp, btnBorder, CircleShape),
                ) {
                    Icon(
                        Icons.Filled.Share,
                        contentDescription = "导出分享海报",
                        tint = btnIconTint,
                    )
                }
                IconButton(
                    onClick = onToggleFavorite,
                    modifier = Modifier
                        .background(btnBg, CircleShape)
                        .border(1.dp, btnBorder, CircleShape),
                ) {
                    Icon(
                        if (isFavorite) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                        contentDescription = "收藏或取消收藏",
                        tint = if (isFavorite) EditorialColor.likeGreen else btnIconTint,
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
                savedMessageIds = savedChatMessageIds,
                onSendMessage = onSendChatMessage,
                onCancelStreaming = onCancelChatStreaming,
                onClearSession = onClearChatSession,
                onSpeakMessage = onSpeakChatMessage,
                onDeriveCard = onDeriveCardFromChat,
                onExportMarkdown = onExportChatMarkdown,
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
