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
 * 查询类型判别——根据查询内容决定匹配策略，大幅降低误检测率。
 */
enum class QueryType {
    /** 含中文字符的查询 → 直接中文文本匹配，不走拼音 */
    CHINESE,
    /** 纯英文单词（含数字），如 "AI", "DNA" → 直接英文匹配，仅对标题/分类启用拼音 */
    ENGLISH,
    /** 纯小写辅音字母串（≥2），如 "zzx", "hdl" → 首字母匹配模式 */
    INITIALS,
    /** 纯小写字母且含元音（≥2），如 "zhongzi", "ren" → 全拼匹配模式 */
    PINYIN_FULL;

    companion object {
        private val vowels = setOf('a', 'e', 'i', 'o', 'u', 'v')

        fun classify(query: String): QueryType {
            if (query.isEmpty()) return ENGLISH
            // 含中文字符 → 中文模式
            if (query.any { it in '\u4e00'..'\u9fff' }) return CHINESE
            // 含大写字母 → 英文缩写/词汇模式
            if (query.any { it in 'A'..'Z' }) return ENGLISH
            // 纯小写字母 → 根据是否含元音判别拼音全拼 vs 首字母
            val letters = query.filter { it in 'a'..'z' }
            if (letters.length < 2) return ENGLISH
            val hasVowel = letters.any { it in vowels }
            return if (hasVowel) PINYIN_FULL else INITIALS
        }
    }
}

/**
 * 全文检索引擎 v2：
 * 1. 查询智能分类（中文/英文/拼音全拼/首字母），针对性匹配策略；
 * 2. 短查询保护门限，避免 1-2 字符拼音查询泛匹配；
 * 3. 首字母匹配锚定前缀/等长约束，杜绝子串碰撞误检；
 * 4. 长文本（摘要/正文）不走拼音匹配，消除噪声；
 * 5. 正文上下文智能摘要截取与多维复合过滤。
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
        val queryType = QueryType.classify(query.trim())

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

            // ====== 1. 标题匹配（最高优先级）======
            val headlineTextScore = textMatch(headlineLower, trimmed)
            if (headlineTextScore > 0) {
                totalScore += headlineTextScore
                matchedField = SearchMatchedField.HEADLINE
                excerpt = card.headline
            } else if (queryType == QueryType.PINYIN_FULL || queryType == QueryType.INITIALS) {
                val pinyinScore = pinyinMatchShortText(card.headline, pinyinQuery, queryType)
                if (pinyinScore > 0) {
                    totalScore += pinyinScore
                    matchedField = SearchMatchedField.HEADLINE
                    excerpt = card.headline
                }
            }

            // ====== 2. 分类匹配 ======
            val catTextScore = textMatch(categoryLower, trimmed)
            if (catTextScore > 0) {
                val catScore = when {
                    categoryLower == trimmed -> 70
                    else -> 50
                }
                totalScore += catScore
                if (matchedField == null) {
                    matchedField = SearchMatchedField.CATEGORY
                    excerpt = "学科分类：${card.category}"
                }
            } else if (queryType == QueryType.PINYIN_FULL || queryType == QueryType.INITIALS) {
                val pinyinScore = pinyinMatchShortText(card.category, pinyinQuery, queryType)
                if (pinyinScore > 0) {
                    totalScore += (pinyinScore * 0.6).toInt().coerceAtLeast(1)
                    if (matchedField == null) {
                        matchedField = SearchMatchedField.CATEGORY
                        excerpt = "学科分类：${card.category}"
                    }
                }
            }

            // ====== 3. 观点摘要匹配（仅直接文本匹配，不走拼音以避免噪声）======
            if (summaryLower.contains(trimmed)) {
                totalScore += 35
                if (matchedField == null) {
                    matchedField = SearchMatchedField.SUMMARY
                    excerpt = card.summary
                }
            }

            // ====== 4. 深度剖析正文匹配（仅直接文本匹配，不走拼音以避免噪声）======
            val detailsIndex = card.details.indexOf(trimmed, ignoreCase = true)
            if (detailsIndex >= 0) {
                totalScore += 20
                if (matchedField == null) {
                    matchedField = SearchMatchedField.DETAILS
                    excerpt = extractSnippet(card.details, trimmed)
                }
            }

            // ====== 5. 权威来源链接匹配 ======
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
     * 纯文本匹配评分：精确匹配 120，包含匹配 80，否则 0
     */
    private fun textMatch(fieldLower: String, queryLower: String): Int = when {
        fieldLower == queryLower -> 120
        fieldLower.contains(queryLower) -> 80
        else -> 0
    }

    /**
     * 拼音匹配短文本（标题/分类等 ≤30 字的字段）：
     * - 全拼模式：查询 ≥3 字符才启用，要求全拼串前缀匹配或包含匹配
     * - 首字母模式：查询 ≥2 字符才启用，要求首字母串前缀匹配或等长精确匹配
     * 返回匹配得分（0 = 不匹配）
     */
    private fun pinyinMatchShortText(text: String, pinyinQuery: String, queryType: QueryType): Int {
        if (pinyinQuery.isEmpty()) return 0

        val phonetics = PinyinHelper.phonetics(text)

        return when (queryType) {
            QueryType.PINYIN_FULL -> {
                // 全拼至少 3 字符才有意义（如 "zho" 匹配 "zhong"）
                if (pinyinQuery.length < 3) return 0
                when {
                    // 全拼完全匹配（如 "zhongzixing" == 标题全拼）
                    phonetics.full == pinyinQuery -> 70
                    // 全拼前缀匹配（如 "zhongzi" 是 "zhongzixing..." 的前缀）
                    phonetics.full.startsWith(pinyinQuery) -> 60
                    // 全拼包含匹配，要求查询 ≥ 4 字符（至少是一个双字词的全拼如 "zulin"）
                    phonetics.full.contains(pinyinQuery)
                            && pinyinQuery.length >= 4 -> 45
                    else -> 0
                }
            }
            QueryType.INITIALS -> {
                // 首字母至少 2 字符（如 "zx" 匹配 "中子星"）
                if (pinyinQuery.length < 2) return 0
                when {
                    // 首字母精确匹配（如 "zzx" == 标题首字母）
                    phonetics.initials == pinyinQuery -> 65
                    // 首字母前缀匹配（如 "zz" 是 "zzx" 的前缀）
                    phonetics.initials.startsWith(pinyinQuery) -> 55
                    // 首字母包含匹配，但要求占比 ≥ 50% 避免短查询碰撞
                    phonetics.initials.contains(pinyinQuery)
                            && pinyinQuery.length.toFloat() / phonetics.initials.length >= 0.5f -> 40
                    else -> 0
                }
            }
            else -> 0
        }
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
