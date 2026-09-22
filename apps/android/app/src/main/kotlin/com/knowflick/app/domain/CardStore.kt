package com.knowflick.app.domain

/**
 * 应用状态机：卡片池、卡堆、历史、收藏、统计与刷卡意图。
 * 移植自 macOS `AppStore`（同步核）：所有 seenAt/swiped 写入必须经由意图化方法，
 * 收藏（isFavorite）与喜好（swiped）解耦，卡堆输出统一经防重排布。
 */
class CardStore(
    /** 预置卡（来自 assets 的种子库）；由调用方在启动时注入 */
    var seedCards: List<KnowledgeCard> = emptyList(),
    /** 底图 key 解析器：排布与渲染必须共用同一 key 空间 */
    private val keyFor: (KnowledgeCard) -> String = CardThemeResolver::forCard,
) {

    data class ArchiveRestoreResult(
        val added: Int,
        val restored: Int,
        val ignored: Int,
    ) {
        val accepted: Int get() = added + restored
    }

    // ---------- 可持久化状态 ----------

    var cards: List<KnowledgeCard> = emptyList()
        private set

    /** 偏好分类（多选；空 = 全部） */
    var preferredCategories: Set<String> = emptySet()

    /**
     * 学习范围（学习地图设置）。生效时**接管分类维度**：`preferredCategories` 让位，
     * 因为地图本身就是更结构化的学科/分支/难度选择器，两套过滤叠着只会让人看不懂当前在学什么。
     */
    var studyScope: StudyScope = StudyScope.None

    /** 来源开关：只开其一则只看该来源；全关则队列为空（含导入卡片，口径与 macOS 一致） */
    var enableSeed: Boolean = true
    var enableAI: Boolean = true

    // ---------- 派生状态 ----------

    var deck: List<KnowledgeCard> = emptyList()
        private set
    var history: List<KnowledgeCard> = emptyList()
        private set
    var favorites: List<KnowledgeCard> = emptyList()
        private set

    val topCard: KnowledgeCard? get() = deck.firstOrNull()

    // ---------- 变更记录 ----------
    /**
     * 撤销栈：最近一次刷卡前的整卡快照（含 seenAt/swiped）。
     * recompute 依据它把被撤销的卡片精准插回队首；撤销只能做一次，还原后即清空。
     */
    private var lastSwipeSnapshot: KnowledgeCard? = null

    /** 是否可撤销（UI 据此决定「撤销上一张」是否可点） */
    val canUndoLastSwipe: Boolean get() = lastSwipeSnapshot != null

    init {
        recompute()
    }

    /** 全量重建派生状态（cards 变更后必须调用；与 macOS 的 didSet 等价） */
    fun recompute() {
        history = cards
            .filter { it.seenAt != null }
            .sortedByDescending { it.seenAt ?: 0L }
        favorites = cards.filter { it.isFavorite }
            .sortedByDescending { it.favoritedAt ?: 0L }
        CardThemeCache.prune(cards.map { it.id })

        val unseen = cards.filter { it.seenAt == null }
        val sourceFiltered = if (enableSeed && enableAI) unseen else unseen.filter { card ->
            when (card.source) {
                CardSource.SEED -> enableSeed
                CardSource.AI -> enableAI
                CardSource.IMPORTED -> false
            }
        }
        val scoped = if (studyScope.isActive) {
            studyScope.filter(sourceFiltered)
        } else if (preferredCategories.isEmpty()) {
            sourceFiltered
        } else {
            val preferred = sourceFiltered.filter { it.category in preferredCategories }
            if (preferred.isEmpty()) sourceFiltered else preferred
        }
        // 「专学这条支线」要的是推进顺序，不是背景图多样性：顺序模式下跳过防重打散
        val filtered = studyScope.orderForDeck(scoped)

        val existingDeckIds = deck.map { it.id }.toSet()
        val currentCards = filtered.associateBy { it.id }
        val remainingInDeck = deck.mapNotNull { currentCards[it.id] }
        val newCards = filtered.filter { it.id !in existingDeckIds }

        deck = if (studyScope.isActive && studyScope.sequential) {
            // 专学模式：「按导入顺序一级一级往前推」就是产品语义，必须跳过背景图防重打散
            // 与增量拼接——打散会把学习顺序冲掉。划走即 seenAt != null，自然离开队列，
            // 撤销则回到它在 orderKey 上的原位（比"插回队首"更符合路径语义）。
            filtered
        } else when {
            remainingInDeck.isNotEmpty() && newCards.isEmpty() -> {
                // 日常划卡出队：直接移除划走卡片，100% 保留排好的无碰撞队列顺序
                remainingInDeck
            }
            remainingInDeck.isNotEmpty() && newCards.size == 1 && newCards.first().id == lastSwipeSnapshot?.id -> {
                // 撤销上一张场景：卡片精准插回顶部
                listOf(newCards.first()) + remainingInDeck
            }
            remainingInDeck.isNotEmpty() && newCards.isNotEmpty() && newCards.size <= 10 -> {
                // AI 异步生成新卡（3~6 张）：安排防重排布后追加至末尾，不打散前部
                val lastKey = remainingInDeck.lastOrNull()?.let(keyFor)
                remainingInDeck + CardArrange.arrange(newCards, minDistance = 5, avoidingTopKey = lastKey, keyFor = keyFor)
            }
            else -> {
                // 全新初始化 / 切换过滤 / 清空历史：全量重新排布
                val lastKey = history.firstOrNull()?.let { keyFor(it) }
                CardArrange.arrange(filtered, minDistance = 5, avoidingTopKey = lastKey, keyFor = keyFor)
            }
        }
    }

    // ---------- 刷卡意图 ----------

    /**
     * 划走当前卡片。
     * - right：加入收藏（favoritedAt = now）
     * - left：移出收藏
     * - skip：不动收藏
     * 对已有 seenAt 的卡保留原浏览时间（历史页打标签不重排时间线）。
     */
    fun swipe(card: KnowledgeCard, direction: SwipeDirection) {
        val index = cards.indexOfFirst { it.id == card.id }
        if (index < 0) return
        val old = cards[index]
        val now = System.currentTimeMillis()
        var updated = old.copy(
            seenAt = old.seenAt ?: now,
            swiped = direction,
        )
        when (direction) {
            SwipeDirection.RIGHT -> if (!updated.isFavorite) {
                updated = updated.copy(isFavorite = true, favoritedAt = now)
            }
            SwipeDirection.LEFT -> if (updated.isFavorite) {
                updated = updated.copy(isFavorite = false, favoritedAt = null)
            }
            SwipeDirection.SKIP -> Unit
        }
        cards = cards.toMutableList().apply { set(index, updated) }
        lastSwipeSnapshot = old
        recompute()
    }

    /**
     * 撤销最近一次刷卡：把 `seenAt` / `swiped` 还原为刷卡前的快照值，卡片随即插回队首。
     *
     * **收藏（isFavorite / favoritedAt）不参与还原**，与 macOS `AppStore.undoLastSwipe`
     * （只重置 seenAt/swiped）口径对齐：撤销的是「浏览意图」，右划顺带产生的收藏属于用户的
     * 显式沉淀，不因撤销被连带抹掉；反之，若该卡此前已被 ♥ 收藏，撤销也绝不能把它取消收藏
     * —— 这正是历史实现（无条件 `isFavorite = false`）违反 CONTEXT.md「收藏与喜好解耦」的地方。
     *
     * 用快照而非硬编码 null 还原 `seenAt`：对「已读卡在历史页再划」的场景，硬编码 null 会
     * 抹掉其浏览时间并把卡片错误地推回卡堆。
     */
    fun undoLastSwipe() {
        val snapshot = lastSwipeSnapshot ?: return
        val index = cards.indexOfFirst { it.id == snapshot.id }
        if (index < 0) {
            lastSwipeSnapshot = null
            return
        }
        val restored = cards[index].copy(seenAt = snapshot.seenAt, swiped = snapshot.swiped)
        cards = cards.toMutableList().apply { set(index, restored) }
        // recompute 需要 snapshot.id 来把卡片插回队首，故在重算之后再清空撤销栈
        recompute()
        lastSwipeSnapshot = null
    }

    /** 切换收藏：只翻转 isFavorite，不触碰 swiped / seenAt（收藏未读卡不算已浏览） */
    fun toggleFavorite(card: KnowledgeCard) {
        val index = cards.indexOfFirst { it.id == card.id }
        if (index < 0) return
        val updated = cards[index].copy(
            isFavorite = !cards[index].isFavorite,
            favoritedAt = if (!cards[index].isFavorite) System.currentTimeMillis() else null,
        )
        cards = cards.toMutableList().apply { set(index, updated) }
        recompute()
    }

    /** 「重新探索全部卡片」：清空浏览记录；保留收藏（显式沉淀内容不因重置丢失） */
    fun clearHistory() {
        cards = cards.map { it.copy(seenAt = null) }
        recompute()
    }

    /** 置顶到待刷卡堆（全局搜索快速定位） */
    fun promoteToDeckTop(card: KnowledgeCard) {
        if (deck.firstOrNull()?.id == card.id) return
        val target = cards.firstOrNull { it.id == card.id } ?: return
        deck = listOf(target) + deck.filter { it.id != card.id }
    }

    /** 测验评分：累计复习次数并覆盖熟练度（每次提交都计入，守卫职责在视图层） */
    fun recordQuizResult(cardId: String, masteryLevel: Int, now: Long = System.currentTimeMillis()) {
        val index = cards.indexOfFirst { it.id == cardId }
        if (index < 0) return
        val updated = cards[index].copy(
            reviewCount = cards[index].reviewCount + 1,
            masteryLevel = masteryLevel.coerceIn(0, 2),
            lastReviewedAt = now,
        )
        cards = cards.toMutableList().apply { set(index, updated) }
        recompute()
    }

    /** 间隔重复复习自评：使用 SM-2 / FSRS 结果更新卡片记忆模型参数并重算排程 */
    fun recordReviewResult(
        cardId: String,
        result: com.knowflick.app.domain.spaced.SpacedReviewResult,
    ) {
        val index = cards.indexOfFirst { it.id == cardId }
        if (index < 0) return
        val current = cards[index]
        val updated = current.copy(
            reviewCount = current.reviewCount + 1,
            repetition = result.repetition,
            intervalDays = result.intervalDays,
            easeFactor = result.easeFactor,
            masteryLevel = result.masteryLevel.coerceIn(0, 2),
            lastReviewedAt = result.lastReviewedAt,
            stability = if (result.stability > 0.0) result.stability else current.stability,
            difficulty = if (result.difficulty > 0.0) result.difficulty else current.difficulty,
        )
        cards = cards.toMutableList().apply { set(index, updated) }
        recompute()
    }

    /** 合并外部卡片（导入 / AI 生成 / 种子增量），归一化标题去重，默认置顶 */
    fun addCards(incoming: List<KnowledgeCard>, insertAtTop: Boolean = true): Int {
        val existingHeadlines = cards.map { CardTextUtils.normalizeHeadline(it.headline) }.toSet()
        val unique = ArrayList<KnowledgeCard>(incoming.size)
        val seenHeadlines = existingHeadlines.toMutableSet()
        for (card in incoming) {
            val key = CardTextUtils.normalizeHeadline(card.headline)
            if (key.isEmpty() || !seenHeadlines.add(key)) continue
            unique.add(card)
        }
        if (unique.isEmpty()) return 0
        cards = if (insertAtTop) unique + cards else cards + unique
        recompute()
        return unique.size
    }

    /**
     * 合并完整 JSON 归档：优先按 id、其次按归一化标题匹配已有卡片。
     * 已有卡保留本机 id 并恢复归档里的正文、来源和全部学习状态；新卡保留归档 id。
     * 这与 [addCards] 的“新增内容并去重”语义分开，避免恢复备份时丢失收藏、历史和复习进度。
     */
    fun restoreArchive(incoming: List<KnowledgeCard>, insertNewAtTop: Boolean = true): ArchiveRestoreResult {
        val working = cards.toMutableList()
        val addedIds = LinkedHashSet<String>()
        var restored = 0
        var ignored = 0

        // id → 位置、归一化标题 → 位置的索引：归档可达上万张卡，逐张线性扫描是 O(n×m)，
        // 在 25 MiB 上限的大归档下会阻塞主线程。索引在插入新卡时同步维护。
        val indexById = HashMap<String, Int>(working.size * 2)
        val indexByHeadline = HashMap<String, Int>(working.size * 2)
        working.forEachIndexed { i, card ->
            indexById.putIfAbsent(card.id, i)
            val key = CardTextUtils.normalizeHeadline(card.headline)
            if (key.isNotEmpty()) indexByHeadline.putIfAbsent(key, i)
        }

        for (raw in incoming) {
            val headlineKey = CardTextUtils.normalizeHeadline(raw.headline)
            if (headlineKey.isEmpty()) {
                ignored++
                continue
            }
            val matchIndex = indexById[raw.id] ?: indexByHeadline[headlineKey]

            if (matchIndex != null) {
                val local = working[matchIndex]
                val merged = mergeCard(local, raw).copy(id = local.id)
                working[matchIndex] = merged
                restored++
            } else {
                var safeId = raw.id.trim()
                while (safeId.isEmpty() || indexById.containsKey(safeId)) {
                    safeId = java.util.UUID.randomUUID().toString().uppercase()
                }
                val added = raw.copy(id = safeId)
                val newIndex = working.size
                working += added
                addedIds += safeId
                indexById[safeId] = newIndex
                indexByHeadline.putIfAbsent(headlineKey, newIndex)
            }
        }

        cards = if (insertNewAtTop && addedIds.isNotEmpty()) {
            working.filter { it.id in addedIds } + working.filter { it.id !in addedIds }
        } else {
            working
        }
        recompute()
        return ArchiveRestoreResult(added = addedIds.size, restored = restored, ignored = ignored)
    }

    companion object {
        /**
         * 对称式字段级无损合并单张卡片：`mergeCard(a, b) == mergeCard(b, a)`
         */
        fun mergeCard(a: KnowledgeCard, b: KnowledgeCard): KnowledgeCard {
            // 1. ID 与创建时间：若 ID 相同直接使用；若按标题匹配不同 ID，取更早创建时间与对应 ID
            val mergedId = when {
                a.id == b.id -> a.id
                a.createdAt < b.createdAt -> a.id
                b.createdAt < a.createdAt -> b.id
                a.id <= b.id -> a.id
                else -> b.id
            }
            val createdAt = minOf(a.createdAt, b.createdAt)

            // 2. 正文与元数据
            val (primary, secondary) = if (a.createdAt >= b.createdAt) a to b else b to a
            val category = primary.category.ifBlank { secondary.category }
            val headline = primary.headline.ifBlank { secondary.headline }
            val summary = primary.summary.ifBlank { secondary.summary }
            val details = if (primary.details.isBlank()) {
                secondary.details
            } else if (primary.details.length >= secondary.details.length) {
                primary.details
            } else {
                secondary.details
            }
            val links = if (primary.links.isNotEmpty()) primary.links else secondary.links
            val source = if (primary.source == CardSource.SEED && secondary.source != CardSource.SEED) {
                secondary.source
            } else {
                primary.source
            }

            // 3. 浏览足迹与意图（保留最新 seenAt）
            val seenAt: Long?
            val swiped: SwipeDirection?
            val sA = a.seenAt
            val sB = b.seenAt
            when {
                sA != null && sB != null -> {
                    if (sA >= sB) {
                        seenAt = sA
                        swiped = a.swiped ?: b.swiped
                    } else {
                        seenAt = sB
                        swiped = b.swiped ?: a.swiped
                    }
                }
                sA != null -> {
                    seenAt = sA
                    swiped = a.swiped
                }
                sB != null -> {
                    seenAt = sB
                    swiped = b.swiped
                }
                else -> {
                    seenAt = null
                    swiped = a.swiped ?: b.swiped
                }
            }

            // 4. 收藏状态（任一端收藏即为收藏，保留最新收藏时间）
            val isFavorite = a.isFavorite || b.isFavorite
            val favoritedAt = when {
                a.favoritedAt != null && b.favoritedAt != null -> maxOf(a.favoritedAt, b.favoritedAt)
                a.favoritedAt != null -> a.favoritedAt
                b.favoritedAt != null -> b.favoritedAt
                isFavorite -> seenAt
                else -> null
            }

            // 5. SM-2 / FSRS 记忆模型与复习状态（以最新 lastReviewedAt 为主）
            val reviewCount = maxOf(a.reviewCount, b.reviewCount)
            val masteryLevel: Int
            val lastReviewedAt: Long?
            val repetition: Int
            val intervalDays: Int
            val easeFactor: Double
            val stability: Double
            val difficulty: Double

            val rA = a.lastReviewedAt
            val rB = b.lastReviewedAt
            when {
                rA != null && rB != null -> {
                    if (rA > rB) {
                        masteryLevel = a.masteryLevel
                        lastReviewedAt = rA
                        repetition = a.repetition
                        intervalDays = a.intervalDays
                        easeFactor = a.easeFactor
                        stability = if (a.stability > 0.0) a.stability else b.stability
                        difficulty = if (a.difficulty > 0.0) a.difficulty else b.difficulty
                    } else if (rB > rA) {
                        masteryLevel = b.masteryLevel
                        lastReviewedAt = rB
                        repetition = b.repetition
                        intervalDays = b.intervalDays
                        easeFactor = b.easeFactor
                        stability = if (b.stability > 0.0) b.stability else a.stability
                        difficulty = if (b.difficulty > 0.0) b.difficulty else a.difficulty
                    } else {
                        masteryLevel = maxOf(a.masteryLevel, b.masteryLevel)
                        lastReviewedAt = rA
                        repetition = maxOf(a.repetition, b.repetition)
                        intervalDays = maxOf(a.intervalDays, b.intervalDays)
                        easeFactor = maxOf(a.easeFactor, b.easeFactor)
                        stability = maxOf(a.stability, b.stability)
                        difficulty = maxOf(a.difficulty, b.difficulty)
                    }
                }
                rA != null -> {
                    masteryLevel = a.masteryLevel
                    lastReviewedAt = rA
                    repetition = a.repetition
                    intervalDays = a.intervalDays
                    easeFactor = a.easeFactor
                    stability = a.stability
                    difficulty = a.difficulty
                }
                rB != null -> {
                    masteryLevel = b.masteryLevel
                    lastReviewedAt = rB
                    repetition = b.repetition
                    intervalDays = b.intervalDays
                    easeFactor = b.easeFactor
                    stability = b.stability
                    difficulty = b.difficulty
                }
                else -> {
                    masteryLevel = maxOf(a.masteryLevel, b.masteryLevel)
                    lastReviewedAt = null
                    repetition = maxOf(a.repetition, b.repetition)
                    intervalDays = maxOf(a.intervalDays, b.intervalDays)
                    easeFactor = maxOf(a.easeFactor, b.easeFactor)
                    stability = maxOf(a.stability, b.stability)
                    difficulty = maxOf(a.difficulty, b.difficulty)
                }
            }

            return KnowledgeCard(
                id = mergedId,
                category = category,
                headline = headline,
                summary = summary,
                details = details,
                links = links,
                source = source,
                createdAt = createdAt,
                seenAt = seenAt,
                swiped = swiped,
                isFavorite = isFavorite,
                favoritedAt = favoritedAt,
                reviewCount = reviewCount,
                masteryLevel = masteryLevel,
                lastReviewedAt = lastReviewedAt,
                repetition = repetition,
                intervalDays = intervalDays,
                easeFactor = easeFactor,
                stability = stability,
                difficulty = difficulty,
                // 学科体系是**内容元数据**而非学习状态：逐字段非空优先、较新的一端胜出，
                // 避免一端补过分级后被另一端冲掉。
                subject = primary.subject ?: secondary.subject,
                branch = primary.branch ?: secondary.branch,
                level = primary.level ?: secondary.level,
                track = primary.track ?: secondary.track,
                orderKey = primary.orderKey ?: secondary.orderKey,
                prereq = if (primary.prereq.isNotEmpty()) primary.prereq else secondary.prereq,
            )
        }
    }

    /** 用卡库快照整体替换（持久化层加载 / 清空历史等场景） */
    fun replaceAll(newCards: List<KnowledgeCard>) {
        cards = newCards
        recompute()
    }

    /** 主题键缓存裁剪：卡库变更后清掉已删除卡片的条目 */
    internal object CardThemeCache {
        fun prune(keeping: List<String>) {
            CardThemeResolver.pruneKeyCache(keeping.toSet())
        }
    }
}
