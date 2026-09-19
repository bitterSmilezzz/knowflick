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
        val filtered: List<KnowledgeCard> = if (preferredCategories.isEmpty()) {
            sourceFiltered
        } else {
            val preferred = sourceFiltered.filter { it.category in preferredCategories }
            if (preferred.isEmpty()) sourceFiltered else preferred
        }

        val existingDeckIds = deck.map { it.id }.toSet()
        val currentCards = filtered.associateBy { it.id }
        val remainingInDeck = deck.mapNotNull { currentCards[it.id] }
        val newCards = filtered.filter { it.id !in existingDeckIds }

        deck = when {
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

    /** 间隔重复复习自评：使用 SM-2 结果更新卡片记忆模型参数并重算排程 */
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
                val localId = local.id
                // 合并而非整卡替换：归档负责内容与来源，本机负责学习状态。
                // 归档常来自未带 isFavorite/seenAt 的旧导出版本，整卡覆盖会把收藏清空、
                // 并把已浏览的卡按 seenAt=null 塞回卡堆。
                working[matchIndex] = raw.copy(
                    id = localId,
                    createdAt = local.createdAt,
                    seenAt = raw.seenAt ?: local.seenAt,
                    swiped = raw.swiped ?: local.swiped,
                    isFavorite = local.isFavorite || raw.isFavorite,
                    favoritedAt = raw.favoritedAt ?: local.favoritedAt,
                    reviewCount = maxOf(local.reviewCount, raw.reviewCount),
                    masteryLevel = maxOf(local.masteryLevel, raw.masteryLevel),
                    lastReviewedAt = raw.lastReviewedAt ?: local.lastReviewedAt,
                )
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
