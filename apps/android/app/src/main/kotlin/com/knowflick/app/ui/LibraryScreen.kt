package com.knowflick.app.ui

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
 * - 收藏阁：按收藏时间倒序；取消收藏；导出分享（Markdown/Anki/JSON）
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

    // 过滤与排序结果缓存：这两个列表每次重组都会重算，而 cards 只在 version 变化时改变。
    val favorites = remember(cards, version) {
        cards.filter { it.isFavorite }.sortedByDescending { it.favoritedAt ?: 0L }
    }
    val history = remember(cards, version) {
        cards.filter { it.seenAt != null }.sortedByDescending { it.seenAt ?: 0L }
    }.let { sorted -> if (historyFilter == null) sorted else sorted.filter { it.swiped == historyFilter } }
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

        // 双 Tab
        Row(
            Modifier.padding(horizontal = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            TabChip("收藏阁 ${favorites.size}", tab == LibraryTab.FAVORITES) { tab = LibraryTab.FAVORITES }
            TabChip("历史足迹 ${history.size}", tab == LibraryTab.HISTORY) { tab = LibraryTab.HISTORY }
        }
        Spacer(Modifier.height(6.dp))

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
private fun TabChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (selected) EditorialColor.aiAmber.copy(alpha = 0.22f) else MaterialTheme.colorScheme.surface)
            .clickable { selected.let { onClick() } }
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Text(label, color = if (selected) EditorialColor.aiAmber else MaterialTheme.colorScheme.onBackground.copy(alpha = 0.8f), fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun HistoryFilterChip(label: String, selected: Boolean, onSelect: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (selected) EditorialColor.aiAmber.copy(alpha = 0.18f) else MaterialTheme.colorScheme.surface)
            .clickable { onSelect() }
            .padding(horizontal = 10.dp, vertical = 6.dp),
    ) {
        Text(label, color = if (selected) EditorialColor.aiAmber else MaterialTheme.colorScheme.onBackground.copy(alpha = 0.7f), fontSize = 11.sp)
    }
}

@Composable
private fun LibraryRow(card: KnowledgeCard, label: String, onClick: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surface)
            .clickable { onClick() }
            .padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .background(CategoryStampColor.forCategory(card.category).copy(alpha = 0.15f), RoundedCornerShape(6.dp))
                    .padding(horizontal = 8.dp, vertical = 3.dp),
            ) {
                Text(card.category.ifBlank { "未分类" }, color = CategoryStampColor.forCategory(card.category), fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
            }
            Spacer(Modifier.weight(1f))
            Text(label, color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.45f), fontSize = 10.sp)
        }
        Spacer(Modifier.height(8.dp))
        Text(card.headline, color = MaterialTheme.colorScheme.onBackground, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, lineHeight = 22.sp)
    }
}

@Composable
private fun LibraryEmpty(message: String) {
    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Text(message, color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.4f), fontSize = 13.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

private fun directionLabel(direction: SwipeDirection?): String = when (direction) {
    SwipeDirection.RIGHT -> "♥ 感兴趣"
    SwipeDirection.LEFT -> "✕ 不喜欢"
    SwipeDirection.SKIP -> "↻ 跳过"
    null -> "浏览"
}
