package com.knowflick.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.data.CategoryStampColor
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.SwipeDirection
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 收藏阁与历史足迹（双段合一屏）：
 * - 收藏阁：按收藏时间倒序；导出分享（Markdown/Anki/JSON）。**取消收藏**需进入详情页
 *   （行内只有打开详情的点击目标），此处不提供行内 ♥ 按钮
 * - 历史足迹：按浏览时间倒序；按意图筛选（全部/感兴趣/不喜欢）
 */
@Composable
fun LibraryScreen(
    cards: List<KnowledgeCard>,
    version: Int,
    onOpenDetail: (KnowledgeCard) -> Unit,
    onBack: () -> Unit,
    onShareFavorites: (List<KnowledgeCard>) -> Unit,
    onShareArchive: (List<KnowledgeCard>) -> Unit,
    onPickImportFile: () -> Unit,
) {
    androidx.activity.compose.BackHandler { onBack() }

    var tab by rememberSaveable { mutableStateOf(LibraryTab.FAVORITES) }
    var historyFilter by rememberSaveable { mutableStateOf<SwipeDirection?>(null) }

    // 过滤与排序结果缓存：这些列表每次重组都会重算，而 cards 只在 version 变化时改变。
    // historyFilter 必须作为 remember 的 key —— 放在 remember 之外会让每次重组都重跑 O(n) 过滤，
    // 与「结果缓存」的注释不符。
    val favorites = remember(cards, version) {
        cards.filter { it.isFavorite }.sortedByDescending { it.favoritedAt ?: 0L }
    }
    val history = remember(cards, version, historyFilter) {
        cards.filter { it.seenAt != null }
            .filter { historyFilter == null || it.swiped == historyFilter }
            .sortedByDescending { it.seenAt ?: 0L }
    }
    // 时间戳格式化器复用：原先每行每次重组都新建 SimpleDateFormat（开销约 2.75 倍）。
    val timeFormat = remember { SimpleDateFormat("MM/dd HH:mm", java.util.Locale.getDefault()) }

    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        // 顶栏
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回", tint = MaterialTheme.colorScheme.onBackground)
            }
            Text(
                "知识库",
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 17.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Serif,
            )
            Spacer(Modifier.weight(1f))
            // 收藏阁导出：分享当前收藏
            IconButton(onClick = { onShareFavorites(favorites.toList()) }) {
                Icon(Icons.Filled.Share, contentDescription = "分享收藏笔记", tint = MaterialTheme.colorScheme.onBackground)
            }
            // JSON 归档分享
            IconButton(onClick = { onShareArchive(cards.toList()) }) {
                Icon(Icons.Filled.AddCircle, contentDescription = "导出 JSON 归档", tint = MaterialTheme.colorScheme.onBackground)
            }
            // 导入
            IconButton(onClick = onPickImportFile) {
                Text("导入", color = EditorialColor.aiAmber, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            }
        }

        // 双 Tab：一体化分段胶囊设计
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 4.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(MaterialTheme.colorScheme.onBackground.copy(alpha = 0.06f))
                .padding(3.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            SegmentedTab(
                label = "收藏阁 ${favorites.size}",
                selected = tab == LibraryTab.FAVORITES,
                modifier = Modifier.weight(1f),
            ) { tab = LibraryTab.FAVORITES }
            SegmentedTab(
                label = "历史足迹 ${history.size}",
                selected = tab == LibraryTab.HISTORY,
                modifier = Modifier.weight(1f),
            ) { tab = LibraryTab.HISTORY }
        }
        Spacer(Modifier.height(8.dp))

        when (tab) {
            LibraryTab.FAVORITES -> {
                if (favorites.isEmpty()) {
                    LibraryEmpty("还没有收藏的卡片\n刷卡时点 ♥ 或右划即可沉淀")
                } else {
                    LazyColumn(Modifier.padding(horizontal = 20.dp)) {
                        items(favorites, key = { it.id }) { card ->
                            LibraryRow(card, label = "♥ 收藏于 " + timeFormat.format(java.util.Date(card.favoritedAt ?: 0))) {
                                onOpenDetail(card)
                            }
                        }
                    }
                }
            }
            LibraryTab.HISTORY -> {
                Row(
                    Modifier.padding(horizontal = 20.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    HistoryFilterChip("全部", historyFilter == null) { historyFilter = null }
                    HistoryFilterChip("感兴趣", historyFilter == SwipeDirection.RIGHT) { historyFilter = SwipeDirection.RIGHT }
                    HistoryFilterChip("不喜欢", historyFilter == SwipeDirection.LEFT) { historyFilter = SwipeDirection.LEFT }
                }
                Spacer(Modifier.height(6.dp))
                if (history.isEmpty()) {
                    LibraryEmpty("还没有刷过的卡片")
                } else {
                    LazyColumn(Modifier.padding(horizontal = 20.dp)) {
                        items(history, key = { it.id }) { card ->
                            LibraryRow(card, label = directionLabel(card.swiped) + " " + timeFormat.format(java.util.Date(card.seenAt ?: 0))) {
                                onOpenDetail(card)
                            }
                        }
                    }
                }
            }
        }
    }
}

private enum class LibraryTab { FAVORITES, HISTORY }

@Composable
private fun SegmentedTab(
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(9.dp))
            .background(if (selected) MaterialTheme.colorScheme.surface else Color.Transparent)
            .border(
                if (selected) 0.8.dp else 0.dp,
                if (selected) MaterialTheme.colorScheme.onBackground.copy(alpha = 0.08f) else Color.Transparent,
                RoundedCornerShape(9.dp),
            )
            .clickable { onClick() }
            .padding(vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = if (selected) EditorialColor.aiAmber else MaterialTheme.colorScheme.onBackground.copy(alpha = 0.70f),
            fontSize = 12.5.sp,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
        )
    }
}

@Composable
private fun HistoryFilterChip(label: String, selected: Boolean, onSelect: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (selected) EditorialColor.aiAmber.copy(alpha = 0.18f) else MaterialTheme.colorScheme.surface)
            .border(
                0.8.dp,
                if (selected) EditorialColor.aiAmber.copy(alpha = 0.40f) else MaterialTheme.colorScheme.onBackground.copy(alpha = 0.08f),
                RoundedCornerShape(8.dp),
            )
            .clickable { onSelect() }
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Text(
            label,
            color = if (selected) EditorialColor.aiAmber else MaterialTheme.colorScheme.onBackground.copy(alpha = 0.75f),
            fontSize = 11.5.sp,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
        )
    }
}

@Composable
private fun LibraryRow(card: KnowledgeCard, label: String, onClick: () -> Unit) {
    val categoryColor = CategoryStampColor.forCategory(card.category)
    Column(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(
                1.dp,
                MaterialTheme.colorScheme.onBackground.copy(alpha = 0.06f),
                RoundedCornerShape(14.dp),
            )
            .clickable { onClick() }
            .padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .background(categoryColor.copy(alpha = 0.15f), RoundedCornerShape(6.dp))
                    .border(0.6.dp, categoryColor.copy(alpha = 0.30f), RoundedCornerShape(6.dp))
                    .padding(horizontal = 8.dp, vertical = 3.dp),
            ) {
                Text(card.category.ifBlank { "未分类" }, color = categoryColor, fontSize = 10.5.sp, fontWeight = FontWeight.SemiBold)
            }
            Spacer(Modifier.weight(1f))
            Text(label, color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.45f), fontSize = 10.5.sp)
        }
        Spacer(Modifier.height(10.dp))
        Text(card.headline, color = MaterialTheme.colorScheme.onBackground, fontSize = 15.5.sp, fontWeight = FontWeight.SemiBold, lineHeight = 23.sp)
    }
}

@Composable
private fun LibraryEmpty(message: String) {
    Box(
        Modifier
            .fillMaxSize()
            .padding(32.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                Modifier
                    .size(56.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.onBackground.copy(alpha = 0.05f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    AppIcons.Bookmarks,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.25f),
                    modifier = Modifier.size(26.dp),
                )
            }
            Spacer(Modifier.height(14.dp))
            Text(
                message,
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.45f),
                fontSize = 13.sp,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                lineHeight = 20.sp,
            )
        }
    }
}

private fun directionLabel(direction: SwipeDirection?): String = when (direction) {
    SwipeDirection.RIGHT -> "♥ 感兴趣"
    SwipeDirection.LEFT -> "✕ 不喜欢"
    SwipeDirection.SKIP -> "↻ 跳过"
    null -> "浏览"
}
