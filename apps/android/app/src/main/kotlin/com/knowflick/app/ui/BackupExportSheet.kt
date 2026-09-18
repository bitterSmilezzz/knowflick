package com.knowflick.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.data.ArchiveExportFormat
import com.knowflick.app.data.ArchiveExportScope
import com.knowflick.app.data.CardArchiveEngine
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.export.ArchiveExportManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 离线归档与全量备份导出浮层面板 (Backup & Export Sheet)
 */
@Composable
fun BackupExportSheet(
    allCards: List<KnowledgeCard>,
    favoriteCards: List<KnowledgeCard>,
    historyCards: List<KnowledgeCard>,
    settingsJson: String? = null,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var selectedScope by remember { mutableStateOf(ArchiveExportScope.ALL) }
    var selectedFormat by remember { mutableStateOf(ArchiveExportFormat.ZIP_FULL_BACKUP) }
    var isExporting by remember { mutableStateOf(false) }
    var toastMessage by remember { mutableStateOf<String?>(null) }

    fun showToast(msg: String) {
        toastMessage = msg
        scope.launch {
            delay(2800)
            if (toastMessage == msg) toastMessage = null
        }
    }

    val targetCards = when (selectedScope) {
        ArchiveExportScope.ALL -> allCards
        ArchiveExportScope.FAVORITES -> favoriteCards
        ArchiveExportScope.HISTORY -> historyCards
    }

    fun handleSaveToDownloads() {
        if (isExporting) return
        if (targetCards.isEmpty()) {
            showToast("选定范围无任何卡片，无法导出")
            return
        }
        isExporting = true
        scope.launch {
            try {
                val (filename, bytes) = withContext(Dispatchers.Default) {
                    CardArchiveEngine.generateExportData(
                        cards = targetCards,
                        format = selectedFormat,
                        settingsJson = settingsJson,
                    )
                }
                val result = withContext(Dispatchers.IO) {
                    ArchiveExportManager.saveToDownloads(
                        context = context,
                        filename = filename,
                        mimeType = selectedFormat.mimeType,
                        bytes = bytes,
                    )
                }
                result.fold(
                    onSuccess = { path ->
                        showToast("已成功保存至 $path ✓")
                    },
                    onFailure = { err ->
                        showToast("保存失败：${err.message ?: "未知异常"}")
                    },
                )
            } catch (e: Exception) {
                showToast("导出失败：${e.message}")
            } finally {
                isExporting = false
            }
        }
    }

    fun handleShareViaChooser() {
        if (isExporting) return
        if (targetCards.isEmpty()) {
            showToast("选定范围无任何卡片，无法分享")
            return
        }
        isExporting = true
        scope.launch {
            try {
                val (filename, bytes) = withContext(Dispatchers.Default) {
                    CardArchiveEngine.generateExportData(
                        cards = targetCards,
                        format = selectedFormat,
                        settingsJson = settingsJson,
                    )
                }
                val result = withContext(Dispatchers.IO) {
                    ArchiveExportManager.createShareIntent(
                        context = context,
                        filename = filename,
                        mimeType = selectedFormat.mimeType,
                        bytes = bytes,
                        chooserTitle = "分享 ${selectedFormat.title}",
                    )
                }
                result.fold(
                    onSuccess = { intent ->
                        context.startActivity(intent)
                    },
                    onFailure = { err ->
                        showToast("分享唤起失败：${err.message ?: "未知异常"}")
                    },
                )
            } catch (e: Exception) {
                showToast("导出失败：${e.message}")
            } finally {
                isExporting = false
            }
        }
    }

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
                .padding(horizontal = 20.dp, vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // 顶部下拉指示小横条
            Box(
                modifier = Modifier
                    .width(42.dp)
                    .height(4.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(Color.White.copy(alpha = 0.25f)),
            )

            Spacer(Modifier.height(12.dp))

            // 顶栏：标题与关闭按钮
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(
                        imageVector = AppIcons.Archive,
                        contentDescription = null,
                        tint = EditorialColor.aiAmber,
                        modifier = Modifier.size(24.dp),
                    )
                    Text(
                        text = "数据归档与全量备份",
                        color = Color.White,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Serif,
                    )
                }

                IconButton(
                    onClick = onClose,
                    modifier = Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = 0.08f)),
                ) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "关闭",
                        tint = Color.White.copy(alpha = 0.8f),
                        modifier = Modifier.size(20.dp),
                    )
                }
            }

            Spacer(Modifier.height(16.dp))

            // 可滚动内容区
            Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
            ) {
                // 1. 导出范围分段器
                Text(
                    text = "导出范围",
                    color = Color.White.copy(alpha = 0.6f),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                )

                Spacer(Modifier.height(8.dp))

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color(0xFF1B1B22))
                        .padding(4.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    ArchiveExportScope.entries.forEach { scopeItem ->
                        val isSelected = selectedScope == scopeItem
                        val count = when (scopeItem) {
                            ArchiveExportScope.ALL -> allCards.size
                            ArchiveExportScope.FAVORITES -> favoriteCards.size
                            ArchiveExportScope.HISTORY -> historyCards.size
                        }
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(8.dp))
                                .background(
                                    if (isSelected) EditorialColor.aiAmber.copy(alpha = 0.2f)
                                    else Color.Transparent,
                                )
                                .border(
                                    width = if (isSelected) 1.dp else 0.dp,
                                    color = if (isSelected) EditorialColor.aiAmber else Color.Transparent,
                                    shape = RoundedCornerShape(8.dp),
                                )
                                .clickable { selectedScope = scopeItem }
                                .padding(vertical = 10.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(
                                    text = scopeItem.title,
                                    color = if (isSelected) EditorialColor.aiAmber else Color.White.copy(alpha = 0.7f),
                                    fontSize = 13.sp,
                                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                )
                                Text(
                                    text = "${count}张",
                                    color = if (isSelected) EditorialColor.aiAmber.copy(alpha = 0.85f) else Color.White.copy(alpha = 0.4f),
                                    fontSize = 11.sp,
                                )
                            }
                        }
                    }
                }

                Spacer(Modifier.height(20.dp))

                // 2. 导出格式选择
                Text(
                    text = "导出格式",
                    color = Color.White.copy(alpha = 0.6f),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                )

                Spacer(Modifier.height(8.dp))

                ArchiveExportFormat.entries.forEach { fmt ->
                    val isSelected = selectedFormat == fmt
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .background(
                                if (isSelected) EditorialColor.aiAmber.copy(alpha = 0.12f)
                                else Color(0xFF1B1B22),
                            )
                            .border(
                                width = if (isSelected) 1.5.dp else 1.dp,
                                color = if (isSelected) EditorialColor.aiAmber else Color.White.copy(alpha = 0.08f),
                                shape = RoundedCornerShape(14.dp),
                            )
                            .clickable { selectedFormat = fmt }
                            .padding(14.dp),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Text(
                                        text = fmt.title,
                                        color = if (isSelected) Color.White else Color.White.copy(alpha = 0.9f),
                                        fontSize = 15.sp,
                                        fontWeight = FontWeight.SemiBold,
                                    )
                                    // 格式徽章
                                    Box(
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(4.dp))
                                            .background(Color.White.copy(alpha = 0.12f))
                                            .padding(horizontal = 6.dp, vertical = 2.dp),
                                    ) {
                                        Text(
                                            text = fmt.fileExtension.uppercase(),
                                            color = Color.White.copy(alpha = 0.75f),
                                            fontSize = 10.sp,
                                            fontWeight = FontWeight.Bold,
                                        )
                                    }

                                    if (fmt.isRecommended) {
                                        Box(
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(4.dp))
                                                .background(EditorialColor.aiAmber.copy(alpha = 0.3f))
                                                .padding(horizontal = 6.dp, vertical = 2.dp),
                                        ) {
                                            Text(
                                                text = "推荐",
                                                color = EditorialColor.aiAmber,
                                                fontSize = 10.sp,
                                                fontWeight = FontWeight.Bold,
                                            )
                                        }
                                    }
                                }

                                Spacer(Modifier.height(4.dp))

                                Text(
                                    text = fmt.description,
                                    color = Color.White.copy(alpha = 0.5f),
                                    fontSize = 12.sp,
                                    lineHeight = 16.sp,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }

                            Spacer(Modifier.width(12.dp))

                            // 单选圆圈
                            Box(
                                modifier = Modifier
                                    .size(20.dp)
                                    .clip(CircleShape)
                                    .border(
                                        width = if (isSelected) 6.dp else 1.5.dp,
                                        color = if (isSelected) EditorialColor.aiAmber else Color.White.copy(alpha = 0.3f),
                                        shape = CircleShape,
                                    )
                                    .background(if (isSelected) Color.White else Color.Transparent),
                            )
                        }
                    }
                }

                Spacer(Modifier.height(16.dp))
            }

            // 3. 底部操作栏
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                // 保存到下载目录
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(48.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color(0xFF282832))
                        .clickable(enabled = !isExporting) { handleSaveToDownloads() },
                    contentAlignment = Alignment.Center,
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        if (isExporting) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                color = Color.White,
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Icon(
                                imageVector = AppIcons.Download,
                                contentDescription = null,
                                tint = Color.White,
                                modifier = Modifier.size(18.dp),
                            )
                        }
                        Text(
                            text = "保存至下载目录",
                            color = Color.White,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Medium,
                        )
                    }
                }

                // 系统原生分享
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(48.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(EditorialColor.aiAmber)
                        .clickable(enabled = !isExporting) { handleShareViaChooser() },
                    contentAlignment = Alignment.Center,
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Default.Share,
                            contentDescription = null,
                            tint = Color(0xFF1B1B1F),
                            modifier = Modifier.size(18.dp),
                        )
                        Text(
                            text = "系统分享",
                            color = Color(0xFF1B1B1F),
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }

        // 浮动 Toast 提示
        AnimatedVisibility(
            visible = toastMessage != null,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 76.dp),
        ) {
            Surface(
                color = Color(0xEE2A2A33),
                shape = RoundedCornerShape(24.dp),
                shadowElevation = 8.dp,
                modifier = Modifier
                    .padding(horizontal = 24.dp)
                    .shadow(12.dp, RoundedCornerShape(24.dp)),
            ) {
                Text(
                    text = toastMessage.orEmpty(),
                    color = Color.White,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
                )
            }
        }
    }
}
