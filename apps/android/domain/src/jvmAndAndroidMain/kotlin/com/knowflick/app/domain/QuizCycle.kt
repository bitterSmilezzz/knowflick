package com.knowflick.app.domain

import com.knowflick.app.domain.spaced.SpacedRating
import com.knowflick.app.domain.spaced.SpacedRepetitionEngine
import java.time.LocalDate

/**
 * 测验轮次编排（跨轮）——**与宿主无关**的那部分：
 *
 * - 一轮 10 张：到期复习优先 → 收藏 → 历史 → 其余（顺序与随机由 [QuizSession.build] 负责）；
 * - 评分：驱动 SM-2 间隔演进（[SpacedRepetitionEngine]）并记进卡库（[CardStore.recordReviewResult]）；
 * - 下一轮：剔除**本周期已评过**的卡；都评完了就重置周期，重新从全库选；
 * - 弱项重测：用上一轮的评分挑出没掌握的卡再来一轮。
 *
 * 抽出来的理由（第一原则）：这套编排原先只写在 Android 的 ViewModel 里，桌面端要接同一个
 * 测验界面（`:shared-ui` 的 `QuizScreen`）就得再抄一遍——**逻辑只该有一份**。
 * 宿主只负责把 UI 事件转成这里的方法调用，以及「什么时候落盘」「什么时候重组」。
 */
class QuizCycle(private val store: CardStore) {

    /** 当前轮次；为 null 表示没在测验 */
    var session: QuizSession? = null
        private set

    /** 本周期内已评过分的卡 id（跨轮去重用；与单轮会话内的 ratings 不是一回事） */
    private val ratedInCycle = LinkedHashSet<String>()

    val isActive: Boolean get() = session != null

    /** 开始/刷新测验：到期复习优先，其后收藏与历史，单轮 [limit] 张；按分类可收窄 */
    fun start(today: LocalDate = LocalDate.now(), limit: Int = DEFAULT_LIMIT, category: String? = null) {
        ratedInCycle.clear()
        session = QuizSession.build(cards = store.cards, today = today, limit = limit, category = category)
    }

    /** 纯到期复习：以到期队列为准 */
    fun startDueReview(today: LocalDate = LocalDate.now(), limit: Int = DEFAULT_LIMIT) {
        ratedInCycle.clear()
        session = QuizSession.buildDueReview(cards = store.cards, today = today, limit = limit)
    }

    /** 针对性弱项重测：拿上一轮的评分挑出 FORGOT / HESITANT 的卡 */
    fun retestWeak(ratings: Map<String, QuizRating>) {
        ratedInCycle.clear()
        session = QuizSession.buildWeakCards(cards = store.cards, ratings = ratings)
    }

    /** 再测一组：剔除本周期已评的卡；都评完了就重置周期并回到全库 */
    fun nextRound(today: LocalDate = LocalDate.now(), limit: Int = DEFAULT_LIMIT) {
        var pool = store.cards.filter { it.id !in ratedInCycle }
        if (pool.isEmpty()) {
            ratedInCycle.clear()
            pool = store.cards
        }
        session = QuizSession.build(cards = pool, today = today, limit = limit)
    }

    /**
     * 提交评分：会话前进 + 间隔演进 + 记进卡库。
     * @return 是否真的记录了一次（会话已结束或已评过会返回 false，宿主据此决定要不要落盘）
     */
    fun rate(rating: QuizRating): Boolean {
        val current = session ?: return false
        val card = current.current ?: return false
        if (!current.rate(rating)) return false
        ratedInCycle += card.id
        val result = SpacedRepetitionEngine.calculate(card, SpacedRating.fromQuizRating(rating))
        store.recordReviewResult(card.id, result)
        return true
    }

    /** 退出并清空周期（下次开始测验重新计数） */
    fun exit() {
        session = null
        ratedInCycle.clear()
    }

    companion object {
        const val DEFAULT_LIMIT = 10
    }
}
