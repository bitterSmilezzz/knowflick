import Foundation

/// 追问对话洞见沉淀与智能衍生引擎：
/// 1. 将 AI 追问的高价值回复一键提纯并沉淀为全新的首等知识卡片（KnowledgeCard）；
/// 2. 导出完整会话为格式优雅的 Markdown 笔记，便于同步至 Obsidian / Notion；
/// 3. 基于当前对话语境动态推演苏格拉底式追问建议（Follow-up Suggestions）。
public enum CardChatInsightDeriver: Sendable {

    // MARK: - 1. 洞见沉淀为知识卡片

    /// 从助手回复文本与父卡片上下文中，智能提纯生成全新的知识卡片
    public static func deriveCard(from content: String, parentCard: KnowledgeCard) -> KnowledgeCard {
        let trimmedContent = content.trimmingCharacters(in: .whitespacesAndNewlines)
        let lines = trimmedContent.components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        // 1. 智能提取标题
        let headline = extractHeadline(lines: lines, parentHeadline: parentCard.headline)

        // 2. 智能提取核心摘要（首个核心段落或前 70 字符）
        let summary = extractSummary(lines: lines, fallbackHeadline: headline)

        // 3. 继承并丰富检索链接
        let derivedLinks = parentCard.links

        return KnowledgeCard(
            category: parentCard.category,
            headline: headline,
            summary: summary,
            details: trimmedContent,
            links: derivedLinks,
            source: .ai,
            createdAt: Date()
        )
    }

    private static func extractHeadline(lines: [String], parentHeadline: String) -> String {
        for line in lines.prefix(3) {
            var candidate = line
            // 去除 Markdown 标题符 (#, ##) 或强调符 (**, __, 【】)
            if candidate.hasPrefix("#") {
                candidate = candidate.drop(while: { $0 == "#" || $0 == " " }).trimmingCharacters(in: .whitespaces)
            }
            if candidate.hasPrefix("**") && candidate.hasSuffix("**") && candidate.count > 4 {
                candidate = String(candidate.dropFirst(2).dropLast(2)).trimmingCharacters(in: .whitespaces)
            }
            if candidate.hasPrefix("【") && candidate.contains("】") {
                if let endIdx = candidate.firstIndex(of: "】") {
                    let inside = String(candidate[candidate.index(after: candidate.startIndex)..<endIdx])
                    if inside.count >= 4 && inside.count <= 35 {
                        return inside
                    }
                }
            }

            // 检查 candidate 长度是否适合作为标题（6-36 字符，无过多句号）
            let clean = candidate.trimmingCharacters(in: CharacterSet(charactersIn: "：: -*•"))
            if clean.count >= 6 && clean.count <= 36 && !clean.contains("。") {
                return clean
            }

            // 截取第一句完整断句（句号或冒号）
            if let sepIndex = clean.firstIndex(where: { $0 == "。" || $0 == "！" || $0 == "？" || $0 == "：" }) {
                let firstSentence = String(clean[..<sepIndex]).trimmingCharacters(in: .whitespaces)
                if firstSentence.count >= 6 && firstSentence.count <= 35 {
                    return firstSentence
                }
            }
        }

        // 兜底：基于父卡片标题延伸
        return "《\(parentHeadline)》追问洞见"
    }

    private static func extractSummary(lines: [String], fallbackHeadline: String) -> String {
        for line in lines {
            let clean = line.trimmingCharacters(in: CharacterSet(charactersIn: "#*-• \t"))
            if clean.isEmpty || clean == fallbackHeadline { continue }
            if clean.count >= 12 {
                if clean.count <= 80 {
                    return clean
                }
                // 截取到首个句号
                if let period = clean.firstIndex(of: "。") {
                    let sub = String(clean[...period])
                    if sub.count >= 12 && sub.count <= 80 {
                        return sub
                    }
                }
                return String(clean.prefix(75)) + "..."
            }
        }
        return fallbackHeadline
    }

    // MARK: - 2. 导出 Markdown 笔记

    /// 将整场对话导出为结构清晰、排版优雅的 Markdown 文档
    public static func exportMarkdown(session: CardChatSession, parentCard: KnowledgeCard) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        let exportTime = formatter.string(from: Date())

        var md = """
        # 《\(parentCard.headline)》AI 伴学追问记录

        - **所属分类**：\(parentCard.category)
        - **核心摘要**：\(parentCard.summary)
        - **导出时间**：\(exportTime)
        - **对话轮次**：\(session.messages.count) 条消息

        ---

        """

        for msg in session.messages {
            let roleHeader = msg.sender == .user ? "### 🙋 你" : "### 🤖 KnowFlick 伴学导师"
            md += "\n\(roleHeader)\n\n\(msg.content)\n"
        }

        md += "\n---\n*由 KnowFlick 智能伴学系统自动导出*\n"
        return md
    }

    // MARK: - 3. 动态启发式追问建议 (Follow-up Suggestions)

    /// 基于助手最新回复与父卡片领域，动态推演 3 条苏格拉底式启发追问
    public static func suggestFollowUps(for lastAssistantContent: String, parentCard: KnowledgeCard) -> [String] {
        let text = lastAssistantContent.lowercased()

        if text.contains("实验") || text.contains("论文") || text.contains("研究") || text.contains("发现") || text.contains("历史") {
            return [
                "🔬 展开讲讲这项实验的具体控制变量与验证过程",
                "💡 该结论在提出初期曾遭遇过哪些学术质疑或争议？",
                "⚙️ 这一原理后来是如何在现代工业或现实中落地的？"
            ]
        }

        if text.contains("机理") || text.contains("原理") || text.contains("算法") || text.contains("数学") || text.contains("物理") || text.contains("结构") {
            return [
                "🌐 能否用一个更贴近生活的情境比喻深入阐述底层机制？",
                "⚡ 在极限状态或特殊边界条件下，它会产生什么反常现象？",
                "🛠️ 如果想要在日常或工程中应用该原理，核心瓶颈是什么？"
            ]
        }

        if text.contains("应用") || text.contains("工业") || text.contains("系统") || text.contains("现实") || text.contains("案例") {
            return [
                "⚠️ 该方案在实际运作中有哪些潜在的缺陷或不可忽视的代价？",
                "⚖️ 业界存在哪些与它理念相对立的竞争方案？",
                "🔮 未来 3-5 年内，该方向最可能迎来的突破点是什么？"
            ]
        }

        // 通用深度启发式建议
        return [
            "🔍 展开讲讲这个概念最反直觉或最容易被大众误解的一面",
            "⚡ 要让这个结论成立，必须满足哪些严苛的前置边界条件？",
            "💡 它与哪些其他学科领域存在意想不到的交叉与协同？"
        ]
    }
}
