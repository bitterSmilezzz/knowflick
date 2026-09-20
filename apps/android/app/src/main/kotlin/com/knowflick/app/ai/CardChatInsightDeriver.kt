package com.knowflick.app.ai

import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

/**
 * 追问对话洞见沉淀与智能衍生引擎（对齐 macOS CardChatInsightDeriver）：
 * 1. 将 AI 追问的高价值回复一键提纯并沉淀为全新的首等知识卡片（KnowledgeCard）；
 * 2. 导出完整会话为格式优雅的 Markdown 笔记，便于同步至 Obsidian / Notion；
 * 3. 基于当前对话语境动态推演苏格拉底式追问建议（Follow-up Suggestions）。
 */
object CardChatInsightDeriver {

    // MARK: - 1. 洞见沉淀为知识卡片

    /** 从助手回复文本与父卡片上下文中，智能提纯生成全新的知识卡片 */
    fun deriveCard(content: String, parentCard: KnowledgeCard): KnowledgeCard {
        val trimmedContent = content.trim()
        val lines = trimmedContent.lines().map { it.trim() }.filter { it.isNotEmpty() }

        // 1. 智能提取标题
        val headline = extractHeadline(lines, parentCard.headline)

        // 2. 智能提取核心摘要
        val summary = extractSummary(lines, headline)

        return KnowledgeCard(
            id = UUID.randomUUID().toString(),
            category = parentCard.category,
            headline = headline,
            summary = summary,
            details = trimmedContent,
            links = parentCard.links,
            source = CardSource.AI,
            createdAt = System.currentTimeMillis(),
        )
    }

    private fun extractHeadline(lines: List<String>, parentHeadline: String): String {
        for (line in lines.take(3)) {
            var candidate = line
            // 去除 Markdown 标题符 (#, ##) 或强调符 (**, __, 【】)
            if (candidate.startsWith("#")) {
                candidate = candidate.dropWhile { it == '#' || it == ' ' }.trim()
            }
            if (candidate.startsWith("**") && candidate.endsWith("**") && candidate.length > 4) {
                candidate = candidate.removeSurrounding("**").trim()
            }
            if (candidate.startsWith("【") && candidate.contains("】")) {
                val inside = candidate.substringAfter("【").substringBefore("】").trim()
                if (inside.length in 4..35) {
                    return inside
                }
            }

            // 检查 candidate 长度是否适合作为标题（6-36 字符，无句号）
            val clean = candidate.trim('：', ':', ' ', '-', '*', '•')
            if (clean.length in 6..36 && !clean.contains("。")) {
                return clean
            }

            // 截取第一句完整断句（句号或冒号）
            val sepIndex = clean.indexOfAny(charArrayOf('。', '！', '？', '：'))
            if (sepIndex >= 0) {
                val firstSentence = clean.substring(0, sepIndex).trim()
                if (firstSentence.length in 6..35) {
                    return firstSentence
                }
            }
        }

        // 兜底：基于父卡片标题延伸
        return "《$parentHeadline》追问洞见"
    }

    private fun extractSummary(lines: List<String>, fallbackHeadline: String): String {
        for (line in lines) {
            val clean = line.trim('#', '*', '-', '•', ' ', '\t')
            if (clean.isEmpty() || clean == fallbackHeadline) continue
            if (clean.length >= 12) {
                if (clean.length <= 80) {
                    return clean
                }
                val period = clean.indexOf('。')
                if (period >= 0) {
                    val sub = clean.substring(0, period + 1)
                    if (sub.length in 12..80) {
                        return sub
                    }
                }
                return clean.take(75) + "..."
            }
        }
        return fallbackHeadline
    }

    // MARK: - 2. 导出 Markdown 笔记

    /** 将整场对话导出为结构清晰、排版优雅的 Markdown 文档 */
    fun exportMarkdown(session: CardChatSession, parentCard: KnowledgeCard): String {
        val formatter = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.CHINESE)
        val exportTime = formatter.format(Date())

        val sb = StringBuilder()
        sb.append("# 《${parentCard.headline}》AI 伴学追问记录\n\n")
        sb.append("- **所属分类**：${parentCard.category}\n")
        sb.append("- **核心摘要**：${parentCard.summary}\n")
        sb.append("- **导出时间**：$exportTime\n")
        sb.append("- **对话轮次**：${session.messages.size} 条消息\n\n")
        sb.append("---\n\n")

        for (msg in session.messages) {
            val roleHeader = if (msg.sender == MessageSender.USER) "### 🙋 你" else "### 🤖 KnowFlick 伴学导师"
            sb.append("$roleHeader\n\n${msg.content}\n\n")
        }

        sb.append("---\n*由 KnowFlick 智能伴学系统自动导出*\n")
        return sb.toString()
    }

    // MARK: - 3. 动态启发式追问建议 (Follow-up Suggestions)

    /** 基于助手最新回复与父卡片领域，动态推演 3 条苏格拉底式启发追问 */
    fun suggestFollowUps(lastAssistantContent: String, parentCard: KnowledgeCard): List<String> {
        val text = lastAssistantContent.lowercase(Locale.ROOT)

        if (text.contains("实验") || text.contains("论文") || text.contains("研究") || text.contains("发现") || text.contains("历史")) {
            return listOf(
                "🔬 展开讲讲这项实验的具体控制变量与验证过程",
                "💡 该结论在提出初期曾遭遇过哪些学术质疑或争议？",
                "⚙️ 这一原理后来是如何在现代工业或现实中落地的？",
            )
        }

        if (text.contains("机理") || text.contains("原理") || text.contains("算法") || text.contains("数学") || text.contains("物理") || text.contains("结构")) {
            return listOf(
                "🌐 能否用一个更贴近生活的情境比喻深入阐述底层机制？",
                "⚡ 在极限状态或特殊边界条件下，它会产生什么反常现象？",
                "🛠️ 如果想要在日常或工程中应用该原理，核心瓶颈是什么？",
            )
        }

        if (text.contains("应用") || text.contains("工业") || text.contains("系统") || text.contains("现实") || text.contains("案例")) {
            return listOf(
                "⚠️ 该方案在实际运作中有哪些潜在的缺陷或不可忽视的代价？",
                "⚖️ 业界存在哪些与它理念相对立的竞争方案？",
                "🔮 未来 3-5 年内，该方向最可能迎来的突破点是什么？",
            )
        }

        // 通用深度启发式建议
        return listOf(
            "🔍 展开讲讲这个概念最反直觉或最容易被大众误解的一面",
            "⚡ 要让这个结论成立，必须满足哪些严苛的前置边界条件？",
            "💡 它与哪些其他学科领域存在意想不到的交叉与协同？",
        )
    }
}
