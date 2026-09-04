import Foundation

/// 与 OpenAI 兼容的 Chat Completions API 客户端
/// 默认对接 DeepSeek，可在设置里改 baseURL / model
struct AIService {
    // MARK: - 生成知识卡片

    struct AICardPayload: Decodable {
        let category: String
        let headline: String
        let summary: String
        let details: String
        let searchKeywords: [String]   // 用于构造科普链接
    }

    /// 请求 AI 生成 count 张知识卡，排除已有标题避免重复
    func generateCards(
        settings: AISettings,
        count: Int,
        excludeHeadlines: [String]
    ) async throws -> [KnowledgeCard] {
        guard !settings.apiKey.isEmpty else {
            throw AIError.missingKey
        }
        guard !settings.baseURL.isEmpty else {
            throw AIError.badRequest("baseURL 为空")
        }

        let systemPrompt = """
        你是一个知识卡片编辑。生成有趣、准确、有深度的冷知识卡片，面向中文读者。
        要求：
        - 每条知识必须真实可查证，严禁编造事实、数字、人名
        - 标题一句话点出反直觉或有趣的点，如「香蕉是浆果，草莓不是」
        - 摘要一句话概括核心
        - 详情 3-6 段，每段讲一个角度（机制解释、历史背景、冷门细节、相关现象），用 \\n\\n 分段
        - 给出 2-4 个建议搜索关键词，方便读者深入查证（不用给链接，给关键词即可）
        - 分类用中文短词：物理、生物、历史、数学、化学、天文、心理、语言、科技、生活、地理、脑科学等
        - 每次返回 count 条，避免与已有标题重复
        """

        let userPrompt = """
        请生成 \(count) 条不重复的冷知识卡片，严格按 JSON 数组格式输出，不要输出任何其他文字：
        [
          {
            "category": "分类",
            "headline": "标题",
            "summary": "一句话摘要",
            "details": "详情（多段，用 \\n\\n 分隔）",
            "searchKeywords": ["关键词1", "关键词2", "关键词3"]
          }
        ]

        已存在标题（避免重复）：
        \(excludeHeadlines.prefix(100).joined(separator: "\n"))

        若偏好某分类请优先该分类：\(settings.categoryFilter.isEmpty ? "不限" : settings.categoryFilter)
        """

        let messages: [[String: String]] = [
            ["role": "system", "content": systemPrompt],
            ["role": "user", "content": userPrompt]
        ]

        let raw = try await chatCompletionWithRetry(messages: messages, settings: settings)

        // 解析 JSON（AI 可能包 ```json 代码块，先清理）
        let cleaned = cleanJSON(from: raw)
        guard let data = cleaned.data(using: .utf8) else { throw AIError.parse("无法编码响应") }
        let payloads: [AICardPayload] = try Self.parsePayloads(data)

        let now = Date()
        // 去重：跳过与已有标题重复/内容过短的卡片
        let excluded = Set(excludeHeadlines.map(Self.normalizeHeadline))
        var seen = Set<String>()
        return payloads.compactMap { p in
            let key = Self.normalizeHeadline(p.headline)
            guard !key.isEmpty, !excluded.contains(key), seen.insert(key).inserted else { return nil }
            guard p.details.count >= 80 else { return nil }   // 内容过短视为失败输出
            return KnowledgeCard(
                category: p.category,
                headline: p.headline,
                summary: p.summary,
                details: p.details,
                links: Self.buildSearchLinks(keywords: p.searchKeywords),
                source: .ai,
                createdAt: now
            )
        }
    }

    /// 解析 AI 返回的卡片数组；整体解析失败时逐对象提取，尽量挽回部分结果
    static func parsePayloads(_ data: Data) throws -> [AICardPayload] {
        let decoder = JSONDecoder()
        if let arr = try? decoder.decode([AICardPayload].self, from: data), !arr.isEmpty {
            return arr
        }
        if let single = try? decoder.decode(AICardPayload.self, from: data) {
            return [single]
        }
        // 逐对象扫描（AI 输出常见：数组里混入非法字段/尾逗号）
        guard let raw = String(data: data, encoding: .utf8) else { throw AIError.parse("无法编码响应") }
        var results: [AICardPayload] = []
        var depth = 0
        var start = raw.startIndex
        var inString = false
        var escape = false
        var i = raw.startIndex
        while i < raw.endIndex {
            let ch = raw[i]
            if escape { escape = false }
            else if ch == "\\" && inString { escape = true }
            else if ch == "\"" { inString.toggle() }
            else if !inString {
                if ch == "{" {
                    if depth == 0 { start = i }
                    depth += 1
                } else if ch == "}" {
                    depth -= 1
                    if depth == 0 {
                        let objText = String(raw[start...i])
                        if let objData = objText.data(using: .utf8),
                           let obj = try? decoder.decode(AICardPayload.self, from: objData) {
                            results.append(obj)
                        }
                    }
                }
            }
            i = raw.index(after: i)
        }
        if results.isEmpty { throw AIError.parse("AI 返回格式无法解析") }
        return results
    }

    /// 标题归一化：去空白/标点差异后比较
    static func normalizeHeadline(_ s: String) -> String {
        s.lowercased()
            .filter { !$0.isWhitespace && $0 != "，" && $0 != "。" && $0 != "！" && $0 != "？" && $0 != "「" && $0 != "」" }
    }

    /// 网络调用：429/5xx 自动重试（最多 2 次，指数退避）
    private func chatCompletionWithRetry(messages: [[String: String]], settings: AISettings) async throws -> String {
        var lastError: Error = AIError.network("未知错误")
        for attempt in 0..<3 {
            do {
                return try await chatCompletion(messages: messages, settings: settings)
            } catch let e as AIError {
                guard case let .httpStatus(code, _) = e, code == 429 || (500...599).contains(code), attempt < 2 else {
                    throw e
                }
                lastError = e
                try? await Task.sleep(for: .seconds(pow(2.0, Double(attempt))))
            } catch {
                lastError = error
                throw error
            }
        }
        throw lastError
    }

    // MARK: - 基础调用

    private func chatCompletion(messages: [[String: String]], settings: AISettings) async throws -> String {
        var urlString = settings.baseURL
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if urlString.hasSuffix("/v1") {
            urlString += "/chat/completions"
        } else {
            urlString += "/v1/chat/completions"
        }
        guard let url = URL(string: urlString) else { throw AIError.badRequest("URL 无效: \(urlString)") }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 60
        request.setValue("Bearer \(settings.apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "model": settings.model,
            "messages": messages,
            "temperature": 1.0,
            "max_tokens": 4000,
            "stream": false
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AIError.network("无响应") }

        guard (200..<300).contains(http.statusCode) else {
            let msg = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
            throw AIError.httpStatus(http.statusCode, msg)
        }

        struct ChatResponse: Decodable {
            struct Choice: Decodable {
                struct Message: Decodable { let content: String }
                let message: Message
            }
            let choices: [Choice]
        }

        do {
            let parsed = try JSONDecoder().decode(ChatResponse.self, from: data)
            return parsed.choices.first?.message.content ?? ""
        } catch {
            throw AIError.parse("响应解析失败")
        }
    }

    // MARK: - 工具

    /// 把关键词构造成真实可用的科普检索链接（避免幻觉 URL）
    static func buildSearchLinks(keywords: [String]) -> [ScienceLink] {
        keywords.prefix(3).map { kw in
            let encoded = kw.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? kw
            return ScienceLink(
                title: "搜索：\(kw)",
                url: "https://www.bing.com/search?q=\(encoded)"
            )
        }
    }

    /// 清理 AI 输出里的 ```json 代码块包裹
    private func cleanJSON(from raw: String) -> String {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.hasPrefix("```") {
            text = text.replacingOccurrences(of: "^```(?:json)?\\s*", with: "", options: .regularExpression)
            text = text.replacingOccurrences(of: "\\s*```$", with: "", options: .regularExpression)
        }
        return text
    }
}

enum AIError: LocalizedError {
    case missingKey
    case badRequest(String)
    case network(String)
    case httpStatus(Int, String)
    case parse(String)

    var errorDescription: String? {
        switch self {
        case .missingKey: "未配置 API Key，请到设置里填写"
        case .badRequest(let s): "请求参数错误：\(s)"
        case .network(let s): "网络错误：\(s)"
        case .httpStatus(let c, let m): "API 返回 \(c)：\(String(m.prefix(200)))"
        case .parse(let s): "解析失败：\(s)"
        }
    }
}
