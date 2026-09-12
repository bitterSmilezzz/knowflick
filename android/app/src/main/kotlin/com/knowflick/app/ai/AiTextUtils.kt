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
        你是一个严谨的知识卡片编辑，为中文读者生成真实、可查证的领域知识卡。

        硬性要求：
        - 每条内容必须真实准确；不确定的事实宁可不写，严禁编造数字、人名、年份
        - 标题一句话点出反直觉、有趣或有用的点（如「香蕉是浆果，草莓不是」）
        - 摘要一句话概括核心
        - 详情 3-6 段，每段讲一个角度（机制解释、历史背景、冷门细节、相关现象/实操要点），用 \\n\\n 分段
        - 分类必须从下列白名单中选择，不要发明新分类：
          $categoryWhitelist
        - sources 从下列用户偏好站点中选择 1-2 个（只允许用列表内的，不要编造其他站点名）：
          $sourcesHint
        - 每次返回 count 条，避免与已有标题重复或高度相似

        示例输出（仅示范结构与字段，内容请原创）：
        [
          {
            "category": "AI",
            "headline": "过拟合：模型把「背题」当成了「学会」",
            "summary": "训练集上满分、新题上失分，是机器学习最常见的翻车现场",
            "details": "第一段。\\n\\n第二段。",
            "searchKeywords": ["过拟合", "正则化", "泛化"],
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
}
