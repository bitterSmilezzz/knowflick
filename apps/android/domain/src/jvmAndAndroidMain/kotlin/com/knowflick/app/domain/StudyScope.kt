package com.knowflick.app.domain

/**
 * 学习范围：「专学一条支线，一点点看」或「多选混合」。
 *
 * 三个维度都是**空集 = 不限**；`branches` 用 `subject/branch` 复合键，避免不同学科下的同名分支互相串。
 * 范围生效时它接管分类维度（`preferredCategories` 让位），因为学习地图本身就是更结构化的分类选择器。
 */
data class StudyScope(
    val subjects: Set<String> = emptySet(),
    val branches: Set<String> = emptySet(),
    val levels: Set<Int> = emptySet(),
    /** true = 按 orderKey 顺序推进（不再随机打散），false = 混着刷 */
    val sequential: Boolean = false,
) {
    val isActive: Boolean get() = subjects.isNotEmpty() || branches.isNotEmpty() || levels.isNotEmpty()

    fun matches(card: KnowledgeCard): Boolean {
        val taxonomy = SubjectRegistry.taxonomyOf(card)
        if (subjects.isNotEmpty() && taxonomy.subject !in subjects) return false
        if (branches.isNotEmpty() && branchKey(taxonomy.subject, taxonomy.branch) !in branches) return false
        if (levels.isNotEmpty() && taxonomy.level !in levels) return false
        return true
    }

    fun filter(cards: List<KnowledgeCard>): List<KnowledgeCard> = cards.filter { matches(it) }

    /** 顺序推进时按 orderKey 排；缺 orderKey 的落到最后并按标题稳定排序，保证两次结果一致 */
    fun orderForDeck(cards: List<KnowledgeCard>): List<KnowledgeCard> {
        if (!sequential) return cards
        return cards.sortedWith(
            compareBy<KnowledgeCard> { it.orderKey ?: NO_ORDER_KEY }
                .thenBy { it.subject ?: "" }
                .thenBy { it.headline }
        )
    }

    /** 顶栏徽标文案，如「英语 · 语法 · L2」 */
    fun describe(): String {
        if (!isActive) return ""
        val parts = mutableListOf<String>()
        // 分支标签自带学科前缀（「会计 · 资产」），此时再列学科名就是重复；
        // 只列分支还带来另一个好处：徽标读起来就是「我在学什么」。
        if (branches.isNotEmpty()) {
            branches.forEach { key ->
                val subject = key.substringBefore("/")
                val branch = key.substringAfter("/", "")
                parts += if (branch.isEmpty() || branch == UNBRANCHED) {
                    SubjectRegistry.displayName(subject)
                } else {
                    SubjectRegistry.displayName(subject, branch)
                }
            }
        } else {
            subjects.mapTo(parts) { SubjectRegistry.displayName(it) }
        }
        levels.mapTo(parts) { SubjectRegistry.levelName(it) }
        return parts.distinct().joinToString("、")
    }

    companion object {
        val None = StudyScope()

        /** 分支复合键；未分分支用 `—` 占位，保证能与「不限分支」区分开 */
        fun branchKey(subject: String?, branch: String?): String = "$subject/${branch ?: UNBRANCHED}"

        const val UNBRANCHED = "—"

        /** 没标 orderKey 的卡排在最后（历史卡普遍没有顺序），用 BMP 末位字符当哨兵 */
        private const val NO_ORDER_KEY = "\uFFFF"
    }
}

/** 学科进度（学习地图第一层） */
data class SubjectProgress(
    val slug: String?,
    val name: String,
    val total: Int,
    val seen: Int,
    val mastered: Int,
    val branchCount: Int,
)

/** 分支进度（学习地图第二层） */
data class BranchProgress(
    val key: String,
    val slug: String?,
    val name: String,
    val total: Int,
    val seen: Int,
    val mastered: Int,
    val levels: List<LevelProgress>,
) {
    /** 该分支里最小的还没学完的难度档，用来显示「下一步：L2 基础」 */
    val nextLevel: Int?
        get() = levels.sortedBy { it.level ?: Int.MAX_VALUE }
            .firstOrNull { level -> level.total > level.seen }
            ?.level
}

data class LevelProgress(val level: Int?, val name: String, val total: Int, val seen: Int)

/**
 * 学习地图的派生视图：全部是纯函数，JVM 可测。
 * 卡片量级在几千张以内，每次进页面重算即可，不做缓存（缓存失效的复杂度不值当）。
 */
object StudyMap {

    fun subjectProgress(cards: List<KnowledgeCard>): List<SubjectProgress> {
        class Bucket { var total = 0; var seen = 0; var mastered = 0; val branches = HashSet<String>() }
        val buckets = LinkedHashMap<String?, Bucket>()
        for (card in cards) {
            val taxonomy = SubjectRegistry.taxonomyOf(card)
            val bucket = buckets.getOrPut(taxonomy.subject) { Bucket() }
            bucket.total += 1
            if (card.seenAt != null) bucket.seen += 1
            if (card.masteryLevel >= 2) bucket.mastered += 1
            bucket.branches += StudyScope.branchKey(taxonomy.subject, taxonomy.branch)
        }
        return buckets.entries
            .map { (slug, bucket) ->
                SubjectProgress(
                    slug = slug,
                    name = SubjectRegistry.displayName(slug),
                    total = bucket.total,
                    seen = bucket.seen,
                    mastered = bucket.mastered,
                    branchCount = bucket.branches.size,
                )
            }
            .sortedWith(
                compareByDescending<SubjectProgress> { it.slug != null }
                    .thenByDescending { it.total }
                    .thenBy { it.name }
            )
    }

    fun branchProgress(cards: List<KnowledgeCard>, subject: String?): List<BranchProgress> {
        val inSubject = cards.filter { SubjectRegistry.shardSlugOf(it) == subject }
        class Bucket {
            var total = 0; var seen = 0; var mastered = 0
            val levels = LinkedHashMap<Int?, IntArray>()   // [total, seen]
        }
        val buckets = LinkedHashMap<String, Bucket>()
        for (card in inSubject) {
            val taxonomy = SubjectRegistry.taxonomyOf(card)
            val key = StudyScope.branchKey(subject, taxonomy.branch)
            val bucket = buckets.getOrPut(key) { Bucket() }
            bucket.total += 1
            if (card.seenAt != null) bucket.seen += 1
            if (card.masteryLevel >= 2) bucket.mastered += 1
            val levelCell = bucket.levels.getOrPut(taxonomy.level) { IntArray(2) }
            levelCell[0] += 1
            if (card.seenAt != null) levelCell[1] += 1
        }
        val spec = SubjectRegistry.subject(subject)
        return buckets.entries
            .map { (key, bucket) ->
                val slug = key.substringAfter("/", "")
                BranchProgress(
                    key = key,
                    slug = slug.takeIf { it.isNotEmpty() && it != StudyScope.UNBRANCHED },
                    name = slug.takeIf { it != StudyScope.UNBRANCHED }?.let { spec?.branch(it)?.name ?: it } ?: "未分分支",
                    total = bucket.total,
                    seen = bucket.seen,
                    mastered = bucket.mastered,
                    levels = bucket.levels.entries
                        .map { (level, cell) -> LevelProgress(level, SubjectRegistry.levelName(level), cell[0], cell[1]) }
                        .sortedBy { it.level ?: Int.MAX_VALUE },
                )
            }
            .sortedWith(
                compareByDescending<BranchProgress> { it.slug != null }
                    .thenByDescending { it.total }
                    .thenBy { it.name }
            )
    }

    /** 该范围下还剩多少没学（地图与顶栏徽标共用） */
    fun remaining(cards: List<KnowledgeCard>, scope: StudyScope): Int =
        scope.filter(cards).count { it.seenAt == null }
}
