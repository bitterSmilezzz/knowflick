package com.knowflick.app.domain

import java.time.LocalDate
import kotlin.random.Random

/** 测验自评：没想起来 / 犹豫想起 / 熟练掌握（masteryLevel 0/1/2） */
enum class QuizRating(val masteryLevel: Int) {
    FORGOT(0),
    HESITANT(1),
    MASTERED(2),
}

/** 测验类型：自由测验 / 到期复习 / 针对性弱项重测 / 专项测验 */
enum class QuizType(val label: String) {
    STANDARD("知识测验"),
    DUE_REVIEW("到期复习"),
    WEAK_RETEST("针对性弱项重测"),
    CATEGORY("专项测验"),
}

/**
 * 测验轮次（纯逻辑，无视图依赖）：
 * - 选题优先级：到期复习（LearningPlan.due）→ 收藏 → 历史已读 → 其余补齐
 * - 守卫：同一张卡本轮只评一次（重复提交被拒）
 * - 评分经回调写回卡片（reviewCount / masteryLevel / lastReviewedAt），与 macOS 口径一致
 */
class QuizSession(
    val cards: List<KnowledgeCard>,
    private val ratings: LinkedHashMap<String, QuizRating> = LinkedHashMap(),
    val type: QuizType = QuizType.STANDARD,
) {
    var index: Int = 0
        private set

    val current: KnowledgeCard? get() = cards.getOrNull(index)
    val isFinished: Boolean get() = index >= cards.size
    val total: Int get() = cards.size

    /** 本轮评分记录（cardId → 评分） */
    val allRatings: Map<String, QuizRating> get() = ratings

    val summary: Map<QuizRating, Int>
        get() = QuizRating.entries.associateWith { rating -> ratings.values.count { it == rating } }

    /**
     * 提取本轮评价为「没想起来」或「犹豫想起」的薄弱卡片列表及其自评结果。
     * 排序规则：FORGOT（没想起来）优先排在最前，其次为 HESITANT（犹豫想起）。
     */
    fun weakCardsWithRatings(): List<Pair<KnowledgeCard, QuizRating>> {
        val cardMap = cards.associateBy { it.id }
        return ratings.entries
            .filter { it.value != QuizRating.MASTERED }
            .mapNotNull { (id, rating) -> cardMap[id]?.let { it to rating } }
            .sortedBy { (_, rating) -> rating.masteryLevel }
    }

    /**
     * 提交当前卡评分：同一张卡本轮只接受第一次提交。
     * 返回是否被接受（未接受时调用方可提示「本轮已评过」）。
     */
    fun rate(rating: QuizRating): Boolean {
        val card = current ?: return false
        if (ratings.containsKey(card.id)) return false
        ratings[card.id] = rating
        index += 1
        return true
    }

    /** 跨轮次去重：把已评分集合带进下一轮，避免「再测一组」重复同一批卡 */
    fun ratedIds(): Set<String> = ratings.keys.toSet()

    companion object {
        /**
         * 构建一轮测验：到期复习优先，其后收藏、历史，最后补齐其余卡片；限制数量并打乱。
         * random 可注入以便测试确定性。
         */
        fun build(
            cards: List<KnowledgeCard>,
            today: LocalDate,
            limit: Int = 10,
            category: String? = null,
            random: Random = Random.Default,
        ): QuizSession {
            if (limit <= 0) return QuizSession(emptyList())
            val pool = if (category.isNullOrBlank()) cards else cards.filter { it.category == category }
            val dueOrdered = LearningPlan(pool, today).due
            val dueIds = dueOrdered.mapTo(HashSet(dueOrdered.size)) { it.id }
            val favoriteIds = HashSet<String>()
            val favorites = pool
                .filter { it.isFavorite && it.id !in dueIds }
                .sortedByDescending { it.favoritedAt ?: 0L }
                .onEach { favoriteIds += it.id }
            val historyIds = HashSet<String>()
            val historyRead = pool
                .filter { it.seenAt != null && it.id !in dueIds && it.id !in favoriteIds }
                .sortedByDescending { it.seenAt ?: 0L }
                .onEach { historyIds += it.id }
            val rest = pool.filter { it.id !in dueIds && it.id !in favoriteIds && it.id !in historyIds }

            val ordered = dueOrdered + favorites.shuffled(random) + historyRead.shuffled(random) + rest.shuffled(random)
            val selected = ordered.take(limit)
            val type = if (category.isNullOrBlank()) QuizType.STANDARD else QuizType.CATEGORY
            return QuizSession(selected, type = type)
        }

        /** 构建纯到期复习题库（严格以 LearningPlan.due 优先级排布） */
        fun buildDueReview(
            cards: List<KnowledgeCard>,
            today: LocalDate,
            limit: Int = 10,
        ): QuizSession {
            if (limit <= 0) return QuizSession(emptyList(), type = QuizType.DUE_REVIEW)
            val due = LearningPlan(cards, today).due
            val selected = due.take(limit)
            return QuizSession(selected, type = QuizType.DUE_REVIEW)
        }

        /** 构建针对性弱项重测题组（提取前一轮中评价为遗忘或犹豫的卡片） */
        fun buildWeakCards(
            cards: List<KnowledgeCard>,
            ratings: Map<String, QuizRating>,
        ): QuizSession {
            val weakCardIds = ratings.filter { it.value != QuizRating.MASTERED }.keys
            val selected = cards.filter { it.id in weakCardIds }
            return QuizSession(selected, type = QuizType.WEAK_RETEST)
        }

        /**
         * 构建历史顽固错题集（复习过但掌握度仍为 0 的卡片）
         * 优先出复习次数较多（屡次记不住）的难点卡
         */
        fun buildPersistentWeakCards(
            cards: List<KnowledgeCard>,
            limit: Int = 10,
            category: String? = null,
        ): QuizSession {
            if (limit <= 0) return QuizSession(emptyList(), type = QuizType.WEAK_RETEST)
            val pool = if (category.isNullOrBlank()) cards else cards.filter { it.category == category }
            val weak = pool
                .filter { it.reviewCount > 0 && it.masteryLevel == 0 }
                .sortedByDescending { it.reviewCount }
                .take(limit)
            return QuizSession(weak, type = QuizType.WEAK_RETEST)
        }
    }
}
