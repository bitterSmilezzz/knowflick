package com.knowflick.app.domain.graph

import androidx.compose.runtime.Immutable
import com.knowflick.app.domain.KnowledgeCard
import java.util.Collections
import kotlin.math.cos
import kotlin.math.sin

/**
 * 知识卡片关联关系分类
 */
enum class RelationKind(val title: String, val icon: String) {
    DISCIPLINE_DEEPEN("同领域深化", "atom"),
    CROSS_DISCIPLINE("交叉学科碰撞", "sparkles"),
    CONCEPT_BRIDGE("核心概念共鸣", "link"),
    SERENDIPITY("灵感偶遇", "wand");
}

/**
 * 星图节点模型
 */
@Immutable
data class GraphNode(
    val id: String,
    val cardId: String,
    val category: String,
    val headline: String,
    val x: Float,
    val y: Float,
    val radius: Float = 12f,
    val masteryLevel: Int = 0,
    val connectionsCount: Int = 0,
)

/**
 * 星图引力连线
 */
@Immutable
data class GraphEdge(
    val id: String,
    val sourceId: String,
    val targetId: String,
    val weight: Float,
    val kind: RelationKind,
)

/**
 * 星图拓扑数据
 */
@Immutable
data class KnowledgeGraphData(
    val nodes: List<GraphNode>,
    val edges: List<GraphEdge>,
)

/**
 * 语义关联与星图拓扑计算引擎（对齐 macOS 核心模型算法）
 */
object KnowledgeGraphEngine {

    /** 跨学科亲和矩阵（双向关系加权） */
    private val disciplineAffinity: Map<String, Set<String>> = mapOf(
        "物理" to setOf("天文", "数学", "化学", "科技", "编程"),
        "天文" to setOf("物理", "数学", "科技", "地理"),
        "数学" to setOf("物理", "AI", "编程", "算法", "投资理财", "中级会计"),
        "化学" to setOf("物理", "生物", "材料"),
        "生物" to setOf("生态", "脑科学", "心理", "生命", "医学"),
        "脑科学" to setOf("生物", "心理", "AI", "认知科学", "学习方法"),
        "心理" to setOf("脑科学", "社会", "哲学", "学习方法"),
        "哲学" to setOf("历史", "心理", "语言", "社会", "物理"),
        "历史" to setOf("哲学", "地理", "社会", "语言"),
        "AI" to setOf("编程", "算法", "数学", "脑科学", "AI Agent", "AI 开发", "科技"),
        "AI Agent" to setOf("AI", "编程", "AI 开发", "科技"),
        "AI 开发" to setOf("AI", "编程", "AI Agent", "科技"),
        "编程" to setOf("AI", "算法", "数学", "科技", "Rust", "Python"),
        "Rust" to setOf("编程", "科技", "算法"),
        "Python" to setOf("编程", "AI", "算法"),
        "投资理财" to setOf("中级会计", "经济", "数学"),
        "中级会计" to setOf("投资理财", "经济", "数学"),
        "语言" to setOf("历史", "哲学", "社会", "心理"),
    )

    /** 停用词集合，降低高频虚词干扰 */
    private val stopWords: Set<String> = setOf(
        "这个", "那个", "不是", "就是", "可以", "以及", "通过", "因为", "所以",
        "为了", "虽然", "但是", "如果", "进行", "这些", "那些", "一种", "关于",
        "例如", "主要", "其实", "产生", "同时", "并且", "由于", "出现", "目前",
        "这是一种", "这是", "在", "的", "了", "和", "是", "与", "或", "等", "而", "及",
        "一个", "没有", "我们", "自己", "他们", "什么", "怎么", "如何", "成为"
    )

    private val keywordCache = Collections.synchronizedMap(LinkedHashMap<String, Set<String>>())

    /**
     * 提取卡片关键词集合（N-Gram + 英文 Token）
     */
    fun extractKeywords(card: KnowledgeCard): Set<String> {
        val cacheKey = "${card.id}_${card.category}_${card.headline.hashCode()}"
        keywordCache[cacheKey]?.let { return it }

        val text = "${card.headline} ${card.summary} ${card.details}".lowercase()
        val words = HashSet<String>()

        // 1. 英文与数字分词
        val tokens = text.split(Regex("[^a-zA-Z0-9]+"))
            .filter { it.length >= 2 && !stopWords.contains(it) }
        words.addAll(tokens)

        // 2. 中文 2-Gram 与 3-Gram
        val cleanChars = text.toCharArray()
        if (cleanChars.size >= 2) {
            for (i in 0 until cleanChars.size - 1) {
                val c1 = cleanChars[i]
                val c2 = cleanChars[i + 1]
                if (isChinese(c1) && isChinese(c2)) {
                    val s2 = "$c1$c2"
                    if (!stopWords.contains(s2)) words.add(s2)
                    if (i + 2 < cleanChars.size && isChinese(cleanChars[i + 2])) {
                        val s3 = "$s2${cleanChars[i + 2]}"
                        if (!stopWords.contains(s3)) words.add(s3)
                    }
                }
            }
        }

        if (keywordCache.size >= 2048) {
            keywordCache.clear()
        }
        keywordCache[cacheKey] = words
        return words
    }

    private fun isChinese(c: Char): Boolean = c in '\u4e00'..'\u9fa5'

    /**
     * 判定两张卡片的关联性质与得分
     */
    fun evaluateRelation(
        cardA: KnowledgeCard,
        cardB: KnowledgeCard,
        kwA: Set<String>,
        kwB: Set<String>,
    ): Pair<RelationKind, Float>? {
        if (cardA.id == cardB.id) return null

        val intersectionCount = kwA.count { kwB.contains(it) }
        val unionCount = kwA.size + kwB.size - intersectionCount
        val jaccard = if (unionCount == 0) 0f else intersectionCount.toFloat() / unionCount.toFloat()

        val isSameCategory = cardA.category == cardB.category && cardA.category.isNotEmpty()
        if (isSameCategory) {
            return RelationKind.DISCIPLINE_DEEPEN to (0.35f + jaccard * 1.5f).coerceAtMost(1f)
        }

        val affinitySet = disciplineAffinity[cardA.category] ?: emptySet()
        val hasAffinity = affinitySet.contains(cardB.category) ||
            (disciplineAffinity[cardB.category]?.contains(cardA.category) == true)
        if (hasAffinity) {
            return RelationKind.CROSS_DISCIPLINE to (0.25f + jaccard * 1.8f).coerceAtMost(1f)
        }

        if (jaccard >= 0.04f) {
            return RelationKind.CONCEPT_BRIDGE to (0.20f + jaccard * 2.0f).coerceAtMost(1f)
        }

        return null
    }

    /**
     * 构建卡片集的星空引力拓扑图
     */
    fun buildGraph(
        cards: List<KnowledgeCard>,
        width: Float = 1200f,
        height: Float = 1200f,
    ): KnowledgeGraphData {
        if (cards.isEmpty()) return KnowledgeGraphData(emptyList(), emptyList())

        val centerX = width / 2f
        val centerY = height / 2f

        // 1. 收集学科分类并分配星系圆心角
        val categories = cards.map { it.category }.distinct().sorted()
        val catAngleMap = HashMap<String, Double>()
        val catCount = categories.size.coerceAtLeast(1)
        categories.forEachIndexed { index, cat ->
            catAngleMap[cat] = (index.toDouble() / catCount.toDouble()) * 2.0 * Math.PI
        }

        // 2. 映射节点初始坐标
        val nodes = ArrayList<GraphNode>(cards.size)
        val cardKeywords = HashMap<String, Set<String>>(cards.size)

        for (card in cards) {
            val kw = extractKeywords(card)
            cardKeywords[card.id] = kw

            val catAngle = catAngleMap[card.category] ?: 0.0
            // 确定性伪随机偏移，保证同一张卡片在星图中的坐标稳定
            val seed = (card.id.hashCode() and 0x7FFFFFFF) % 10000 / 10000.0
            val angleJitter = (seed - 0.5) * 0.9
            val radiusDist = 160.0 + seed * 320.0

            val finalAngle = catAngle + angleJitter
            val x = (centerX + radiusDist * cos(finalAngle)).toFloat()
            val y = (centerY + radiusDist * sin(finalAngle)).toFloat()

            val nodeRadius = when {
                card.masteryLevel >= 2 -> 16f
                card.reviewCount > 0 -> 13f
                else -> 10f
            }

            nodes.add(
                GraphNode(
                    id = card.id,
                    cardId = card.id,
                    category = card.category,
                    headline = card.headline,
                    x = x,
                    y = y,
                    radius = nodeRadius,
                    masteryLevel = card.masteryLevel,
                    connectionsCount = 0,
                )
            )
        }

        val nodeMap = nodes.associateBy { it.cardId }

        // 3. 构建倒排索引以高效发现公共关键词并建立引力连线
        val invertedIndex = HashMap<String, MutableList<String>>()
        for ((cardId, kwSet) in cardKeywords) {
            for (kw in kwSet) {
                invertedIndex.getOrPut(kw) { ArrayList() }.add(cardId)
            }
        }

        // 统计卡片对重合权重
        val candidatePairs = HashSet<Pair<String, String>>()
        for ((_, cardList) in invertedIndex) {
            if (cardList.size in 2..20) {
                for (i in 0 until cardList.size - 1) {
                    for (j in i + 1 until cardList.size) {
                        val a = cardList[i]
                        val b = cardList[j]
                        val sortedPair = if (a < b) a to b else b to a
                        candidatePairs.add(sortedPair)
                    }
                }
            }
        }

        // 为同分类相邻卡片补充基础学科引力连线
        val byCategory = cards.groupBy { it.category }
        for ((_, catCards) in byCategory) {
            if (catCards.size >= 2) {
                for (i in 0 until minOf(catCards.size - 1, 15)) {
                    val a = catCards[i].id
                    val b = catCards[i + 1].id
                    val sortedPair = if (a < b) a to b else b to a
                    candidatePairs.add(sortedPair)
                }
            }
        }

        val cardMap = cards.associateBy { it.id }
        val edges = ArrayList<GraphEdge>()
        val connectionCount = HashMap<String, Int>()

        for ((idA, idB) in candidatePairs) {
            val cardA = cardMap[idA] ?: continue
            val cardB = cardMap[idB] ?: continue
            val kwA = cardKeywords[idA] ?: emptySet()
            val kwB = cardKeywords[idB] ?: emptySet()

            val relation = evaluateRelation(cardA, cardB, kwA, kwB) ?: continue
            val (kind, weight) = relation

            val edge = GraphEdge(
                id = "${idA}_${idB}",
                sourceId = idA,
                targetId = idB,
                weight = weight,
                kind = kind,
            )
            edges.add(edge)
            connectionCount[idA] = (connectionCount[idA] ?: 0) + 1
            connectionCount[idB] = (connectionCount[idB] ?: 0) + 1
        }

        val completedNodes = nodes.map { node ->
            node.copy(connectionsCount = connectionCount[node.cardId] ?: 0)
        }

        return KnowledgeGraphData(nodes = completedNodes, edges = edges)
    }
}
