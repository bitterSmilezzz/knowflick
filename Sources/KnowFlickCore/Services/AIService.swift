import Foundation

/// 与 OpenAI 兼容的 Chat Completions API 客户端
/// 默认对接 DeepSeek，可在设置里改 baseURL / model
public struct AIService {
    private let session: URLSession

    init(session: URLSession = .shared) { self.session = session }

    /// 保留服务商的自定义 API 前缀，只有裸域名才补 /v1。
    static func completionURL(baseURL: String) throws -> URL {
        let raw = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var parts = URLComponents(string: raw),
              ["https", "http"].contains(parts.scheme?.lowercased() ?? ""),
              let host = parts.host, !host.isEmpty,
              parts.query == nil, parts.fragment == nil else {
            throw AIError.badRequest("请输入有效的 HTTP(S) API Base URL")
        }
        var path = parts.path
        while path.hasSuffix("/") { path.removeLast() }
        if !path.hasSuffix("/chat/completions") {
            path += path.isEmpty ? "/v1/chat/completions" : "/chat/completions"
        }
        parts.path = path
        guard let url = parts.url else { throw AIError.badRequest("URL 无效") }
        return url
    }

    private func makeRequest(settings: AISettings, timeout: TimeInterval) throws -> URLRequest {
        let key = settings.apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !settings.requiresAPIKey || !key.isEmpty else { throw AIError.missingKey }
        guard !settings.model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw AIError.badRequest("model 为空")
        }
        var request = URLRequest(url: try Self.completionURL(baseURL: settings.baseURL))
        request.httpMethod = "POST"
        request.timeoutInterval = timeout
        if !key.isEmpty { request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization") }
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }

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
    /// - Parameter topic: 可选主题，非空时围绕该主题生成（全局搜索「围绕关键词生成」入口使用）
    /// - 传输/解析层失败抛 `AIError`；请求成功但无可用产出抛 `AIError.noUsableCards`
    public func generateCards(
        settings: AISettings,
        count: Int,
        excludeHeadlines: [String],
        topic: String? = nil
    ) async throws -> [KnowledgeCard] {
        guard !settings.requiresAPIKey || !settings.apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw AIError.missingKey
        }
        guard !settings.baseURL.isEmpty else {
            throw AIError.badRequest("baseURL 为空")
        }
        guard (1...20).contains(count) else { throw AIError.badRequest("生成数量须为 1–20") }
        // 排除标题上限收敛在服务单点，调用方传全量即可（避免决策分裂）
        let excludeList = Array(excludeHeadlines.prefix(100))
        let excludedKeys = Set(excludeHeadlines.map(Self.normalizeHeadline))
        let excludedBigrams = excludeHeadlines.map(Self.bigramSet)
        // 用户配置的 AI 引用站点偏好（生成内容与检索链接都优先这些站点）
        let preferredSources = settings.preferredSources
        let sourcesHint = preferredSources.isEmpty
            ? "维基百科、国家地理、NASA 等权威科普站点"
            : preferredSources.joined(separator: "、")
        // 分类体系：内置「冷知识」+ 自定义分类；生成时只允许这些分类名
        let categoryWhitelist = settings.allCategoryNames.joined(separator: "、")
        // 每类内容方向（自定义分类的描述，让生成内容贴合该分类主题）
        let categoryGuides = settings.customCategories
            .map { "分类「\($0.name)」的内容方向：\($0.description)。" }
            .joined(separator: "\n")
        // 无偏好时要求平均覆盖自定义分类，避免全部落到冷知识
        let customHint = settings.customCategories.isEmpty
            ? ""
            : "若没有偏好分类，请尽量平均覆盖以下分类：\(settings.customCategoryNames.joined(separator: "、"))。"

        let systemPrompt = """
        你是一个严谨的知识卡片编辑，为中文读者生成真实、可查证的领域知识卡。

        硬性要求：
        - 每条内容必须真实准确；不确定的事实宁可不写，严禁编造数字、人名、年份
        - 标题一句话点出反直觉、有趣或有用的点（如「香蕉是浆果，草莓不是」）
        - 摘要一句话概括核心
        - 详情 3-6 段，每段讲一个角度（机制解释、历史背景、冷门细节、相关现象/实操要点），用 \\n\\n 分段
        - 分类必须从下列白名单中选择，不要发明新分类：
          \(categoryWhitelist)
        \(categoryGuides)
        - sources 从下列用户偏好站点中选择 1-2 个（只允许用列表内的，不要编造其他站点名）：
          \(sourcesHint)
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
        """

        let trimmedTopic = topic?.trimmingCharacters(in: .whitespacesAndNewlines)
        let topicHint: String
        if let trimmedTopic, !trimmedTopic.isEmpty {
            topicHint = """
            本次必须围绕主题「\(trimmedTopic)」生成，所有卡片都要与该主题直接相关；
            若该主题超出白名单分类范围，请选择最贴近的一个白名单分类，不要发明新分类。
            """
        } else {
            topicHint = ""
        }

        let userPrompt = """
        请生成 \(count) 条不重复的领域知识卡片，严格按 JSON 数组格式输出，不要输出任何其他文字：
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

        \(topicHint)

        \(customHint)

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
            guard p.details.count >= 80 else { return nil }
            let key = Self.normalizeHeadline(p.headline)
            let bigram = Self.bigramSet(p.headline)
            guard !key.isEmpty, !excludedKeys.contains(key), seenKeys.insert(key).inserted else { return nil }
            guard !excludedBigrams.contains(where: { Self.jaccard(bigram, $0) > Self.nearDuplicateThreshold }) else { return nil }
            guard !seenBigrams.contains(where: { Self.jaccard(bigram, $0) > Self.nearDuplicateThreshold }) else { return nil }
            seenBigrams.append(bigram)
            return KnowledgeCard(
                category: CategoryRegistry.normalize(p.category, custom: settings.customCategoryNames),   // 归一化到分类体系
                headline: p.headline,
                summary: p.summary,
                details: p.details,
                // 链接：AI 给了站点用 AI 的；没给则用用户站点偏好兜底
                links: Self.buildSearchLinks(
                    keywords: p.searchKeywords,
                    sources: p.sources.isEmpty ? preferredSources : p.sources
                ),
                source: .ai,
                createdAt: now
            )
        }
        // 「请求成功但无可用产出」是一等语义，不再用空数组当第二失败通道
        guard !cards.isEmpty else { throw AIError.noUsableCards }
        return cards
    }

    // MARK: - 从笔记或文章智能提炼知识卡片

    public func transformNoteToCards(noteText: String, settings: AISettings) async throws -> [KnowledgeCard] {
        let trimmed = noteText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }

        let systemPrompt = "你是一位博学敏锐的知识架构师。你的任务是将用户提供的非结构化笔记、长文或书摘，提炼提纯为 1 到 5 张结构精炼、具有深刻洞察力的 KnowFlick 知识卡片，必须且仅输出标准 JSON 数组。"
        let userPrompt = CardImportEngine.buildAITransformPrompt(noteContent: trimmed)

        let messages: [[String: String]] = [
            ["role": "system", "content": systemPrompt],
            ["role": "user", "content": userPrompt]
        ]

        let payloads = try await streamPayloadsWithRetry(
            messages: messages,
            settings: settings,
            maxTokens: 3200,
            targetCount: 3
        )

        let now = Date()
        var cards: [KnowledgeCard] = []
        for p in payloads {
            let normalizedCat = CategoryRegistry.normalize(p.category, custom: settings.customCategoryNames)
            let links = Self.buildSearchLinks(keywords: p.searchKeywords, sources: p.sources)
            cards.append(KnowledgeCard(
                category: normalizedCat,
                headline: p.headline,
                summary: p.summary,
                details: p.details,
                links: links,
                source: .imported,
                createdAt: now
            ))
        }

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
                try await Task.sleep(for: .seconds(pow(2.0, Double(attempt))))
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
        var request = try makeRequest(settings: settings, timeout: 90)

        let body: [String: Any] = [
            "model": settings.model,
            "messages": messages,
            "temperature": 0.8,   // 比 1.0 更稳，减少发散
            "max_tokens": maxTokens,
            "stream": true
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        return try await { () async throws -> [AICardPayload] in
            try Task.checkCancellation()
            let (bytes, response) = try await session.bytes(for: request)
            defer { bytes.task.cancel() }
            guard let http = response as? HTTPURLResponse else { throw AIError.network("无响应") }
            guard (200..<300).contains(http.statusCode) else {
                throw AIError.httpStatus(http.statusCode, "")
            }
            var buffer = ""
            for try await line in bytes.lines {
                try Task.checkCancellation()
                if line.trimmingCharacters(in: .whitespaces) == "data: [DONE]" { break }
                guard let delta = Self.sseContentDelta(line) else { continue }
                buffer += delta
                let extracted = Self.scanObjects(in: buffer)
                if extracted.count >= targetCount {
                    return Array(extracted.prefix(targetCount))   // 够数即停
                }
            }
            // 流结束兜底：buffer 中所有完整对象
            return Self.scanObjects(in: buffer)
        }()
    }

    /// 轻量连通性探测：发一个极小请求，只验证网络/鉴权/URL 拼装，仅使用少量 token
    public func ping(settings: AISettings) async throws {
        guard !settings.requiresAPIKey || !settings.apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw AIError.missingKey }
        let messages = [["role": "user", "content": "ping"]]
        _ = try await chatCompletion(messages: messages, settings: settings, maxTokens: 1)
    }

    // MARK: - 基础调用（非流式，用于 ping）

    private func chatCompletion(messages: [[String: String]], settings: AISettings, maxTokens: Int = 4000) async throws -> String {
        var request = try makeRequest(settings: settings, timeout: 60)

        let body: [String: Any] = [
            "model": settings.model,
            "messages": messages,
            "temperature": 0.8,
            "max_tokens": maxTokens,
            "stream": false
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
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

    // MARK: - 卡片追问流式对话 (Card Follow-up Chat)

    /// 针对特定知识卡片发起多轮追问对话，返回实时流式文本生成器
    public func streamCardChat(
        card: KnowledgeCard,
        history: [CardChatMessage],
        userPrompt: String,
        settings: AISettings
    ) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                guard !settings.requiresAPIKey || !settings.apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    continuation.finish(throwing: AIError.missingKey)
                    return
                }
                guard !settings.baseURL.isEmpty else {
                    continuation.finish(throwing: AIError.badRequest("baseURL 为空"))
                    return
                }

                let systemPrompt = """
                你是一位兼具渊博学识、通透洞察与亲和力的 AI 知识导师（AI Learning Companion）。
                当前读者正在精读一张精选知识卡片，需要你针对该卡片提供更深层次的探究、机制拆解、现实案例比喻或关联启发。

                【当前卡片上下文】
                - 领域分类：\(card.category)
                - 核心观点：\(card.headline)
                - 内容摘要：\(card.summary)
                - 深度解析：
                \(card.details)
                \(card.links.isEmpty ? "" : "- 权威来源偏好：\(card.links.map(\.title).joined(separator: "、"))")

                【导师回复原则】
                1. 针对性与准确性：紧密围绕卡片内容与用户的追问展开，不讲假大空的套话，用清晰生动的逻辑讲透“为什么”与底层机理。
                2. 通俗与形象：善于使用生动的现实比喻、思想实验或工业界实战案例降低认知门槛，但保持学术严谨。
                3. 排版美感：使用优美的 Markdown 排版（适度加粗重点、使用要点列表、代码块注明语言），段落舒缓呼吸。
                4. 启发式延伸：在回答末尾，可简短抛出一个反直觉思考题或相关交叉学科延伸方向，引导读者继续探索。
                """

                var messages: [[String: String]] = [
                    ["role": "system", "content": systemPrompt]
                ]

                // 追加历史对话（限制最近 10 轮以保持上下文聚焦并省 token）
                let recentHistory = history.suffix(10)
                for msg in recentHistory {
                    switch msg.sender {
                    case .user:
                        messages.append(["role": "user", "content": msg.content])
                    case .assistant:
                        messages.append(["role": "assistant", "content": msg.content])
                    case .system:
                        break
                    }
                }

                // 追加当前追问
                messages.append(["role": "user", "content": userPrompt])

                let body: [String: Any] = [
                    "model": settings.model,
                    "messages": messages,
                    "temperature": 0.7,
                    "max_tokens": 2048,
                    "stream": true
                ]

                do {
                    var request = try makeRequest(settings: settings, timeout: 90)
                    request.httpBody = try JSONSerialization.data(withJSONObject: body)
                    try Task.checkCancellation()
                    let (bytes, response) = try await session.bytes(for: request)
                    defer { bytes.task.cancel() }
                    guard let http = response as? HTTPURLResponse else {
                        continuation.finish(throwing: AIError.network("无响应"))
                        return
                    }
                    guard (200..<300).contains(http.statusCode) else {
                        continuation.finish(throwing: AIError.httpStatus(http.statusCode, ""))
                        return
                    }

                    var receivedContent = false
                    for try await line in bytes.lines {
                        if line.trimmingCharacters(in: .whitespaces) == "data: [DONE]" { break }
                        if Task.isCancelled { break }
                        guard let delta = Self.sseContentDelta(line) else { continue }
                        if !delta.isEmpty { receivedContent = true }
                        continuation.yield(delta)
                    }
                    try Task.checkCancellation()
                    guard receivedContent else { throw AIError.parse("AI 未返回可用回复，请重试") }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }

            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }

    // MARK: - 工具

    /// 把关键词构造成真实可用的科普检索链接（避免幻觉 URL）。
    /// 若 AI 给了权威来源站名，拼入查询（"香蕉 浆果 维基百科" 比裸关键词更易命中真实页面）
    public static func buildSearchLinks(keywords: [String], sources: [String] = []) -> [ScienceLink] {
        let source = sources.first ?? ""
        return keywords.prefix(3).map { kw in
            let query = source.isEmpty ? kw : "\(kw) \(source)"
            var components = URLComponents(string: "https://www.bing.com/search")!
            components.queryItems = [URLQueryItem(name: "q", value: query)]
            return ScienceLink(
                title: source.isEmpty ? "搜索：\(kw)" : "搜索：\(query)",
                url: components.url!.absoluteString
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
