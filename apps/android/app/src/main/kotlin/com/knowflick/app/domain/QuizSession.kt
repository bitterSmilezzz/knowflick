package com.knowflick.app.domain

import java.time.LocalDate
import kotlin.random.Random

/** 测验自评：没想起来 / 犹豫想起 / 熟练掌握（masteryLevel 0/1/2） */
enum class QuizRating(val masteryLevel: Int) {
    FORGOT(0),
    HESITANT(1),
    MASTERED(2),
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
         *
         * 性能：全部按 `id` 做集合运算。此前把 `favorites` / `historyRead`（List）当集合做
         * `it !in ...` 成员判断，退化成 O(n²)，且 `KnowledgeCard` 是 14 字段 data class
         * （等值比较含最长数百字的 `details`）；导入大归档后点「知识测验」会阻塞主线程数秒。
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
            // 到期队列只算一次（此前重复构造 LearningPlan 并算两遍）
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
            return QuizSession(selected)
        }
    }
}
