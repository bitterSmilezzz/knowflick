package com.knowflick.app.ui

import android.graphics.Bitmap
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.export.CardPosterBitmapRenderer
import com.knowflick.app.export.CardPosterStyle
import com.knowflick.app.export.PosterExportManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 卡片分享海报导出全屏覆盖面板。
 * 提供典雅画报风与文艺拍立得风实时预览，支持直接保存至系统相册或调起 Android 原生分享选择器。
 */
@Composable
fun CardPosterExportSheet(
    card: KnowledgeCard,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var selectedStyle by remember { mutableStateOf(CardPosterStyle.EDITORIAL) }
    var posterBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var isRendering by remember { mutableStateOf(true) }
    var toastMessage by remember { mutableStateOf<String?>(null) }

    fun showToast(msg: String) {
        toastMessage = msg
        scope.launch {
            delay(2200)
            if (toastMessage == msg) toastMessage = null
        }
    }

    // 后台光栅化生成高清海报
    LaunchedEffect(card.id, selectedStyle) {
        isRendering = true
        val bmp = withContext(Dispatchers.Default) {
            CardPosterBitmapRenderer.render(context, card, selectedStyle)
        }
        posterBitmap = bmp
        isRendering = false
    }

    // 拦截物理/手势返回键
    BackHandler(onBack = onClose)

    Box(
        modifier = modifier
            .fillMaxSize()
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = {},
            )
            .background(Color(0xF60E0E12))
            .statusBarsPadding()
            .navigationBarsPadding(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // 1. 顶栏：标题与关闭按钮
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = AppIcons.Sparkles,
                            contentDescription = null,
                            tint = EditorialColor.aiAmber,
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            "导出分享海报",
                            color = Color.White,
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Serif,
                        )
                    }
                    Spacer(Modifier.height(2.dp))
                    Text(
                        "出版物级质感长图 · 随时保存或分享",
                        color = Color.White.copy(alpha = 0.55f),
                        fontSize = 11.5.sp,
                    )
                }

                IconButton(
                    onClick = onClose,
                    modifier = Modifier
                        .size(34.dp)
                        .background(Color.White.copy(alpha = 0.08f), CircleShape),
                ) {
                    Icon(
                        Icons.Filled.Close,
                        contentDescription = "关闭",
                        tint = Color.White.copy(alpha = 0.8f),
                        modifier = Modifier.size(18.dp),
                    )
                }
            }

            Spacer(Modifier.height(12.dp))

            // 2. 风格切换分段器 (画报风 / 拍立得)
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(20.dp))
                    .background(Color.White.copy(alpha = 0.07f))
                    .padding(3.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                CardPosterStyle.entries.forEach { style ->
                    val isSelected = style == selectedStyle
                    val icon = if (style == CardPosterStyle.EDITORIAL) AppIcons.Newspaper else AppIcons.Camera
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(16.dp))
                            .background(if (isSelected) EditorialColor.aiAmber else Color.Transparent)
                            .clickable { selectedStyle = style }
                            .padding(horizontal = 16.dp, vertical = 7.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            imageVector = icon,
                            contentDescription = null,
                            tint = if (isSelected) Color.Black else Color.White.copy(alpha = 0.65f),
                            modifier = Modifier.size(14.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            style.title,
                            color = if (isSelected) Color.Black else Color.White.copy(alpha = 0.65f),
                            fontSize = 12.5.sp,
                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                        )
                    }
                }
            }

            Spacer(Modifier.height(10.dp))

            // 3. 中间海报实时缩放预览区
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(vertical = 4.dp),
                contentAlignment = Alignment.Center,
            ) {
                val bmp = posterBitmap
                if (bmp != null) {
                    Image(
                        bitmap = bmp.asImageBitmap(),
                        contentDescription = "海报预览",
                        contentScale = ContentScale.Fit,
                        modifier = Modifier
                            .fillMaxHeight()
                            .aspectRatio(selectedStyle.aspectRatio)
                            .shadow(24.dp, RoundedCornerShape(14.dp))
                            .clip(RoundedCornerShape(14.dp))
                            .border(1.dp, Color.White.copy(alpha = 0.15f), RoundedCornerShape(14.dp)),
                    )
                }

                if (isRendering) {
                    Box(
                        modifier = Modifier
                            .size(64.dp)
                            .background(Color.Black.copy(alpha = 0.65f), CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator(
                            color = EditorialColor.aiAmber,
                            strokeWidth = 3.dp,
                            modifier = Modifier.size(28.dp),
                        )
                    }
                }
            }

            Spacer(Modifier.height(12.dp))

            // 4. 底部动作按钮栏 (保存相册 / 系统分享 / 复制文本)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // 保存相册 (主动作)
                Row(
                    modifier = Modifier
                        .weight(1.2f)
                        .clip(RoundedCornerShape(12.dp))
                        .background(EditorialColor.aiAmber)
                        .clickable(enabled = posterBitmap != null) {
                            val b = posterBitmap ?: return@clickable
                            val res = PosterExportManager.saveToGallery(context, b, card)
                            if (res.isSuccess) {
                                showToast("✓ 已保存至系统相册 (Pictures/KnowFlick)")
                            } else {
                                showToast("保存失败：${res.exceptionOrNull()?.message ?: "未知错误"}")
                            }
                        }
                        .padding(vertical = 13.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = AppIcons.Download,
                        contentDescription = null,
                        tint = Color.Black,
                        modifier = Modifier.size(17.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        "保存相册",
                        color = Color.Black,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }

                // 系统分享 (副动作)
                Row(
                    modifier = Modifier
                        .weight(1.2f)
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color.White.copy(alpha = 0.12f))
                        .border(1.dp, Color.White.copy(alpha = 0.18f), RoundedCornerShape(12.dp))
                        .clickable(enabled = posterBitmap != null) {
                            val b = posterBitmap ?: return@clickable
                            val intent = PosterExportManager.createShareIntent(context, b, card)
                            context.startActivity(intent)
                            showToast("已唤起系统分享菜单")
                        }
                        .padding(vertical = 13.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = Icons.Filled.Share,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        "系统分享",
                        color = Color.White,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                    )
                }

                // 复制文本
                IconButton(
                    onClick = {
                        PosterExportManager.copyCardText(context, card)
                        showToast("✓ 卡片文本已复制")
                    },
                    modifier = Modifier
                        .size(46.dp)
                        .background(Color.White.copy(alpha = 0.08f), RoundedCornerShape(12.dp))
                        .border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(12.dp)),
                ) {
                    Icon(
                        AppIcons.ContentCopy,
                        contentDescription = "复制文本",
                        tint = Color.White.copy(alpha = 0.8f),
                        modifier = Modifier.size(17.dp),
                    )
                }
            }
        }

        // 浮动 Toast 反馈
        AnimatedVisibility(
            visible = toastMessage != null,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 78.dp),
        ) {
            toastMessage?.let { msg ->
                Surface(
                    shape = RoundedCornerShape(20.dp),
                    color = Color(0xF0202228),
                    border = androidx.compose.foundation.BorderStroke(1.dp, Color.White.copy(alpha = 0.2f)),
                    shadowElevation = 8.dp,
                ) {
                    Text(
                        text = msg,
                        color = Color.White,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(horizontal = 18.dp, vertical = 9.dp),
                    )
                }
            }
        }
    }
}
