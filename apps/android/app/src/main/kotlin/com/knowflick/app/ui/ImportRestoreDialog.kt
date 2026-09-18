package com.knowflick.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.BasicAlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.data.ArchivePreview
import com.knowflick.app.data.RestoreStrategy
import com.knowflick.app.domain.CardSource

/**
 * 归档导入预览与恢复策略选择弹窗 (Import & Restore Dialog)
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImportRestoreDialog(
    preview: ArchivePreview,
    onConfirm: (RestoreStrategy) -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var selectedStrategy by remember { mutableStateOf(RestoreStrategy.MERGE) }

    BasicAlertDialog(
        onDismissRequest = onDismiss,
        modifier = modifier,
    ) {
        Surface(
            shape = RoundedCornerShape(20.dp),
            color = Color(0xFF1B1B22),
            border = androidx.compose.foundation.BorderStroke(1.dp, Color.White.copy(alpha = 0.12f)),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
            ) {
                // 顶栏：图标与主标题
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .size(36.dp)
                            .clip(CircleShape)
                            .background(EditorialColor.aiAmber.copy(alpha = 0.18f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = AppIcons.Upload,
                            contentDescription = null,
                            tint = EditorialColor.aiAmber,
                            modifier = Modifier.size(20.dp),
                        )
                    }

                    Column {
                        Text(
                            text = "导入与数据恢复",
                            color = Color.White,
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Serif,
                        )
                        Text(
                            text = if (preview.isZipArchive) "ZIP 全量归档包" else "JSON 数据镜像",
                            color = Color.White.copy(alpha = 0.5f),
                            fontSize = 12.sp,
                        )
                    }
                }

                Spacer(Modifier.height(14.dp))

                // 文件名标签
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(Color(0xFF24242D))
                        .padding(horizontal = 10.dp, vertical = 6.dp),
                ) {
                    Text(
                        text = "归档文件: ${preview.filename}",
                        color = Color.White.copy(alpha = 0.8f),
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }

                Spacer(Modifier.height(14.dp))

                // 统计看板
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color(0xFF22222B))
                        .padding(12.dp),
                    horizontalArrangement = Arrangement.SpaceAround,
                ) {
                    StatItem(label = "卡片总数", value = "${preview.totalCards} 张", highlight = true)
                    StatItem(label = "学习足迹", value = "${preview.readCards} 张")
                    StatItem(label = "收藏沉淀", value = "${preview.favoritedCards} 张")
                }

                // 来源构成简报
                val seedCount = preview.sourcesSummary[CardSource.SEED] ?: 0
                val aiCount = preview.sourcesSummary[CardSource.AI] ?: 0
                if (seedCount > 0 || aiCount > 0) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = "来源构成：预置精选 $seedCount 张 · AI 生成 $aiCount 张",
                        color = Color.White.copy(alpha = 0.45f),
                        fontSize = 11.sp,
                        modifier = Modifier.padding(start = 2.dp),
                    )
                }

                Spacer(Modifier.height(16.dp))

                // 恢复模式选择
                Text(
                    text = "恢复策略",
                    color = Color.White.copy(alpha = 0.7f),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                )

                Spacer(Modifier.height(8.dp))

                RestoreStrategy.entries.forEach { strategy ->
                    val isSelected = selectedStrategy == strategy
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(
                                if (isSelected) EditorialColor.aiAmber.copy(alpha = 0.12f)
                                else Color(0xFF24242D),
                            )
                            .border(
                                width = if (isSelected) 1.5.dp else 1.dp,
                                color = if (isSelected) EditorialColor.aiAmber else Color.White.copy(alpha = 0.08f),
                                shape = RoundedCornerShape(12.dp),
                            )
                            .clickable { selectedStrategy = strategy }
                            .padding(12.dp),
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = strategy.title,
                                    color = if (isSelected) Color.White else Color.White.copy(alpha = 0.9f),
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Spacer(Modifier.height(2.dp))
                                Text(
                                    text = strategy.description,
                                    color = Color.White.copy(alpha = 0.5f),
                                    fontSize = 11.sp,
                                    lineHeight = 15.sp,
                                )
                            }

                            Spacer(Modifier.width(8.dp))

                            Box(
                                modifier = Modifier
                                    .size(18.dp)
                                    .clip(CircleShape)
                                    .border(
                                        width = if (isSelected) 5.dp else 1.5.dp,
                                        color = if (isSelected) EditorialColor.aiAmber else Color.White.copy(alpha = 0.3f),
                                        shape = CircleShape,
                                    )
                                    .background(if (isSelected) Color.White else Color.Transparent),
                            )
                        }
                    }
                }

                Spacer(Modifier.height(20.dp))

                // 对话框操作按钮
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .height(42.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(Color(0xFF282832))
                            .clickable(onClick = onDismiss),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = "取消",
                            color = Color.White.copy(alpha = 0.75f),
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Medium,
                        )
                    }

                    Box(
                        modifier = Modifier
                            .weight(1.2f)
                            .height(42.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(EditorialColor.aiAmber)
                            .clickable(onClick = { onConfirm(selectedStrategy) }),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = "确认恢复",
                            color = Color(0xFF1B1B1F),
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun StatItem(
    label: String,
    value: String,
    highlight: Boolean = false,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = value,
            color = if (highlight) EditorialColor.aiAmber else Color.White,
            fontSize = 15.sp,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(2.dp))
        Text(
            text = label,
            color = Color.White.copy(alpha = 0.45f),
            fontSize = 11.sp,
        )
    }
}
