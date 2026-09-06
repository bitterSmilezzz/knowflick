import Foundation

/// 与 OpenAI 兼容的 Chat Completions API 客户端
/// 默认对接 DeepSeek，可在设置里改 baseURL / model
public struct AIService {
    // MARK: - 生成知识卡片

    public struct AICardPayload: Decodable {
        public let category: String
        public let headline: String
        public let summary: String
        public let details: String
        public let searchKeywords: [String]   // 用于构造科普链接
        public let sources: [String]          // 建议权威来源站点（1-2 个，不编造具体 URL）

        public init(category: String, headline: String, summary: String, details: String, searchKeywords: [String], sources: [String] = []) {
            self.category = category
            self.headline = headline
            self.summary = summary
            self.details = details
            self.searchKeywords = searchKeywords
            self.sources = sources
        }

        // 兼容旧响应（无 sources 字段）
        private enum CodingKeys: String, CodingKey {
            case category, headline, summary, details, searchKeywords, sources
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            category = try c.decode(String.self, forKey: .category)
            headline = try c.decode(String.self, forKey: .headline)
            summary = try c.decode(String.self, forKey: .summary)
            details = try c.decode(String.self, forKey: .details)
            searchKeywords = try c.decodeIfPresent([String].self, forKey: .searchKeywords) ?? []
            sources = try c.decodeIfPresent([String].self, forKey: .sources) ?? []
        }
    }

    /// 请求 AI 生成 count 张知识卡：流式接收，够数即停；排除已有标题（字面 + 近重复）
    /// - 传输/解析层失败抛 `AIError`；请求成功但无可用产出抛 `AIError.noUsableCards`
    public func generateCards(
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
        // 排除标题上限收敛在服务单点，调用方传全量即可（避免决策分裂）
        let excludeList = Array(excludeHeadlines.prefix(100))
        let excludedKeys = Set(excludeList.map(Self.normalizeHeadline))
        let excludedBigrams = excludeList.map(Self.bigramSet)

        let systemPrompt = """
        你是一个严谨的知识卡片编辑，为中文读者生成真实、可查证的冷知识。

        硬性要求：
        - 每条知识必须真实可查证；不确定的事实宁可不写，严禁编造数字、人名、年份
        - 标题一句话点出反直觉或有趣的点，如「香蕉是浆果，草莓不是」
        - 摘要一句话概括核心
        - 详情 3-6 段，每段讲一个角度（机制解释、历史背景、冷门细节、相关现象），用 \\n\\n 分段
        - 分类必须从下列白名单中选择，不要发明新分类：
          物理、生物、天文、数学、化学、历史、心理、脑科学、语言、科技、生活、地理、AI、算法、数据结构、架构、Rust、Python、编程、会计、学习方法
        - sources 给出 1-2 个权威来源站点名（如：维基百科、NASA、国家地理、Nature、BBC、中国科普网、果壳网），不要编造具体文章 URL
        - 每次返回 count 条，避免与已有标题重复或高度相似

        示例输出（仅示范结构与字段，内容请原创）：
        [
          {
            "category": "生物",
            "headline": "香蕉是浆果，草莓不是",
            "summary": "植物学定义下，浆果来自单一子房且果皮肉质化",
            "details": "第一段。\\n\\n第二段。",
            "searchKeywords": ["香蕉", "浆果", "植物学分类"],
            "sources": ["维基百科"]
          }
        ]
        """

        let userPrompt = """
        请生成 \(count) 条不重复的冷知识卡片，严格按 JSON 数组格式输出，不要输出任何其他文字：
        [
          {
            "category": "分类（白名单内）",
            "headline": "标题",
            "summary": "一句话摘要",
            "details": "详情（多段，用 \\n\\n 分隔）",
            "searchKeywords": ["关键词1", "关键词2", "关键词3"],
            "sources": ["权威来源站名1"]
          }
        ]

        已存在标题（避免重复或高度相似）：
        \(excludeList.joined(separator: "\n"))

        若偏好某分类请优先该分类：\(settings.categoryFilter.isEmpty ? "不限" : settings.categoryFilter)
        """

        let messages: [[String: String]] = [
            ["role": "system", "content": systemPrompt],
            ["role": "user", "content": userPrompt]
        ]

        // 动态 max_tokens：约 900 token/张 + 400 缓冲（3 张≈3100，5 张≈4900），不再固定 4000 浪费额度
        let maxTokens = max(1200, count * 900 + 400)
        let payloads = try await streamPayloadsWithRetry(
            messages: messages,
            settings: settings,
            maxTokens: maxTokens,
            targetCount: count
        )

        let now = Date()
        // 过滤链：字面重复 → 与已有标题近重复 → 本次已选内近重复 → 内容过短
        var seenKeys = Set<String>()
        var seenBigrams: [Set<String>] = []
        let cards: [KnowledgeCard] = payloads.compactMap { p in
            let key = Self.normalizeHeadline(p.headline)
            let bigram = Self.bigramSet(p.headline)
            guard !key.isEmpty, !excludedKeys.contains(key), seenKeys.insert(key).inserted else { return nil }
            guard !excludedBigrams.contains(where: { Self.jaccard(bigram, $0) > Self.nearDuplicateThreshold }) else { return nil }
            guard !seenBigrams.contains(where: { Self.jaccard(bigram, $0) > Self.nearDuplicateThreshold }) else { return nil }
            seenBigrams.append(bigram)
            guard p.details.count >= 80 else { return nil }   // 内容过短视为失败输出
            return KnowledgeCard(
                category: CategoryRegistry.normalize(p.category),   // 分类归一化到白名单
                headline: p.headline,
                summary: p.summary,
                details: p.details,
                links: Self.buildSearchLinks(keywords: p.searchKeywords, sources: p.sources),
                source: .ai,
                createdAt: now
            )
        }
        // 「请求成功但无可用产出」是一等语义，不再用空数组当第二失败通道
        guard !cards.isEmpty else { throw AIError.noUsableCards }
        return cards
    }

    // MARK: - 响应解析

    /// 解析完整响应：整体数组 → 单对象 → 逐对象扫描挽救
    public static func parsePayloads(_ data: Data) throws -> [AICardPayload] {
        let decoder = JSONDecoder()
        if let arr = try? decoder.decode([AICardPayload].self, from: data), !arr.isEmpty {
            return arr
        }
        if let single = try? decoder.decode(AICardPayload.self, from: data) {
            return [single]
        }
        let results = scanObjects(in: String(data: data, encoding: .utf8) ?? "")
        if results.isEmpty { throw AIError.parse("AI 返回格式无法解析") }
        return results
    }

    /// 从（可能不完整的）文本中扫描出所有完整 JSON 对象并解码。
    /// 流式增量解析与坏输出挽救共用：对 `{...}` 深度扫描，不完整/非法对象跳过
    public static func scanObjects(in raw: String) -> [AICardPayload] {
        let decoder = JSONDecoder()
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
        return results
    }

    /// 解析 SSE 事件行："data: {json}" → 内容增量（兼容 delta.content 流式 / message.content 非流式字段）
    public static func sseContentDelta(_ line: String) -> String? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("data:") else { return nil }
        let payload = trimmed.dropFirst(5).trimmingCharacters(in: .whitespaces)
        guard !payload.isEmpty, payload != "[DONE]" else { return nil }
        struct SSEEvent: Decodable {
            struct Choice: Decodable {
                struct Delta: Decodable { let content: String? }
                struct Message: Decodable { let content: String? }
                let delta: Delta?
                let message: Message?
            }
            let choices: [Choice]?
        }
        guard let data = payload.data(using: .utf8),
              let event = try? JSONDecoder().decode(SSEEvent.self, from: data),
              let choice = event.choices?.first else { return nil }
        return choice.delta?.content ?? choice.message?.content
    }

    // MARK: - 标题归一化 / 近重复

    /// 标题归一化：去空白/标点差异后比较
    public static func normalizeHeadline(_ s: String) -> String {
        s.lowercased()
            .filter { !$0.isWhitespace && $0 != "，" && $0 != "。" && $0 != "！" && $0 != "？" && $0 != "「" && $0 != "」" }
    }

    /// 相似度阈值：超过即视为近重复（同知识点换说法）。
    /// 实测：同知识强改写 ~0.3-0.5；不同知识点随机标题 <0.15
    public static let nearDuplicateThreshold = 0.35

    /// 中文标题按字符 bigram 构建集合（"香蕉是浆果" → {香蕉, 蕉是, 是浆, 浆果}）
    public static func bigramSet(_ s: String) -> Set<String> {
        let chars = Array(s.lowercased().filter { !$0.isWhitespace && $0 != "，" && $0 != "。" && $0 != "！" && $0 != "？" && $0 != "「" && $0 != "」" })
        guard chars.count > 1 else { return Set(chars.map(String.init)) }
        return Set((0..<(chars.count - 1)).map { "\(chars[$0])\(chars[$0 + 1])" })
    }

    /// Jaccard 相似度
    public static func jaccard(_ a: Set<String>, _ b: Set<String>) -> Double {
        let inter = a.intersection(b).count
        let union = a.union(b).count
        return union == 0 ? 0 : Double(inter) / Double(union)
    }

    // MARK: - 流式网络调用

    /// 流式请求 + 增量提取：收到 targetCount 个完整对象即停（省时省额度），429/5xx 自动重试
    private func streamPayloadsWithRetry(
        messages: [[String: String]],
        settings: AISettings,
        maxTokens: Int,
        targetCount: Int
    ) async throws -> [AICardPayload] {
        var lastError: Error = AIError.network("未知错误")
        for attempt in 0..<3 {
            do {
                return try await streamPayloads(messages: messages, settings: settings, maxTokens: maxTokens, targetCount: targetCount)
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

    /// 单次流式请求：SSE 逐行累积，每块增量扫描；够数即停（Task 返回释放 AsyncBytes → 取消底层请求）
    private func streamPayloads(
        messages: [[String: String]],
        settings: AISettings,
        maxTokens: Int,
        targetCount: Int
    ) async throws -> [AICardPayload] {
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
        request.timeoutInterval = 90
        request.setValue("Bearer \(settings.apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "model": settings.model,
            "messages": messages,
            "temperature": 0.8,   // 比 1.0 更稳，减少发散
            "max_tokens": maxTokens,
            "stream": true
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        return try await Task { () -> [AICardPayload] in
            let (bytes, response) = try await URLSession.shared.bytes(for: request)
            guard let http = response as? HTTPURLResponse else { throw AIError.network("无响应") }
            guard (200..<300).contains(http.statusCode) else {
                throw AIError.httpStatus(http.statusCode, "")
            }
            var buffer = ""
            for try await line in bytes.lines {
                guard let delta = Self.sseContentDelta(line) else { continue }
                buffer += delta
                let extracted = Self.scanObjects(in: buffer)
                if extracted.count >= targetCount {
                    return Array(extracted.prefix(targetCount))   // 够数即停
                }
            }
            // 流结束兜底：buffer 中所有完整对象
            return Self.scanObjects(in: buffer)
        }.value
    }

    /// 轻量连通性探测：发一个极小请求，只验证网络/鉴权/URL 拼装，不消耗额度
    public func ping(settings: AISettings) async throws {
        guard !settings.apiKey.isEmpty else { throw AIError.missingKey }
        let messages = [["role": "user", "content": "ping"]]
        _ = try await chatCompletion(messages: messages, settings: settings, maxTokens: 1)
    }

    // MARK: - 基础调用（非流式，用于 ping）

    private func chatCompletion(messages: [[String: String]], settings: AISettings, maxTokens: Int = 4000) async throws -> String {
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
            "temperature": 0.8,
            "max_tokens": maxTokens,
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

    /// 把关键词构造成真实可用的科普检索链接（避免幻觉 URL）。
    /// 若 AI 给了权威来源站名，拼入查询（"香蕉 浆果 维基百科" 比裸关键词更易命中真实页面）
    public static func buildSearchLinks(keywords: [String], sources: [String] = []) -> [ScienceLink] {
        let source = sources.first ?? ""
        return keywords.prefix(3).map { kw in
            let query = source.isEmpty ? kw : "\(kw) \(source)"
            let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
            return ScienceLink(
                title: source.isEmpty ? "搜索：\(kw)" : "搜索：\(query)",
                url: "https://www.bing.com/search?q=\(encoded)"
            )
        }
    }
}

public enum AIError: LocalizedError {
    case missingKey
    case badRequest(String)
    case network(String)
    case httpStatus(Int, String)
    case parse(String)
    case noUsableCards   // 请求成功，但产出全被去重/质量过滤，没有可用新卡

    public var errorDescription: String? {
        switch self {
        case .missingKey: "未配置 API Key，请到设置里填写"
        case .badRequest(let s): "请求参数错误：\(s)"
        case .network(let s): "网络错误：\(s)"
        case .httpStatus(let c, let m): "API 返回 \(c)：\(String(m.prefix(200)))"
        case .parse(let s): "解析失败：\(s)"
        case .noUsableCards: "AI 返回的内容没有可用的新卡片（重复或内容过短），请再试一次"
        }
    }
}
