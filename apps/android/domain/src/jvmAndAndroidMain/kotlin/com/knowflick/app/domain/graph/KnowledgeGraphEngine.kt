package com.knowflick.app.domain.graph

import androidx.compose.runtime.Immutable
import com.knowflick.app.domain.KnowledgeCard
import java.util.Arrays
import java.util.Collections
import kotlin.math.cos
import kotlin.math.sqrt
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

/** 节点包围盒（世界坐标） */
@Immutable
data class GraphBounds(
    val minX: Float,
    val minY: Float,
    val maxX: Float,
    val maxY: Float,
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
     * 图结果缓存（容量 6，访问序 LRU）：与 macOS 端 GraphCacheBox 同口径。
     * 星图按学科分片后缓存键是「某一片」，容量太小会在来回切换时把刚看过的片挤掉、重算 O(n²)。
     */
    private const val GRAPH_CACHE_CAPACITY = 6

    private val graphCache = LinkedHashMap<Long, KnowledgeGraphData>(4, 0.75f, true)

    /** 一次构图的诊断快照（测试与性能观测用，不含用户内容） */
    data class BuildDiagnostics(val didHitCache: Boolean, val cards: Int, val edges: Int)

    private var diagnostics: BuildDiagnostics? = null

    /** 最近一次构图的诊断（供测试断言缓存命中） */
    val lastBuildDiagnostics: BuildDiagnostics?
        get() = synchronized(this) { diagnostics }

    /** 清空构图结果缓存：测试与内容整体重建时使用 */
    fun invalidateGraphCache() = synchronized(this) { graphCache.clear() }

    /**
     * 构图内容签名：只取**影响拓扑**的字段（分类/标题/摘要/正文/复习次数/掌握度 + 画布尺寸）。
     * 划卡、收藏、换一批等与拓扑无关的变化不换签名，因此能命中缓存，不再重算 n² 关系。
     */
    fun graphSignature(cards: List<KnowledgeCard>, width: Float, height: Float): Long {
        var hash = width.toRawBits() * 31L + height.toRawBits()
        for (card in cards) {
            val part = "${card.id}|${card.category}|${card.headline}|${card.summary}|${card.details}" +
                "|${card.reviewCount}|${card.masteryLevel}"
            hash = hash * 1_099_511_628_211L + part.hashCode().toLong()
        }
        return hash
    }

    /**
     * 提取卡片关键词集合（N-Gram + 英文 Token）
     */
    fun extractKeywords(card: KnowledgeCard): Set<String> {
        // 缓存 key 必须覆盖全部被朗读/建图使用的字段：只带标题哈希时，
        // 编辑正文或摘要后会复用旧词集，星图引力线与详情页相关卡都会停在旧内容上。
        val cacheKey = "${card.id}|${card.category}|${card.headline.hashCode()}:" +
            "${card.summary.hashCode()}:${card.details.hashCode()}"
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

    /** 由字符串确定性派生 [0,1) 分布的实数（同一张卡坐标永远一致） */
    private fun hashUnit(seed: String, salt: String): Double {
        val mixed = (seed.hashCode().toLong() * 31L + salt.hashCode().toLong()) * 0x9E3779B97F4A7C15U.toLong()
        val positive = mixed and 0x7FFFFFFFFFFFFFFFL
        return (positive % 1_000_000L) / 1_000_000.0
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

        val signature = graphSignature(cards, width, height)
        val cached = synchronized(this) { graphCache[signature] }
        if (cached != null) {
            diagnostics = BuildDiagnostics(didHitCache = true, cards = cards.size, edges = cached.edges.size)
            return cached
        }

        val built = computeGraph(cards, width, height)
        synchronized(this) {
            graphCache[signature] = built
            // accessOrder=true：迭代顺序即最近使用顺序，队首是最久未命中者
            while (graphCache.size > GRAPH_CACHE_CAPACITY) {
                graphCache.remove(graphCache.keys.first())
            }
            diagnostics = BuildDiagnostics(didHitCache = false, cards = cards.size, edges = built.edges.size)
        }
        return built
    }

    /** 视口自适应结果：screen = world * scale + offset */
    data class GraphFit(val scale: Float, val offsetX: Float, val offsetY: Float)

    /**
     * 把节点包围盒等比缩放并居中到视口内（四周留 padding）。
     *
     * 手机屏宽只有世界画布的两成，不做自适应就等于「进图永远只看到左上角一块」——
     * 纯函数，便于双端同一口径单测。包围盒退化（单点/空）时按 1:1 居中。
     */
    fun fitToViewport(
        minX: Float,
        minY: Float,
        maxX: Float,
        maxY: Float,
        viewWidth: Float,
        viewHeight: Float,
        padding: Float = 24f,
        minScale: Float = 0.45f,
        maxScale: Float = 3.2f,
    ): GraphFit {
        if (viewWidth <= 0f || viewHeight <= 0f) return GraphFit(1f, 0f, 0f)
        val bboxWidth = (maxX - minX).coerceAtLeast(1f)
        val bboxHeight = (maxY - minY).coerceAtLeast(1f)
        val usableWidth = (viewWidth - padding * 2f).coerceAtLeast(1f)
        val usableHeight = (viewHeight - padding * 2f).coerceAtLeast(1f)
        val scale = minOf(usableWidth / bboxWidth, usableHeight / bboxHeight).coerceIn(minScale, maxScale)
        val centerX = (minX + maxX) / 2f
        val centerY = (minY + maxY) / 2f
        return GraphFit(scale, viewWidth / 2f - centerX * scale, viewHeight / 2f - centerY * scale)
    }

    /** 节点包围盒；空图返回 null */
    fun boundsOf(nodes: List<GraphNode>): GraphBounds? {
        if (nodes.isEmpty()) return null
        var minX = Float.MAX_VALUE
        var minY = Float.MAX_VALUE
        var maxX = -Float.MAX_VALUE
        var maxY = -Float.MAX_VALUE
        for (node in nodes) {
            if (node.x < minX) minX = node.x
            if (node.x > maxX) maxX = node.x
            if (node.y < minY) minY = node.y
            if (node.y > maxY) maxY = node.y
        }
        return GraphBounds(minX, minY, maxX, maxY)
    }

    private fun computeGraph(
        cards: List<KnowledgeCard>,
        width: Float,
        height: Float,
    ): KnowledgeGraphData {
        val centerX = width / 2f
        val centerY = height / 2f

        // 1. 收集学科分类并分配星系圆心角
        val categories = cards.map { it.category }.distinct().sorted()
        val catCount = categories.size.coerceAtLeast(1)
        val sector = 2.0 * Math.PI / catCount
        val catAngleMap = HashMap<String, Double>()
        categories.forEachIndexed { index, cat ->
            catAngleMap[cat] = index * sector
        }

        // 2. 映射节点初始坐标
        val nodes = ArrayList<GraphNode>(cards.size)
        val cardKeywords = HashMap<String, Set<String>>(cards.size)

        for (card in cards) {
            val kw = extractKeywords(card)
            cardKeywords[card.id] = kw

            val catAngle = catAngleMap[card.category] ?: 0.0
            // 两个独立确定性哈希：角度铺满整个学科扇区、半径按 sqrt 均匀覆盖面积。
            // 旧写法只在扇区中轴附近抖 ±0.45rad，单学科或两学科的片子会塌成一条横线。
            val angleSeed = hashUnit(card.id, "angle")
            val radiusSeed = hashUnit(card.id, "radius")
            val radiusDist = 160.0 + sqrt(radiusSeed) * 320.0
            val finalAngle = catAngle + angleSeed * sector
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
        val invertedIndex = HashMap<String, MutableList<Int>>()
        for ((index, card) in cards.withIndex()) {
            val kwSet = cardKeywords[card.id] ?: emptySet()
            for (kw in kwSet) {
                invertedIndex.getOrPut(kw) { ArrayList() }.add(index)
            }
        }

        // 分类下标表：同科聚合候选按升序下标直取。原实现对每张卡都向后线性扫描整个数组
        // 找 3 张同类卡，卡片上千时这是 O(N²) 的另一处主要来源。
        val categoryIndices = HashMap<String, IntArray>()
        run {
            val buckets = HashMap<String, ArrayList<Int>>()
            for ((index, card) in cards.withIndex()) {
                buckets.getOrPut(card.category) { ArrayList() }.add(index)
            }
            for ((category, list) in buckets) {
                categoryIndices[category] = list.toIntArray()
            }
        }

        val edges = ArrayList<GraphEdge>()
        val connectionCount = HashMap<String, Int>()
        val seenEdgeIds = HashSet<String>()

        for (i in cards.indices) {
            val cardA = cards[i]
            val kwA = cardKeywords[cardA.id] ?: emptySet()

            // 统计与 cardA 共享关键词的候选卡片
            val candidateIndices = HashSet<Int>()
            for (kw in kwA) {
                val matches = invertedIndex[kw] ?: continue
                for (j in matches) {
                    if (j > i) {
                        candidateIndices.add(j)
                    }
                }
            }

            // 为同分类后续卡片补充基础学科候选（最多 3 张），确保同科聚合
            val sameCategory = categoryIndices[cardA.category]
            if (sameCategory != null) {
                val position = Arrays.binarySearch(sameCategory, i)
                var cursor = if (position >= 0) position + 1 else -position - 1
                var taken = 0
                while (cursor < sameCategory.size && taken < 3) {
                    candidateIndices.add(sameCategory[cursor])
                    cursor++
                    taken++
                }
            }

            val bestMatches = ArrayList<Triple<Int, RelationKind, Float>>()
            for (j in candidateIndices) {
                val cardB = cards[j]
                val kwB = cardKeywords[cardB.id] ?: emptySet()
                val relation = evaluateRelation(cardA, cardB, kwA, kwB) ?: continue
                bestMatches.add(Triple(j, relation.first, relation.second))
            }

            // 按权重降序，平局按下标升序（完全确定性）
            bestMatches.sortWith(
                compareByDescending<Triple<Int, RelationKind, Float>> { it.third }
                    .thenBy { it.first }
            )

            // 取最强 2 条连线
            for ((j, kind, weight) in bestMatches.take(2)) {
                val cardB = cards[j]
                val edgeId = if (cardA.id < cardB.id) "${cardA.id}_${cardB.id}" else "${cardB.id}_${cardA.id}"
                if (seenEdgeIds.add(edgeId)) {
                    edges.add(
                        GraphEdge(
                            id = edgeId,
                            sourceId = cardA.id,
                            targetId = cardB.id,
                            weight = weight,
                            kind = kind,
                        )
                    )
                    connectionCount[cardA.id] = (connectionCount[cardA.id] ?: 0) + 1
                    connectionCount[cardB.id] = (connectionCount[cardB.id] ?: 0) + 1
                }
            }
        }

        val completedNodes = nodes.map { node ->
            node.copy(connectionsCount = connectionCount[node.cardId] ?: 0)
        }

        return KnowledgeGraphData(nodes = completedNodes, edges = edges)
    }
}
