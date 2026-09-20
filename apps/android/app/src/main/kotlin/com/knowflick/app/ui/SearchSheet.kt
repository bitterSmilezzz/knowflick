package com.knowflick.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.knowflick.app.data.CategoryStampColor
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.search.SearchMatchedField
import com.knowflick.app.domain.search.SearchResultItem
import com.knowflick.app.domain.search.SearchSourceFilter

/**
 * 全局全文检索与智能标签多维筛选面板 (Search & Multi-Filter Sheet)
 */
@Composable
fun SearchSheet(
    query: String,
    onQueryChange: (String) -> Unit,
    selectedCategory: String?,
    onCategoryChange: (String?) -> Unit,
    selectedSource: SearchSourceFilter,
    onSourceChange: (SearchSourceFilter) -> Unit,
    allCards: List<KnowledgeCard>,
    searchResults: List<SearchResultItem>,
    searchHistory: List<String> = emptyList(),
    onAddSearchHistory: (String) -> Unit = {},
    onRemoveSearchHistory: (String) -> Unit = {},
    onClearSearchHistory: () -> Unit = {},
    onOpenDetail: (KnowledgeCard) -> Unit,
    onOpenChat: (KnowledgeCard) -> Unit = {},
    onPromoteToDeck: (KnowledgeCard) -> Unit,
    onToggleFavorite: (KnowledgeCard) -> Unit,
    onResetFilters: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    BackHandler { onClose() }

    val focusRequester = remember { FocusRequester() }
    val categories = remember(allCards) {
        listOf("全部") + allCards.map { it.category.trim() }.filter { it.isNotBlank() }.distinct().sorted()
    }
    val categoryCounts = remember(allCards) {
        val counts = mutableMapOf<String, Int>()
        counts["全部"] = allCards.size
        allCards.forEach { card ->
            val cat = card.category.trim()
            if (cat.isNotBlank()) {
                counts[cat] = (counts[cat] ?: 0) + 1
            }
        }
        counts
    }

    val hasActiveFilter = query.isNotBlank() ||
        (!selectedCategory.isNullOrBlank() && selectedCategory != "全部") ||
        selectedSource != SearchSourceFilter.ALL

    Surface(
        modifier = modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(Modifier.fillMaxSize()) {
            // 1. 顶栏导航与重置操作
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onClose) {
                    Icon(
                        Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "返回",
                        tint = MaterialTheme.colorScheme.onBackground,
                    )
                }
                Text(
                    "知识库全局检索",
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Serif,
                )
                Spacer(Modifier.weight(1f))
                if (hasActiveFilter) {
                    TextButton(onClick = onResetFilters) {
                        Text("清空重置", color = EditorialColor.aiAmber, fontSize = 13.sp)
                    }
                }
            }

            // 2. 沉浸式搜索输入框
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(MaterialTheme.colorScheme.surface)
                    .border(
                        1.dp,
                        MaterialTheme.colorScheme.onBackground.copy(alpha = 0.12f),
                        RoundedCornerShape(14.dp),
                    )
                    .padding(horizontal = 14.dp, vertical = 11.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(
                        AppIcons.Search,
                        contentDescription = null,
                        tint = EditorialColor.aiAmber,
                        modifier = Modifier.size(20.dp),
                    )
                    Spacer(Modifier.width(10.dp))
                    Box(Modifier.weight(1f)) {
                        if (query.isEmpty()) {
                            Text(
                                "输入标题、正文、观点或声母 (如 zzx)...",
                                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.38f),
                                fontSize = 14.5.sp,
                            )
                        }
                        BasicTextField(
                            value = query,
                            onValueChange = onQueryChange,
                            modifier = Modifier
                                .fillMaxWidth()
                                .focusRequester(focusRequester),
                            singleLine = true,
                            textStyle = TextStyle(
                                color = MaterialTheme.colorScheme.onBackground,
                                fontSize = 14.5.sp,
                                fontWeight = FontWeight.Normal,
                            ),
                            cursorBrush = SolidColor(EditorialColor.aiAmber),
                        )
                    }
                    if (query.isNotEmpty()) {
                        IconButton(
                            onClick = { onQueryChange("") },
                            modifier = Modifier.size(24.dp),
                        ) {
                            Icon(
                                Icons.Filled.Close,
                                contentDescription = "清除搜索词",
                                tint = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.55f),
                                modifier = Modifier.size(17.dp),
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(8.dp))

            // 3. 多维来源与状态过滤 Chip 行
            Row(
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                SearchSourceFilter.entries.forEach { source ->
                    val isSelected = selectedSource == source
                    val label = when (source) {
                        SearchSourceFilter.ALL -> "全部来源"
                        SearchSourceFilter.SEED -> "预置精选"
                        SearchSourceFilter.AI -> "AI 生成"
                        SearchSourceFilter.FAVORITES -> "仅收藏 ♥"
                        SearchSourceFilter.SEEN -> "学习足迹"
                        SearchSourceFilter.UNSEEN -> "待探索"
                    }
                    FilterPill(
                        label = label,
                        selected = isSelected,
                        onClick = { onSourceChange(source) },
                    )
                }
            }

            Spacer(Modifier.height(6.dp))

            // 4. 学科分类横向滑动过滤栏
            Row(
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                categories.forEach { cat ->
                    val isSelected = (selectedCategory == cat) || (selectedCategory.isNullOrBlank() && cat == "全部")
                    val catColor = if (cat == "全部") EditorialColor.aiAmber else CategoryStampColor.forCategory(cat)
                    val count = categoryCounts[cat] ?: 0
                    CategoryFilterPill(
                        category = cat,
                        count = count,
                        color = catColor,
                        selected = isSelected,
                        onClick = {
                            if (isSelected) {
                                onCategoryChange(null)
                            } else {
                                onCategoryChange(if (cat == "全部") null else cat)
                            }
                        },
                    )
                }
            }

            Spacer(Modifier.height(8.dp))

            // 5. 结果区域：引导页 / 搜索结果列表 / 无匹配提示
            if (query.isBlank() && selectedSource == SearchSourceFilter.ALL && (selectedCategory.isNullOrBlank() || selectedCategory == "全部")) {
                SearchGuideView(
                    searchHistory = searchHistory,
                    onSelectKeyword = onQueryChange,
                    onRemoveHistory = onRemoveSearchHistory,
                    onClearHistory = onClearSearchHistory,
                    onSelectSource = onSourceChange,
                )
            } else {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 18.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "找到 ${searchResults.size} 张卡片",
                        color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.50f),
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.Medium,
                    )
                    Spacer(Modifier.weight(1f))
                    if (searchResults.isNotEmpty()) {
                        Text(
                            "按匹配加权度排序",
                            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.35f),
                            fontSize = 11.5.sp,
                        )
                    }
                }

                if (searchResults.isEmpty()) {
                    SearchEmptyView(
                        query = query,
                        onReset = onResetFilters,
                    )
                } else {
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(searchResults, key = { it.card.id }) { item ->
                            SearchResultCard(
                                item = item,
                                query = query,
                                onOpenDetail = {
                                    if (query.isNotBlank()) onAddSearchHistory(query)
                                    onOpenDetail(item.card)
                                },
                                onOpenChat = {
                                    if (query.isNotBlank()) onAddSearchHistory(query)
                                    onOpenChat(item.card)
                                },
                                onPromoteToDeck = {
                                    if (query.isNotBlank()) onAddSearchHistory(query)
                                    onPromoteToDeck(item.card)
                                },
                                onToggleFavorite = { onToggleFavorite(item.card) },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FilterPill(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(
                if (selected) EditorialColor.aiAmber.copy(alpha = 0.20f)
                else MaterialTheme.colorScheme.surface,
            )
            .border(
                0.8.dp,
                if (selected) EditorialColor.aiAmber.copy(alpha = 0.50f)
                else MaterialTheme.colorScheme.onBackground.copy(alpha = 0.08f),
                RoundedCornerShape(8.dp),
            )
            .clickable { onClick() }
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Text(
            label,
            color = if (selected) EditorialColor.aiAmber else MaterialTheme.colorScheme.onBackground.copy(alpha = 0.70f),
            fontSize = 12.sp,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
        )
    }
}

@Composable
private fun CategoryFilterPill(
    category: String,
    count: Int,
    color: Color,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(
                if (selected) color.copy(alpha = 0.22f)
                else MaterialTheme.colorScheme.surface,
            )
            .border(
                0.8.dp,
                if (selected) color.copy(alpha = 0.60f)
                else MaterialTheme.colorScheme.onBackground.copy(alpha = 0.08f),
                RoundedCornerShape(8.dp),
            )
            .clickable { onClick() }
            .padding(horizontal = 11.dp, vertical = 5.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                category,
                color = if (selected) color else MaterialTheme.colorScheme.onBackground.copy(alpha = 0.65f),
                fontSize = 11.5.sp,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
            )
            Spacer(Modifier.width(4.dp))
            Text(
                "($count)",
                color = if (selected) color.copy(alpha = 0.85f) else MaterialTheme.colorScheme.onBackground.copy(alpha = 0.35f),
                fontSize = 10.sp,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}

@Composable
private fun SearchResultCard(
    item: SearchResultItem,
    query: String,
    onOpenDetail: () -> Unit,
    onOpenChat: () -> Unit,
    onPromoteToDeck: () -> Unit,
    onToggleFavorite: () -> Unit,
) {
    val card = item.card
    val categoryColor = CategoryStampColor.forCategory(card.category)

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(
                1.dp,
                MaterialTheme.colorScheme.onBackground.copy(alpha = 0.07f),
                RoundedCornerShape(14.dp),
            )
            .clickable { onOpenDetail() }
            .padding(14.dp),
    ) {
        // 顶部信息：分类徽标 + 命中字段指示器 + 收藏按钮
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .background(categoryColor.copy(alpha = 0.16f), RoundedCornerShape(6.dp))
                    .border(0.6.dp, categoryColor.copy(alpha = 0.35f), RoundedCornerShape(6.dp))
                    .padding(horizontal = 7.dp, vertical = 2.dp),
            ) {
                Text(
                    card.category.ifBlank { "未分类" },
                    color = categoryColor,
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            Spacer(Modifier.width(8.dp))
            // 命中维度提示
            val matchTag = when (item.matchedField) {
                SearchMatchedField.HEADLINE -> "标题命中"
                SearchMatchedField.CATEGORY -> "分类命中"
                SearchMatchedField.SUMMARY -> "观点命中"
                SearchMatchedField.DETAILS -> "正文命中"
                SearchMatchedField.LINK -> "文献来源"
                SearchMatchedField.BROWSE -> "卡片"
            }
            Box(
                Modifier
                    .background(EditorialColor.aiAmber.copy(alpha = 0.10f), RoundedCornerShape(4.dp))
                    .padding(horizontal = 6.dp, vertical = 2.dp),
            ) {
                Text(
                    matchTag,
                    color = EditorialColor.aiAmber,
                    fontSize = 9.5.sp,
                    fontWeight = FontWeight.Medium,
                )
            }
            Spacer(Modifier.weight(1f))
            // 收藏状态按键
            IconButton(
                onClick = onToggleFavorite,
                modifier = Modifier.size(28.dp),
            ) {
                Icon(
                    if (card.isFavorite) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                    contentDescription = if (card.isFavorite) "已收藏" else "未收藏",
                    tint = if (card.isFavorite) Color(0xFFE5576C) else MaterialTheme.colorScheme.onBackground.copy(alpha = 0.35f),
                    modifier = Modifier.size(18.dp),
                )
            }
        }

        Spacer(Modifier.height(8.dp))

        // 标题 (智能关键词高亮)
        HighlightedText(
            text = card.headline,
            query = query,
            baseStyle = TextStyle(
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                lineHeight = 22.sp,
            ),
        )

        // 摘要摘录（针对正文或观点匹配做高光展示）
        if (item.matchedField == SearchMatchedField.DETAILS || item.matchedField == SearchMatchedField.SUMMARY) {
            Spacer(Modifier.height(6.dp))
            HighlightedText(
                text = "“${item.matchedExcerpt}”",
                query = query,
                baseStyle = TextStyle(
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.60f),
                    fontSize = 12.5.sp,
                    lineHeight = 18.sp,
                ),
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
        }

        Spacer(Modifier.height(10.dp))

        // 底部快捷操作栏：相关度 + 追问 + 置顶刷卡
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "相关度 ${item.score}",
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.35f),
                fontSize = 10.5.sp,
            )
            Spacer(Modifier.weight(1f))

            // 快捷追问入口
            Box(
                Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(EditorialColor.aiAmber.copy(alpha = 0.08f))
                    .border(0.6.dp, EditorialColor.aiAmber.copy(alpha = 0.25f), RoundedCornerShape(8.dp))
                    .clickable { onOpenChat() }
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                contentAlignment = Alignment.Center,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        AppIcons.Sparkles,
                        contentDescription = null,
                        tint = EditorialColor.aiAmber,
                        modifier = Modifier.size(12.dp),
                    )
                    Spacer(Modifier.width(3.dp))
                    Text(
                        "追问",
                        color = EditorialColor.aiAmber,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }

            Spacer(Modifier.width(8.dp))

            // 置顶刷卡
            Box(
                Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(EditorialColor.aiAmber.copy(alpha = 0.14f))
                    .border(0.6.dp, EditorialColor.aiAmber.copy(alpha = 0.35f), RoundedCornerShape(8.dp))
                    .clickable { onPromoteToDeck() }
                    .padding(horizontal = 9.dp, vertical = 4.dp),
                contentAlignment = Alignment.Center,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "置顶刷卡",
                        color = EditorialColor.aiAmber,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.width(3.dp))
                    Icon(
                        Icons.AutoMirrored.Filled.ArrowForward,
                        contentDescription = null,
                        tint = EditorialColor.aiAmber,
                        modifier = Modifier.size(12.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun SearchGuideView(
    searchHistory: List<String>,
    onSelectKeyword: (String) -> Unit,
    onRemoveHistory: (String) -> Unit,
    onClearHistory: () -> Unit,
    onSelectSource: (SearchSourceFilter) -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp, vertical = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(10.dp))
        Box(
            Modifier
                .size(54.dp)
                .clip(CircleShape)
                .background(EditorialColor.aiAmber.copy(alpha = 0.12f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                AppIcons.Search,
                contentDescription = null,
                tint = EditorialColor.aiAmber,
                modifier = Modifier.size(26.dp),
            )
        }
        Spacer(Modifier.height(14.dp))
        Text(
            "探索与全文检索",
            color = MaterialTheme.colorScheme.onBackground,
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            fontFamily = FontFamily.Serif,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            "支持输入中文关键词、全拼或声母（如 zzx 找中子星）",
            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.45f),
            fontSize = 12.5.sp,
        )

        Spacer(Modifier.height(24.dp))

        // 最近搜索历史
        if (searchHistory.isNotEmpty()) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "最近搜索",
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.60f),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.weight(1f))
                Text(
                    "清空",
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.45f),
                    fontSize = 11.5.sp,
                    modifier = Modifier.clickable { onClearHistory() },
                )
            }
            Spacer(Modifier.height(8.dp))
            Row(
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                searchHistory.forEach { item ->
                    SearchHistoryChip(
                        keyword = item,
                        onClick = { onSelectKeyword(item) },
                        onDelete = { onRemoveHistory(item) },
                    )
                }
            }
            Spacer(Modifier.height(20.dp))
        }

        // 快捷探索建议热词
        Text(
            "热门探索推荐",
            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.60f),
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.align(Alignment.Start),
        )
        Spacer(Modifier.height(10.dp))

        val hotKeywords = listOf("中子星", "量子纠缠", "人工智能", "双向链表", "新租赁", "章鱼", "黑洞", "心理")
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            hotKeywords.take(4).forEach { kw ->
                QuickKeywordChip(kw) { onSelectKeyword(kw) }
            }
        }
        Spacer(Modifier.height(8.dp))
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            hotKeywords.drop(4).forEach { kw ->
                QuickKeywordChip(kw) { onSelectKeyword(kw) }
            }
        }

        Spacer(Modifier.height(24.dp))

        // 快捷状态卡片
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            QuickFilterCard(
                title = "我的收藏",
                subtitle = "沉淀的知识金句",
                modifier = Modifier.weight(1f),
                onClick = { onSelectSource(SearchSourceFilter.FAVORITES) },
            )
            QuickFilterCard(
                title = "已读足迹",
                subtitle = "浏览复习历史",
                modifier = Modifier.weight(1f),
                onClick = { onSelectSource(SearchSourceFilter.SEEN) },
            )
        }
    }
}

@Composable
private fun SearchHistoryChip(
    keyword: String,
    onClick: () -> Unit,
    onDelete: () -> Unit,
) {
    Box(
        Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(
                0.8.dp,
                MaterialTheme.colorScheme.onBackground.copy(alpha = 0.10f),
                RoundedCornerShape(8.dp),
            )
            .clickable { onClick() }
            .padding(start = 10.dp, end = 6.dp, top = 5.dp, bottom = 5.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                keyword,
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.80f),
                fontSize = 12.sp,
            )
            Spacer(Modifier.width(6.dp))
            Box(
                modifier = Modifier
                    .size(16.dp)
                    .clip(CircleShape)
                    .clickable { onDelete() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.Close,
                    contentDescription = "删除历史",
                    tint = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.45f),
                    modifier = Modifier.size(11.dp),
                )
            }
        }
    }
}

/**
 * 关键词智能高亮文本组件
 * 支持空格分隔的多 token 词、不区分大小写
 */
@Composable
private fun HighlightedText(
    text: String,
    query: String,
    baseStyle: TextStyle,
    highlightColor: Color = EditorialColor.aiAmber.copy(alpha = 0.22f),
    highlightTextColor: Color = EditorialColor.aiAmber,
    maxLines: Int = Int.MAX_VALUE,
    overflow: TextOverflow = TextOverflow.Clip,
    modifier: Modifier = Modifier,
) {
    val annotatedString = remember(text, query) {
        val tokens = query.trim().split("\\s+".toRegex()).filter { it.isNotBlank() }
        if (tokens.isEmpty()) {
            AnnotatedString(text)
        } else {
            val builder = AnnotatedString.Builder(text)
            val lowerText = text.lowercase()
            for (token in tokens) {
                val lowerToken = token.lowercase()
                var startIndex = 0
                while (startIndex < lowerText.length) {
                    val index = lowerText.indexOf(lowerToken, startIndex)
                    if (index == -1) break
                    builder.addStyle(
                        style = SpanStyle(
                            background = highlightColor,
                            color = highlightTextColor,
                            fontWeight = FontWeight.Bold,
                        ),
                        start = index,
                        end = index + lowerToken.length,
                    )
                    startIndex = index + lowerToken.length
                }
            }
            builder.toAnnotatedString()
        }
    }

    Text(
        text = annotatedString,
        style = baseStyle,
        maxLines = maxLines,
        overflow = overflow,
        modifier = modifier,
    )
}

@Composable
private fun QuickKeywordChip(keyword: String, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(
                0.8.dp,
                MaterialTheme.colorScheme.onBackground.copy(alpha = 0.08f),
                RoundedCornerShape(8.dp),
            )
            .clickable { onClick() }
            .padding(horizontal = 11.dp, vertical = 6.dp),
    ) {
        Text(
            keyword,
            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.75f),
            fontSize = 12.sp,
        )
    }
}

@Composable
private fun QuickFilterCard(
    title: String,
    subtitle: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(
                0.8.dp,
                MaterialTheme.colorScheme.onBackground.copy(alpha = 0.08f),
                RoundedCornerShape(12.dp),
            )
            .clickable { onClick() }
            .padding(14.dp),
    ) {
        Text(
            title,
            color = EditorialColor.aiAmber,
            fontSize = 13.5.sp,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            subtitle,
            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.45f),
            fontSize = 11.sp,
        )
    }
}

@Composable
private fun SearchEmptyView(
    query: String,
    onReset: () -> Unit,
) {
    Box(
        Modifier
            .fillMaxSize()
            .padding(32.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                Modifier
                    .size(54.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.onBackground.copy(alpha = 0.05f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    AppIcons.Search,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.25f),
                    modifier = Modifier.size(26.dp),
                )
            }
            Spacer(Modifier.height(14.dp))
            Text(
                if (query.isNotBlank()) "未找到与「$query」匹配的知识卡片" else "当前筛选条件下无卡片",
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.60f),
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                "请尝试简拼（如 zzx）、更换学科分类或清除筛选条件",
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.40f),
                fontSize = 12.sp,
            )
            Spacer(Modifier.height(18.dp))
            Box(
                Modifier
                    .clip(RoundedCornerShape(9.dp))
                    .background(EditorialColor.aiAmber.copy(alpha = 0.16f))
                    .border(0.8.dp, EditorialColor.aiAmber.copy(alpha = 0.40f), RoundedCornerShape(9.dp))
                    .clickable { onReset() }
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            ) {
                Text(
                    "重置所有筛选条件",
                    color = EditorialColor.aiAmber,
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}
