package com.knowflick.app.ai

import com.knowflick.app.domain.ScienceLink
import kotlin.math.abs

/** AI 生成文本工具：标题归一化/近重复抑制/检索链接/提示词（口径与 macOS AIService 对齐） */
object AiTextUtils {

    /** 近重复阈值：同知识强改写 ~0.3-0.5；不同知识点随机标题 <0.15 */
    const val NEAR_DUPLICATE_THRESHOLD = 0.35

    /** 标题归一化：去空白/标点差异后比较 */
    fun normalizeHeadline(text: String): String = text.lowercase().filter { ch ->
        !ch.isWhitespace() && ch !in "，。！？「」"
    }

    /** bigram 集合（按字符对） */
    fun bigramSet(text: String): Set<String> {
        val chars = text.filter { !it.isWhitespace() }
        if (chars.length < 2) return if (chars.isEmpty()) emptySet() else setOf(chars)
        return (0 until chars.length - 1).map { chars.substring(it, it + 2) }.toSet()
    }

    /** Jaccard 相似度：交/并 */
    fun jaccard(a: Set<String>, b: Set<String>): Double {
        if (a.isEmpty() && b.isEmpty()) return 0.0
        val intersection = a.intersect(b).size
        val union = a.union(b).size
        return if (union == 0) 0.0 else intersection.toDouble() / union
    }

    /** 构造真实可用的科普检索链接（避免幻觉 URL）：AI 给的来源优先，用户站点偏好兜底 */
    fun buildSearchLinks(keywords: List<String>, preferred: List<String>, aiSources: List<String>): List<ScienceLink> {
        val source = aiSources.firstOrNull() ?: preferred.firstOrNull() ?: ""
        return keywords.take(3).map { kw ->
            val query = if (source.isBlank()) kw else "$kw $source"
            ScienceLink(
                title = if (source.isBlank()) "搜索：$kw" else "搜索：$query",
                url = "https://www.bing.com/search?q=" + java.net.URLEncoder.encode(query, "UTF-8"),
            )
        }
    }

    /** 生成系统提示词（分类白名单/内容方向/信源偏好，与批次无关） */
    fun cardSystemPrompt(categoryWhitelist: String, sourcesHint: String): String = """
        你是一位知识架构师与资深科学编辑，致力于为中文读者创作高认知密度、真实可查证且富有洞见的「KnowFlick 知识卡片」。

        【标题设计准则】
        - 标题是一张卡片的灵魂：必须一句话点出反直觉事实、颠覆性认知或核心矛盾（如「过拟合：模型把背题当成了学会」「香蕉是浆果，草莓却不是」）；
        - 严禁空泛、教科书式的学术绪论标题（坚决杜绝「XX 的基本原理」「浅析 XX」「XX 概述与应用」等平庸写法）。

        【正文三段式递进结构】
        正文（details）必须为 3 到 5 个自然段，用 \n\n 分隔，各段逻辑清晰递进：
        1. 【本质机理解构】：用极精炼且通俗形象的语言，讲透背后的物理、数学、生理或运转底层机理；
        2. 【颠覆常识/关键证据】：讲述最具戏剧性或颠覆认知的实验证据、历史转折或冷门惊奇细节；
        3. 【现实映射与应用】：讲明该原理在现代前沿科技、工程系统或日常认知中的深刻映射。
        - 严禁任何 AI 套话废话（坚决禁止「总而言之」「综上所述」「值得一提的是」「不可否认」等口癖）。

        【硬性字段约束】
        - 分类必须从下列白名单中选择，严禁自造分类：
          $categoryWhitelist
        - sources：从下列推荐站点中选择 1-2 个权威站点（仅限列表内知名信源，严禁编造虚假 URL）：
          $sourcesHint
        - searchKeywords：必须给出 2-3 个精准专有名词（如 ["量子退相干", "薛定谔猫态"]），便于读者延伸检索；
        - 每条内容必须严格真实准确，不确定事实宁可不写，严禁虚构年份、数据或人名。

        示例输出（仅示范结构与字段规范）：
        [
          {
            "category": "AI",
            "headline": "过拟合：模型把「背题」当成了「学会」",
            "summary": "训练集上满分、新题上翻车，是机器学习最经典的认知陷阱。",
            "details": "模型学习的本质不是记忆答案，而是在高维参数空间中拟合规律。当模型容量过大而样本不足时，它会把训练集中的随机噪声当成普遍规律死记硬背。\n\n在人脸识别早期实验中，模型曾准确区分了雪地上的哈士奇与丛林中的狼。研究人员后来发现，模型根本没有识别人脸特征，而是仅仅学会了「背景有雪就是哈士奇」——这就是经典的过拟合悲剧。\n\n现实工业界中，引入 Dropout（随机失活神经元）与 L2 正则化就如同强迫学生闭卷答题，能有效打破对特定特征的过度依赖，逼迫网络学会真正的泛化表征。",
            "searchKeywords": ["过拟合", "泛化能力", "正则化"],
            "sources": ["维基百科"]
          }
        ]
    """.trimIndent()

    /** 单批用户提示词 */
    fun cardUserPrompt(
        batchCount: Int,
        topic: String?,
        excludeList: List<String>,
        categoryFilter: String,
    ): String {
        val topicHint = topic?.trim()?.takeIf { it.isNotEmpty() }?.let {
            "本次必须围绕主题「$it」生成，所有卡片都要与该主题直接相关；\n若该主题超出白名单分类范围，请选择最贴近的一个白名单分类，不要发明新分类。"
        } ?: ""
        return """
        请生成 $batchCount 条不重复的领域知识卡片，严格按 JSON 数组格式输出，不要输出任何其他文字：
        [
          {
            "category": "分类（白名单内）",
            "headline": "标题",
            "summary": "一句话摘要",
            "details": "详情（多段，用 \n\n 分隔）",
            "searchKeywords": ["关键词1", "关键词2", "关键词3"],
            "sources": ["权威来源站名1"]
          }
        ]

        $topicHint

        已存在标题（避免重复或高度相似）：
        ${excludeList.joinToString("\n")}

        若偏好某分类请优先该分类：${categoryFilter.ifBlank { "不限" }}
        """
    }

    /**
     * 外部材料（网页剪藏、粘贴的笔记）提炼提示词。
     *
     * 与 mac 端 `CardImportEngine.buildAITransformPrompt` 逐字一致——这份提示词决定
     * 了产出的 JSON 形状与质量门槛（30 字标题 / 60 字摘要 / 200–500 字机理），
     * 两端文案不同会让同一条链接在手机与桌面上提炼出不同数量的卡片。
     */
    fun transformPrompt(noteContent: String): String = """
        你是一位知识提炼专家。请将用户提供的以下笔记或文章内容，深度解构并提炼为 1 到 5 张高品质的「KnowFlick 知识闪卡」。

        【提炼设计准则】
        1. 必须提炼为符合以下 JSON 结构的卡片数组，仅输出 JSON，不要任何多余解释；
        2. category: 精准学科分类（如：物理、计算机、心理学、经济学、生物学、历史、哲学、医学等）；
        3. headline: 一句话反常识/颠覆认知/核心命题标题（例如：「过拟合：模型把背题当成了学会」），不超过 30 字；
        4. summary: 卡片正面摘要，提炼核心论点，不超过 60 字；
        5. details: 卡片深度机理解剖（200-500字，用通俗生动语言讲解背后深层原理或机制）；
        6. searchKeywords: 2-3 个核心学术关键词（如 ["热力学第三定律", "绝对零度"]）；
        7. sources: 1-2 个推荐参考权威来源（如 ["维基百科", "Nature"]）。

        【输出 JSON 示例】
        [
          {
            "category": "物理",
            "headline": "绝对零度永远无法真正达到",
            "summary": "-273.15°C之下没有静止，粒子仍有零点能量。",
            "details": "根据量子力学不确定性原理与热力学第三定律...",
            "searchKeywords": ["热力学第三定律", "绝对零度"],
            "sources": ["维基百科"]
          }
        ]

        【用户笔记原文】
        ${noteContent.take(MAX_TRANSFORM_NOTE_CHARACTERS)}
    """.trimIndent()

    /** 与 mac 端提示词里的 `prefix(4000)` 同一预算 */
    const val MAX_TRANSFORM_NOTE_CHARACTERS = 4_000
}
