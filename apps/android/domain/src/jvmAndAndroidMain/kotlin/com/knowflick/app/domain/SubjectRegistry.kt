package com.knowflick.app.domain

/** 分支定义 */
data class BranchSpec(val slug: String, val name: String)

/** 学科定义（含可选的应试标尺与分支列表） */
data class SubjectSpec(
    val slug: String,
    val name: String,
    val tracks: List<String> = emptyList(),
    val branches: List<BranchSpec> = emptyList(),
) {
    fun branch(slug: String?): BranchSpec? =
        slug?.let { target -> branches.firstOrNull { it.slug == target } }
}

/** 一张卡片生效后的学科坐标；全部可空，未分级内容落在 subject == null */
data class CardTaxonomy(
    val subject: String?,
    val branch: String?,
    val level: Int?,
    val track: String?,
    val orderKey: String?,
)

/** 历史单层 category → 学科坐标的映射条目 */
data class LegacyMapping(
    val subject: String,
    val branch: String? = null,
    val track: String? = null,
)

/**
 * 学科 → 分支 → 难度 的单一注册表（与 macOS `SubjectRegistry` 逐字段对齐）。
 *
 * 表内嵌在代码里而不是运行时读 `shared/assets/taxonomy_map.json`：APK 资产与 SwiftPM 资源
 * bundle 都有过「本地有、CI 没有」的历史。JSON 只作契约夹具——两端各有 parity 测试逐条比对，
 * Python 导入管道也读同一文件，任何一侧改漏都会红。
 */
object SubjectRegistry {

    /** 难度档位命名（1..5）。与 FSRS 的 difficulty（记忆难度）无关。 */
    val levels: Map<Int, String> = mapOf(
        1 to "入门", 2 to "基础", 3 to "进阶", 4 to "应试实战", 5 to "精通",
    )

    val subjects: List<SubjectSpec> = listOf(
        SubjectSpec("ai", "AI", branches = listOf(
            BranchSpec("basics", "AI 基础"),
            BranchSpec("agents", "AI Agent"),
            BranchSpec("tools", "工具与用法"),
        )),
        SubjectSpec("ai-dev", "AI 开发", branches = listOf(
            BranchSpec("prompt", "提示工程"),
            BranchSpec("rag", "RAG 与检索"),
            BranchSpec("finetune", "微调与训练"),
            BranchSpec("app", "应用开发"),
        )),
        SubjectSpec("english", "英语", tracks = listOf("高中英语", "大学英语四级", "大学英语六级"), branches = listOf(
            BranchSpec("vocabulary", "词汇"),
            BranchSpec("grammar", "语法"),
            BranchSpec("reading", "阅读"),
            BranchSpec("listening", "听力"),
            BranchSpec("writing", "写作"),
        )),
        SubjectSpec("accounting", "会计", tracks = listOf("初级会计", "中级会计", "注册会计师"), branches = listOf(
            BranchSpec("assets", "资产"),
            BranchSpec("liabilities", "负债与所有者权益"),
            BranchSpec("revenue", "收入与费用"),
            BranchSpec("cost", "成本核算"),
            BranchSpec("reporting", "报表编制"),
        )),
        SubjectSpec("finance", "金融", branches = listOf(
            BranchSpec("statements", "财报分析"),
            BranchSpec("valuation", "估值"),
            BranchSpec("risk", "风险与配置"),
            BranchSpec("instruments", "品种与市场"),
        )),
        SubjectSpec("programming", "编程架构", branches = listOf(
            BranchSpec("architecture", "系统架构"),
            BranchSpec("algorithms", "算法与数据结构"),
            BranchSpec("data", "数据与存储"),
            BranchSpec("delivery", "工程实践"),
        )),
        SubjectSpec("trivia", "冷知识"),
    )

    /**
     * 历史单层 `category` → 学科坐标。未列出的分类（物理/天文/数学…）视为未分级，
     * 由界面归入「未分级」而不是被硬塞进某个学科。
     */
    val legacyCategoryMap: Map<String, LegacyMapping> = mapOf(
        "AI" to LegacyMapping("ai", "basics"),
        "AI 开发" to LegacyMapping("ai-dev"),
        "AI Agent" to LegacyMapping("ai", "agents"),
        "中级会计" to LegacyMapping("accounting", track = "中级会计"),
        "会计" to LegacyMapping("accounting"),
        "投资理财" to LegacyMapping("finance"),
        "冷知识" to LegacyMapping("trivia"),
        "英语" to LegacyMapping("english"),
        "语言" to LegacyMapping("english"),
        "编程" to LegacyMapping("programming"),
        "算法" to LegacyMapping("programming", "algorithms"),
        "Python" to LegacyMapping("programming"),
        "Rust" to LegacyMapping("programming"),
    )

    private val bySlug: Map<String, SubjectSpec> = subjects.associateBy { it.slug }

    fun subject(slug: String?): SubjectSpec? = slug?.let { bySlug[it] }

    val allSubjectSlugs: List<String> get() = subjects.map { it.slug }

    fun levelName(level: Int?): String {
        if (level == null) return "未分级"
        val name = levels[level] ?: return "L$level"
        return "L$level $name"
    }

    /** 卡片生效的学科坐标：显式字段优先，缺失时按旧 `category` 派生。 */
    fun taxonomyOf(card: KnowledgeCard): CardTaxonomy {
        val mapping = legacyCategoryMap[card.category]
        return CardTaxonomy(
            subject = card.subject ?: mapping?.subject,
            branch = card.branch ?: mapping?.branch,
            level = card.level,
            track = card.track ?: mapping?.track,
            orderKey = card.orderKey,
        )
    }

    /** 学科展示名（未知 slug 原样返回，避免界面出现空白） */
    fun displayName(subject: String?): String =
        subject?.let { this.subject(it)?.name ?: it } ?: "未分级"

    fun displayName(subject: String?, branch: String?): String {
        val spec = this.subject(subject) ?: return subject ?: "未分级"
        val branchSpec = spec.branch(branch) ?: return spec.name
        return "${spec.name} · ${branchSpec.name}"
    }

    // ---- 分片（星图与学习地图共用）----

    /** 学科摘要：分片选择器用；`slug == null` 表示「未分级」那一片。 */
    data class SubjectSummary(val slug: String?, val name: String, val count: Int)

    /** 卡片所属学科 slug（含 category 派生），未分级返回 null。 */
    fun shardSlugOf(card: KnowledgeCard): String? = taxonomyOf(card).subject

    /** 按学科取子集：`subject == null` 时取「未分级」那一片，不做跨片混入。 */
    fun cardsIn(cards: List<KnowledgeCard>, subject: String?): List<KnowledgeCard> =
        cards.filter { shardSlugOf(it) == subject }

    /** 分片摘要（按卡数降序、同数按名称），未分级固定排在末尾。 */
    fun subjectSummaries(cards: List<KnowledgeCard>): List<SubjectSummary> {
        val tally = LinkedHashMap<String?, Int>()
        for (card in cards) tally[shardSlugOf(card)] = (tally[shardSlugOf(card)] ?: 0) + 1
        return tally.entries
            .map { entry -> SubjectSummary(entry.key, displayName(entry.key), entry.value) }
            .sortedWith(
                compareByDescending<SubjectSummary> { it.slug != null }
                    .thenByDescending { it.count }
                    .thenBy { it.name }
            )
    }

    /** 导入管道与内容编辑的校验口径（与 macOS / Python 侧一致） */
    fun validationIssues(card: KnowledgeCard): List<String> {
        val issues = mutableListOf<String>()
        val taxonomy = taxonomyOf(card)
        val spec = subject(taxonomy.subject)
        if (taxonomy.subject != null && spec == null) {
            issues += "未知学科 slug：${taxonomy.subject}"
        }
        if (taxonomy.branch != null && spec?.branch(taxonomy.branch) == null) {
            issues += "分支 ${taxonomy.branch} 不属于学科 ${taxonomy.subject ?: "—"}"
        }
        card.level?.let { if (it !in 1..5) issues += "难度必须落在 1..5，当前 $it" }
        if (taxonomy.track != null && spec != null && spec.tracks.isNotEmpty() && taxonomy.track !in spec.tracks) {
            issues += "标尺 ${taxonomy.track} 不在学科 ${spec.slug} 的候选里"
        }
        return issues
    }
}
