package com.knowflick.app.domain.search

import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.SwipeDirection

/** 搜索来源与状态维度过滤 */
enum class SearchSourceFilter(val title: String) {
    ALL("全部来源"),
    SEED("预置精选"),
    AI("AI 生成"),
    FAVORITES("仅已收藏"),
    SEEN("学习足迹"),
    UNSEEN("待探索未读");
}

/** 匹配命中的字段类型 */
enum class SearchMatchedField(val title: String) {
    HEADLINE("标题"),
    CATEGORY("分类"),
    SUMMARY("观点"),
    DETAILS("正文"),
    LINK("来源"),
    BROWSE("卡片");
}

/** 搜索结果项 */
data class SearchResultItem(
    val card: KnowledgeCard,
    val score: Int,
    val matchedField: SearchMatchedField,
    val matchedExcerpt: String,
    val isFavorite: Boolean,
) {
    val id: String get() = card.id
}

/**
 * 全文检索引擎：
 * 支持多字段加权打分、中英全文检索、拼音全拼与首字母模糊匹配、正文上下文智能摘要截取与多维复合过滤。
 * 架构与 macOS 端 KnowledgeSearchEngine 100% 同构对齐。
 */
class KnowledgeSearchEngine {

    /**
     * 执行多维智能搜索
     */
    fun search(
        query: String,
        category: String? = null,
        source: SearchSourceFilter = SearchSourceFilter.ALL,
        intent: SwipeDirection? = null,
        cards: List<KnowledgeCard>,
        favorites: Set<String> = emptySet(),
    ): List<SearchResultItem> {
        val trimmed = query.trim().lowercase()
        val pinyinQuery = trimmed.replace(" ", "")

        // 1. 维度过滤（分类、来源、意图）
        val filtered = cards.filter { card ->
            if (!category.isNullOrBlank() && category != "全部" && card.category != category) {
                return@filter false
            }
            if (intent != null && card.swiped != intent) {
                return@filter false
            }
            when (source) {
                SearchSourceFilter.ALL -> true
                SearchSourceFilter.SEED -> card.source == CardSource.SEED
                SearchSourceFilter.AI -> card.source == CardSource.AI
                SearchSourceFilter.FAVORITES -> card.isFavorite || card.id in favorites
                SearchSourceFilter.SEEN -> card.seenAt != null
                SearchSourceFilter.UNSEEN -> card.seenAt == null
            }
        }

        // 2. 空查询返回空结果，供视图层渲染搜索建议与分类热词
        if (trimmed.isEmpty()) {
            return emptyList()
        }

        // 3. 全文检索与加权打分
        val results = ArrayList<SearchResultItem>()

        for (card in filtered) {
            val headlineLower = card.headline.lowercase()
            val summaryLower = card.summary.lowercase()
            val categoryLower = card.category.lowercase()
            val linksText = card.links.joinToString(" ") { "${it.title} ${it.url}" }.lowercase()

            var totalScore = 0
            var matchedField: SearchMatchedField? = null
            var excerpt = card.headline

            // 1. 标题匹配（最高优先级）
            if (headlineLower == trimmed) {
                totalScore += 120
                matchedField = SearchMatchedField.HEADLINE
                excerpt = card.headline
            } else if (headlineLower.contains(trimmed)) {
                totalScore += 80
                matchedField = SearchMatchedField.HEADLINE
                excerpt = card.headline
            } else {
                val phonetics = PinyinHelper.phonetics(card.headline)
                if (pinyinQuery.isNotEmpty() && (phonetics.full.contains(pinyinQuery) || phonetics.initials.contains(pinyinQuery))) {
                    totalScore += 65
                    matchedField = SearchMatchedField.HEADLINE
                    excerpt = card.headline
                }
            }

            // 2. 分类匹配
            if (categoryLower == trimmed) {
                totalScore += 70
                if (matchedField == null) {
                    matchedField = SearchMatchedField.CATEGORY
                    excerpt = "学科分类：${card.category}"
                }
            } else if (categoryLower.contains(trimmed)) {
                totalScore += 50
                if (matchedField == null) {
                    matchedField = SearchMatchedField.CATEGORY
                    excerpt = "学科分类：${card.category}"
                }
            } else {
                val phonetics = PinyinHelper.phonetics(card.category)
                if (pinyinQuery.isNotEmpty() && (phonetics.full.contains(pinyinQuery) || phonetics.initials.contains(pinyinQuery))) {
                    totalScore += 40
                    if (matchedField == null) {
                        matchedField = SearchMatchedField.CATEGORY
                        excerpt = "学科分类：${card.category}"
                    }
                }
            }

            // 3. 观点摘要匹配
            if (summaryLower.contains(trimmed)) {
                totalScore += 35
                if (matchedField == null) {
                    matchedField = SearchMatchedField.SUMMARY
                    excerpt = card.summary
                }
            } else {
                val phonetics = PinyinHelper.phonetics(card.summary)
                if (pinyinQuery.isNotEmpty() && phonetics.full.contains(pinyinQuery)) {
                    totalScore += 25
                    if (matchedField == null) {
                        matchedField = SearchMatchedField.SUMMARY
                        excerpt = card.summary
                    }
                }
            }

            // 4. 深度剖析正文匹配（在原字符串上匹配避免字符集变换索引错位）
            val detailsIndex = card.details.indexOf(trimmed, ignoreCase = true)
            if (detailsIndex >= 0) {
                totalScore += 20
                if (matchedField == null) {
                    matchedField = SearchMatchedField.DETAILS
                    excerpt = extractSnippet(card.details, trimmed)
                }
            } else {
                val phonetics = PinyinHelper.phonetics(card.details)
                if (pinyinQuery.isNotEmpty() && phonetics.full.contains(pinyinQuery)) {
                    totalScore += 12
                    if (matchedField == null) {
                        matchedField = SearchMatchedField.DETAILS
                        excerpt = card.details.take(60) + if (card.details.length > 60) "…" else ""
                    }
                }
            }

            // 5. 权威来源链接匹配
            if (linksText.contains(trimmed)) {
                totalScore += 10
                if (matchedField == null) {
                    matchedField = SearchMatchedField.LINK
                    val matchedLink = card.links.firstOrNull {
                        it.title.lowercase().contains(trimmed) || it.url.lowercase().contains(trimmed)
                    }
                    excerpt = if (matchedLink != null) "权威文献：${matchedLink.title}" else card.summary
                }
            }

            if (totalScore <= 0 || matchedField == null) continue

            // 收藏卡片权重加分
            val isFav = card.isFavorite || card.id in favorites
            if (isFav) {
                totalScore += 15
            }

            results.add(
                SearchResultItem(
                    card = card,
                    score = totalScore,
                    matchedField = matchedField,
                    matchedExcerpt = excerpt,
                    isFavorite = isFav,
                )
            )
        }

        // 按打分降序；相同分数按创建时间降序
        results.sortWith(compareByDescending<SearchResultItem> { it.score }.thenByDescending { it.card.createdAt })
        return results
    }

    /**
     * 智能摘要上下文截取：在正文中提取匹配词前后的自然上下文
     */
    fun extractSnippet(text: String, query: String, maxLen: Int = 68): String {
        val index = text.indexOf(query, ignoreCase = true)
        if (index < 0) {
            return text.take(maxLen) + if (text.length > maxLen) "…" else ""
        }
        val start = (index - 18).coerceAtLeast(0)
        val end = (index + query.length + 32).coerceAtMost(text.length)
        val prefix = if (start > 0) "…" else ""
        val suffix = if (end < text.length) "…" else ""
        return prefix + text.substring(start, end).replace('\n', ' ').trim() + suffix
    }
}
