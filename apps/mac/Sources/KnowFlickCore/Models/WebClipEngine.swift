import Foundation

/// 网页剪藏内核：把一篇 HTML 抽成「可交 AI 提炼的正文 + 来源元信息」。
///
/// 与 Android `domain/WebClipEngine.kt` 是同一套规则的双端移植版：标签黑名单、正文容器
/// 候选、样板行过滤、实体解码与截断口径必须逐条一致，否则同一链接在手机与桌面会剪出
/// 不同内容。改规则请同步两端并各跑一次测试。
///
/// 扫描按 UTF-8 字节推进（HTML 结构字符全是 ASCII，多字节正文不会误触），与仓库里
/// 既有的 SSE 增量扫描器同一口径。
public enum WebClipError: Error, Equatable, LocalizedError {
    case blank
    case unparseable
    case unsupportedScheme(String)
    case missingHost
    case hasCredentials
    case tooLarge
    case noText
    case status(Int)
    case notHTML
    case network(String)

    public var errorDescription: String? {
        switch self {
        case .blank: return "链接为空"
        case .unparseable: return "无法识别这个链接"
        case .unsupportedScheme(let scheme): return "只支持 http/https，当前是 \(scheme)"
        case .missingHost: return "链接缺少域名"
        case .hasCredentials: return "链接里带有账号密码，已拒绝"
        case .tooLarge: return "网页过大，已放弃解析"
        case .noText: return "没从这一页抽到正文（可能需登录，或内容全靠脚本渲染）"
        case .status(let code): return "站点返回了 \(code)"
        case .notHTML: return "这个链接不是网页，抽不出正文"
        case .network(let detail): return "取不到这个页面：\(detail)"
        }
    }
}

/// 一次剪藏的结构化结果。
public struct WebClipDigest: Equatable, Sendable {
    public let sourceURL: String
    /// canonical 优先、回落到 sourceURL：入库时作为卡片的来源链接
    public let pageURL: String
    public let title: String
    public let siteName: String
    public let description: String
    public let text: String
    public let truncated: Bool

    /// 交 AI 提炼的正文：标题 + 网页摘要 + 正文，并显式带上来源，免得模型编出处
    public var aiNote: String {
        var lines: [String] = []
        if !title.isEmpty { lines.append("标题：\(title)") }
        if !description.isEmpty { lines.append("网页摘要：\(description)") }
        lines.append("来源：\(pageURL)")
        lines.append("")
        lines.append(text)
        return lines.joined(separator: "\n")
    }

    public var sourceLink: ScienceLink {
        ScienceLink(title: siteName.isEmpty ? pageURL : siteName, url: pageURL)
    }

    /// Mark AI-extracted cards as imported and keep the clipped page as their first source.
    public func attributing(_ cards: [KnowledgeCard]) -> [KnowledgeCard] {
        let sourceURLs = Set([sourceURL, sourceLink.url])
        return cards.map { card in
            var attributed = card
            attributed.source = .imported
            attributed.links.removeAll { sourceURLs.contains($0.url) }
            attributed.links.insert(sourceLink, at: 0)
            return attributed
        }
    }
}

public enum WebClipEngine {
    /// 正文上限。刻意与 `CardImportEngine.buildAITransformPrompt` 的既有预算同量级：
    /// 长文按行截断后再交模型，不为剪藏单开一档 token 成本。
    public static let maxTextCharacters = 4_000
    /// 解析输入上限：超过即放弃，防止把几十 MB 的页面读进内存
    public static let maxHTMLBytes = 4_000_000
    /// 抽到这么多有效字符就停止扫描：够提炼了，不必读完整页
    static let scanStopCharacters = maxTextCharacters * 3

    // MARK: - 规则表（双端逐条对齐）

    /// 连子树一起丢掉文字的标签：脚本样式之外，导航/页眉页脚/表单是噪音主要来源
    static let dropTags: Set<String> = [
        "script", "style", "noscript", "template", "svg", "canvas", "iframe",
        "video", "audio", "object", "embed", "track", "map", "form", "input",
        "select", "option", "textarea", "button", "label", "nav", "header",
        "footer", "aside", "dialog", "head",
    ]

    /// 自闭合标签：不能压栈，否则后面的结束标签会错位弹栈
    static let voidTags: Set<String> = [
        "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "param", "source", "track", "wbr",
    ]

    /// 断行标签
    static let blockTags: Set<String> = [
        "p", "div", "li", "ul", "ol", "dl", "dd", "dt", "h1", "h2", "h3", "h4",
        "h5", "h6", "article", "section", "main", "aside", "blockquote", "pre",
        "figure", "figcaption", "table", "thead", "tbody", "tr", "td", "th", "br",
    ]

    /// 语义正文标签：判候选时权重加倍
    static let semanticCandidateTags: Set<String> = ["article", "main"]

    /// id/class 命中这些词即视为正文容器候选
    static let candidateHints: [String] = [
        "articlebody", "article-body", "article-content", "post-content",
        "entry-content", "rich_text", "rich-text", "markdown-body", "main-content",
        "article", "content", "post", "entry", "story",
    ]

    /// 命中即否决候选：评论区、侧栏、翻页里到处都是 "content"/"post"
    static let candidateVetoes: [String] = [
        "comment", "sidebar", "side-bar", "footer", "header", "nav", "menu",
        "share", "related", "recommend", "promo", "advert", "breadcrumb",
        "pagination", "search", "toolbar", "tags", "reply", "vote", "toc",
    ]

    /// 整行命中即丢弃的样板文案（只在短行上生效，避免误伤正文里的同名句子）
    static let junkTokens: [String] = [
        "版权所有", "保留所有权利", "未经授权", "未经许可", "转载至", "文章来源",
        "登录查看", "扫码下载", "APP下载", "关注我们", "扫码关注", "分享到", "打赏",
        "相关推荐", "相关阅读", "下一篇", "上一篇", "返回列表", "返回顶部", "阅读原文",
        "查看原文", "订阅本文", "评论区", "Cookie", "隐私政策", "用户协议", "登录",
        "注册", "广告", "JavaScript", "copyright", "all rights reserved", "privacy",
        "terms of", "sign in", "log in", "subscribe", "newsletter", "advertisement",
        "enable javascript",
    ]

    static let junkTokenMaxLineCharacters = 48
    /// 短于此的行基本是按钮/菜单，不是知识
    static let minLineCharacters = 4
    /// 元信息行长上限
    static let metaLineCharacters = 160

    static let namedEntities: [String: Character] = [
        "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'",
        "nbsp": " ", "thinsp": " ", "ensp": " ", "emsp": " ",
        "copy": "©", "reg": "®", "trade": "™", "hellip": "…", "mdash": "—",
        "ndash": "–", "lsquo": "‘", "rsquo": "’", "ldquo": "“", "rdquo": "”",
        "laquo": "«", "raquo": "»", "middot": "·", "bull": "•", "deg": "°",
        "plusmn": "±", "times": "×", "divide": "÷", "frac12": "½", "sect": "§",
        "eacute": "é", "egrave": "è", "agrave": "à", "ccedil": "ç", "uuml": "ü",
        "ouml": "ö", "auml": "ä", "szlig": "ß",
    ]
    /// 解码后什么都不留的实体
    static let droppedEntities: Set<String> = ["shy"]

    // ASCII 结构字节（十六进制写死，避免各平台 Character→UInt8 转换口径差异）
    static let byteLt: UInt8 = 0x3C
    static let byteGt: UInt8 = 0x3E
    static let byteSlash: UInt8 = 0x2F
    static let byteEq: UInt8 = 0x3D
    static let byteQuote: UInt8 = 0x22
    static let byteApos: UInt8 = 0x27

    // MARK: - 链接校验

    /// 只接受纯 http/https；带 userinfo 一律拒绝（否则凭据会被写进卡片来源链接）
    public static func validatedURL(fromString raw: String) throws -> URL {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { throw WebClipError.blank }
        // 冒号前像协议、冒号后既不是 // 也不是「带点主机名:端口」—— 视为用户显式写了非 http 协议。
        // 少了这一步，`javascript:alert(1)` 会被补成 `https://javascript:alert(1)`，
        // 报出「无法识别」而不是「只支持 http/https」。
        if let explicit = explicitNonHTTPScheme(in: trimmed) { throw WebClipError.unsupportedScheme(explicit) }
        let candidate = trimmed.range(of: "://") != nil ? trimmed : "https://\(trimmed)"
        guard let url = URL(string: candidate) else { throw WebClipError.unparseable }
        let scheme = (url.scheme ?? "").lowercased()
        guard scheme == "http" || scheme == "https" else {
            throw WebClipError.unsupportedScheme(scheme.isEmpty ? "无协议" : scheme)
        }
        guard let host = url.host, !host.isEmpty else { throw WebClipError.missingHost }
        if url.user != nil || url.password != nil { throw WebClipError.hasCredentials }
        return url
    }

    static func explicitNonHTTPScheme(in text: String) -> String? {
        guard let colon = text.firstIndex(of: ":") else { return nil }
        let head = text[..<colon]
        guard !head.isEmpty, !head.contains("/"), head.allSatisfy({
            $0.isLetter || $0.isNumber || $0 == "+" || $0 == "-" || $0 == "."
        }) else { return nil }
        let tail = text[text.index(after: colon)...]
        if tail.hasPrefix("//") { return nil }
        // host:port 只在 head 真的像主机名时成立；否则 `tel:12345` 会被当成 http://tel:12345
        if let first = tail.first, first.isNumber, head.contains(".") || head.lowercased() == "localhost" {
            return nil
        }
        let lowered = head.lowercased()
        return (lowered == "http" || lowered == "https") ? nil : lowered
    }

    /// 分享面板常收到「正文 + 链接」混排文本，取第一个 http(s) 链接
    public static func firstURL(in text: String) -> String? {
        let delimiters: Set<Character> = [
            " ", "\t", "\n", "\r", "<", ">", "\"", "'", "(", ")", "[", "]",
            ",", ";", "{", "}", "|",
        ]
        let trailing: Set<Character> = [
            ".", "。", "，", ",", "、", "！", "?", "”", "»", ")", "]", "}", ":",
        ]
        for rawToken in text.split(whereSeparator: { delimiters.contains($0) }) {
            var token = String(rawToken)
            while let last = token.last, trailing.contains(last) { token.removeLast() }
            let lowered = token.lowercased()
            if lowered.hasPrefix("http://") || lowered.hasPrefix("https://") { return token }
        }
        return nil
    }

    // MARK: - 抽取

    /// 从 HTML 抽正文；抽不到文字返回 nil（调用方负责给出可读失败）
    public static func digest(html: String, sourceURL: URL) -> WebClipDigest? {
        let bytes = Array(html.utf8)
        guard bytes.count <= maxHTMLBytes else { return nil }
        let out = TextCollector(limit: scanStopCharacters)
        var frames: [String] = []
        var dropDepth = 0
        var openCandidates: [Candidate] = []
        var candidates: [Candidate] = []
        var rawTitle = ""
        var capturingTitle = false
        var canonical: String?
        var ogTitle = ""
        var siteName = ""
        var pageDescription = ""
        var i = 0

        while i < bytes.count {
            guard bytes[i] == byteLt else {
                var end = i
                while end < bytes.count, bytes[end] != byteLt { end += 1 }
                let chunk = decodeEntities(String(decoding: bytes[i..<end], as: UTF8.self))
                if capturingTitle {
                    let piece = singleLine(chunk)
                    if piece.count > rawTitle.count { rawTitle = piece }
                } else if dropDepth == 0 {
                    out.append(chunk)
                }
                i = end
                continue
            }

            if matches(bytes, at: i, "<!--") {
                guard let close = indexOf(bytes, from: i + 4, byteGt) else { break }
                i = close + 1
                continue
            }
            if matches(bytes, at: i, "<!") || matches(bytes, at: i, "<?") {
                guard let close = indexOf(bytes, from: i + 2, byteGt) else { break }
                i = close + 1
                continue
            }
            guard let tag = parseTag(bytes, from: i) else { break }
            i = tag.nextIndex
            if out.hitLimit { break }

            if tag.isClosing {
                if tag.name == "title" { capturingTitle = false }
                guard let depth = frames.lastIndex(of: tag.name) else { continue }
                while frames.count > depth {
                    let popped = frames.removeLast()
                    if dropTags.contains(popped) { dropDepth -= 1 }
                    if openCandidates.last?.tag == popped {
                        closeCandidate(&openCandidates, end: out.count, into: &candidates)
                    }
                }
                continue
            }

            let isVoid = voidTags.contains(tag.name)
            if !isVoid { frames.append(tag.name) }
            if dropTags.contains(tag.name), !isVoid, !tag.selfClosing { dropDepth += 1 }
            if tag.name == "title", !isVoid, !tag.selfClosing {
                capturingTitle = true
                continue
            }

            if tag.name == "meta" || tag.name == "link" {
                let rel = (tag.attributes["rel"] ?? "").lowercased()
                if tag.name == "link", rel == "canonical" {
                    let href = tag.attributes["href"] ?? ""
                    if !href.isEmpty { canonical = resolve(href, against: sourceURL) }
                }
                let key = (tag.attributes["property"] ?? tag.attributes["name"] ?? "").lowercased()
                let value = tag.attributes["content"] ?? ""
                switch key {
                case "og:title": if value.count > ogTitle.count { ogTitle = value }
                case "og:site_name": if siteName.isEmpty { siteName = value }
                case "og:description", "description", "twitter:description":
                    if value.count > pageDescription.count { pageDescription = value }
                default: break
                }
                continue
            }

            if blockTags.contains(tag.name) { out.newline() }
            if !isVoid, !tag.selfClosing {
                let lowered = "\(tag.attributes["id"] ?? "") \(tag.attributes["class"] ?? "")"
                    .lowercased()
                if isCandidateContainer(tag.name, loweredAttributes: lowered) {
                    openCandidates.append(Candidate(
                        tag: tag.name,
                        start: out.count,
                        vetoed: candidateVetoes.contains { lowered.contains($0) }
                    ))
                }
            }
        }

        // 未闭合的候选容器按当前位置收口
        while !openCandidates.isEmpty {
            closeCandidate(&openCandidates, end: out.count, into: &candidates)
        }

        let finalized = finalizeText(chooseText(candidates: candidates, full: out.text))
        guard !finalized.text.isEmpty else { return nil }

        let rawHost = sourceURL.host ?? ""
        let host = rawHost.hasPrefix("www.") ? String(rawHost.dropFirst(4)) : rawHost
        let og = singleLine(ogTitle)
        let site = singleLine(siteName)
        return WebClipDigest(
            sourceURL: sourceURL.absoluteString,
            pageURL: canonical ?? sourceURL.absoluteString,
            title: rawTitle.count >= og.count ? rawTitle : og,
            siteName: site.isEmpty ? host : site,
            description: singleLine(pageDescription),
            text: finalized.text,
            truncated: finalized.truncated
        )
    }

    static func isCandidateContainer(_ tag: String, loweredAttributes: String) -> Bool {
        if semanticCandidateTags.contains(tag) { return true }
        return candidateHints.contains { loweredAttributes.contains($0) }
    }

    struct Candidate {
        let tag: String
        let start: Int
        var end: Int = 0
        let vetoed: Bool
        var length: Int { max(0, end - start) }
    }

    private static func closeCandidate(
        _ open: inout [Candidate],
        end: Int,
        into closed: inout [Candidate]
    ) {
        guard var top = open.popLast() else { return }
        top.end = end
        if !top.vetoed { closed.append(top) }
    }

    /// 正文容器要占整页文字一半以上才采信，否则整页更可靠（内容分散型页面如维基）
    static func chooseText(candidates: [Candidate], full: String) -> String {
        guard let best = candidates.max(by: { $0.length < $1.length }), best.length > 0 else { return full }
        let boosted = best.length * (semanticCandidateTags.contains(best.tag) ? 2 : 1)
        guard boosted * 2 >= full.count else { return full }
        return String(full.dropFirst(best.start).prefix(best.length))
    }

    struct FinalizedText {
        let text: String
        let truncated: Bool
    }

    /// 逐行清洗：丢短行与样板行，再按字数上限截断（不切半行）
    static func finalizeText(_ raw: String) -> FinalizedText {
        var kept: [String] = []
        for slice in raw.split(whereSeparator: { $0 == "\n" || $0 == "\r" }) {
            let line = String(slice).trimmingCharacters(in: .whitespacesAndNewlines)
            if line.count < minLineCharacters { continue }
            if isJunkLine(line) { continue }
            kept.append(line)
        }
        var result = ""
        var used = 0
        for line in kept {
            let cost = line.count + (result.isEmpty ? 0 : 1)
            if used + cost > maxTextCharacters {
                // 一行都放不下时至少留个开头，别让整篇变空
                if result.isEmpty { result = String(line.prefix(maxTextCharacters)) }
                return FinalizedText(text: result, truncated: true)
            }
            if !result.isEmpty { result.append("\n") }
            result.append(line)
            used += cost
        }
        return FinalizedText(text: result, truncated: false)
    }

    static func isJunkLine(_ line: String) -> Bool {
        guard line.count <= junkTokenMaxLineCharacters else { return false }
        let lowered = line.lowercased()
        return junkTokens.contains { lowered.contains($0) }
    }

    /// 元信息与 `<title>`：折成一行、限长
    public static func singleLine(_ raw: String) -> String {
        let collapsed = raw
            .split(whereSeparator: { $0 == "\n" || $0 == "\r" || $0.isWhitespace })
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        return String(collapsed.prefix(metaLineCharacters))
    }

    /// 不可见字符：软连字符与零宽/方向标记留着会让卡片正文出现「看不见但影响检索」的字节
    static func isInvisible(_ c: Character) -> Bool {
        guard let scalar = c.unicodeScalars.first, c.unicodeScalars.count == 1 else { return false }
        switch scalar.value {
        case 0xAD, 0x200B...0x200F, 0x2028, 0x2029, 0x202A...0x202E, 0xFEFF: return true
        default: return false
        }
    }

    // MARK: - 文本缓冲（HTML 空白折叠）

    /// 连续空白折成一个分隔符：源码里的换行缩进不该变成空行
    final class TextCollector {
        private(set) var text = ""
        private(set) var count = 0
        var hitLimit = false
        private let limit: Int
        private var pendingSpace = false
        private var sawNewline = false

        init(limit: Int) { self.limit = limit }

        func append(_ chunk: String) {
            for c in chunk {
                if c == "\n" {
                    sawNewline = true
                    pendingSpace = true
                    continue
                }
                if c == " " || c == "\t" || c == "\r" || c == "\u{0C}" || c == "\u{A0}" {
                    pendingSpace = true
                    continue
                }
                if c.isASCII && c < " " { continue }  // 其余 C0 控制字符是网页垃圾字节
                if isInvisible(c) { continue }
                flushSpace()
                if count >= limit { hitLimit = true; return }
                text.append(c)
                count += 1
            }
        }

        func newline() {
            flushSpace()
            if count >= limit { hitLimit = true; return }
            if text.last == "\n" { return }
            text.append("\n")
            count += 1
            sawNewline = false
            pendingSpace = false
        }

        private func flushSpace() {
            guard pendingSpace else { return }
            pendingSpace = false
            let separator: Character = sawNewline ? "\n" : " "
            sawNewline = false
            if count == 0 || text.last == "\n" { return }
            if count >= limit { hitLimit = true; return }
            text.append(separator)
            count += 1
        }
    }

    // MARK: - 实体解码

    /// 只解 `&name;` / `&#123;` / `&#x7B;`。不追求 HTML5 容错全集，但绝不吞正文里正常的 `&`
    public static func decodeEntities(_ raw: String) -> String {
        guard raw.contains("&") else { return raw }
        let chars = Array(raw)
        var out: [Character] = []
        out.reserveCapacity(chars.count)
        var i = 0
        while i < chars.count {
            guard chars[i] == "&" else {
                let c = chars[i]
                if !isInvisible(c) { out.append(c) }
                i += 1
                continue
            }
            var j = i + 1
            var body: [Character] = []
            var terminated = false
            while j < chars.count, body.count < 12 {
                let b = chars[j]
                if b == ";" { terminated = true; break }
                if b == "&" || b == "<" || b == " " || b == "\n" { break }
                body.append(b)
                j += 1
            }
            guard terminated, !body.isEmpty else { out.append("&"); i += 1; continue }
            if body.first == "#" {
                let digits = body.dropFirst()
                let hex = digits.first == "x" || digits.first == "X"
                let scalarText = String(hex ? digits.dropFirst() : digits)
                let value = hex ? UInt32(scalarText, radix: 16) : UInt32(scalarText, radix: 10)
                if let value, let scalar = Unicode.Scalar(value), value == 0x0A || value >= 0x20 {
                    let c = Character(scalar)
                    if !isInvisible(c) { out.append(c) }
                }
                i = j + 1
                continue
            }
            let key = String(body).lowercased()
            if droppedEntities.contains(key) { i = j + 1; continue }
            if let mapped = namedEntities[key] {
                out.append(mapped)
                i = j + 1
                continue
            }
            out.append("&")
            i += 1
        }
        return String(out)
    }

    // MARK: - 字符集

    /// 按「HTTP 头 charset → 前 1024 字节里的 `<meta charset>` → UTF-8」的优先级解码页面字节。
    /// 中文站仍有一批输出 GBK/GB2312/Big5，硬按 UTF-8 读会得到一串 ``，正文抽取也就废了。
    public static func decodeHTML(_ bytes: [UInt8], contentType: String?) -> String {
        let name = charsetName(contentType: contentType) ?? charsetName(head: Array(bytes.prefix(1024)))
        if let name, let encoding = foundationEncoding(named: name) {
            if let text = String(bytes: bytes, encoding: encoding) { return text }
        }
        return String(decoding: bytes, as: UTF8.self)
    }

    internal static func charsetName(contentType: String?) -> String? {
        guard let contentType else { return nil }
        return charsetValue(in: contentType)
    }

    /// 从字节里嗅探 charset：`<meta charset="gbk">` 与 `<meta http-equiv=Content-Type content="...; charset=gbk">`
    internal static func charsetName(head: [UInt8]) -> String? {
        let text = String(decoding: head, as: UTF8.self)
        for candidate in text.components(separatedBy: "meta") {
            if let found = charsetValue(in: candidate) { return found }
        }
        return nil
    }

    /// 抓 `charset` 关键字后的值（可带引号、可大小写、可比拼成 charsets 少一个字母）
    private static func charsetValue(in text: String) -> String? {
        let chars = Array(text.lowercased())
        guard let at = firstRange(of: chars, Array("charset")) else { return nil }
        var i = at + 7
        func skipTrivia() {
            while i < chars.count, chars[i] == " " || chars[i] == "\t" || chars[i] == "\n" { i += 1 }
        }
        skipTrivia()
        guard i < chars.count, chars[i] == "=" else { return nil }
        i += 1
        skipTrivia()
        let quote: Character? = (i < chars.count && (chars[i] == "\"" || chars[i] == "'")) ? chars[i] : nil
        if quote != nil { i += 1 }
        var value = ""
        while i < chars.count {
            let c = chars[i]
            if let quote {
                if c == quote { i += 1; break }
            } else if c == ";" || c == "," || c == "\"" || c == "'" || c == ">" || c == " " || c == "\t" || c == "\n" {
                break
            }
            value.append(c)
            i += 1
        }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func firstRange(of chars: [Character], _ needle: [Character]) -> Int? {
        guard chars.count >= needle.count, !needle.isEmpty else { return nil }
        var i = 0
        while i + needle.count <= chars.count {
            var matched = true
            for k in 0..<needle.count where chars[i + k] != needle[k] {
                matched = false
                break
            }
            if matched { return i }
            i += 1
        }
        return nil
    }

    /// IANA 字符集名 → String.Encoding。测试也用它造 GBK/Big5 夹具（Swift 的 `String.Encoding`
    /// 枚举里没有 gb18030，只能走 CoreFoundation 转换）。
    internal static func foundationEncoding(named: String) -> String.Encoding? {
        let cfEncoding = CFStringConvertIANACharSetNameToEncoding(named as CFString)
        guard cfEncoding != kCFStringEncodingInvalidId else { return nil }
        let nsEncoding = CFStringConvertEncodingToNSStringEncoding(cfEncoding)
        return String.Encoding(rawValue: nsEncoding)
    }

    // MARK: - 标签扫描

    struct ParsedTag {
        let name: String
        let attributes: [String: String]
        let selfClosing: Bool
        let isClosing: Bool
        let nextIndex: Int
    }

    /// 手工扫描而非正则：要能扛住属性里带 `>`、值不加引号、大小写混写的真实网页
    static func parseTag(_ bytes: [UInt8], from start: Int) -> ParsedTag? {
        var i = start + 1
        var isClosing = false
        if i < bytes.count, bytes[i] == byteSlash {
            isClosing = true
            i += 1
        }
        guard i < bytes.count, isAsciiLetter(bytes[i]) else { return nil }
        var nameBytes: [UInt8] = []
        while i < bytes.count, isAsciiNameByte(bytes[i]) {
            nameBytes.append(lowerAscii(bytes[i]))
            i += 1
        }
        let name = String(decoding: nameBytes, as: UTF8.self)

        var attributes: [String: String] = [:]
        var selfClosing = false
        while i < bytes.count {
            let c = bytes[i]
            if c == byteGt {
                return ParsedTag(name: name, attributes: attributes, selfClosing: selfClosing,
                                 isClosing: isClosing, nextIndex: i + 1)
            }
            if c == byteSlash { selfClosing = true; i += 1; continue }
            if isAsciiWhitespace(c) { i += 1; continue }

            var keyBytes: [UInt8] = []
            while i < bytes.count, bytes[i] != byteEq, bytes[i] != byteGt, bytes[i] != byteSlash,
                  !isAsciiWhitespace(bytes[i]) {
                keyBytes.append(lowerAscii(bytes[i]))
                i += 1
            }
            if keyBytes.isEmpty { i += 1; continue }
            let key = String(decoding: keyBytes, as: UTF8.self)

            var k = i
            while k < bytes.count, isAsciiWhitespace(bytes[k]) { k += 1 }
            guard k < bytes.count, bytes[k] == byteEq else {
                attributes[key] = ""
                i = k > i ? k : i + 1
                continue
            }
            i = k + 1
            while i < bytes.count, isAsciiWhitespace(bytes[i]) { i += 1 }
            guard i < bytes.count else { break }

            var valueBytes: [UInt8] = []
            let quote = bytes[i]
            if quote == byteQuote || quote == byteApos {
                i += 1
                while i < bytes.count, bytes[i] != quote {
                    valueBytes.append(bytes[i])
                    i += 1
                }
                i += 1
            } else {
                while i < bytes.count, bytes[i] != byteGt, !isAsciiWhitespace(bytes[i]) {
                    valueBytes.append(bytes[i])
                    i += 1
                }
            }
            attributes[key] = decodeEntities(String(decoding: valueBytes, as: UTF8.self))
        }
        return ParsedTag(name: name, attributes: attributes, selfClosing: selfClosing,
                         isClosing: isClosing, nextIndex: bytes.count)
    }

    static func resolve(_ href: String, against base: URL) -> String {
        let trimmed = href.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return base.absoluteString }
        return URL(string: trimmed, relativeTo: base)?.absoluteURL.absoluteString ?? trimmed
    }

    // MARK: - 字节工具

    static func matches(_ bytes: [UInt8], at index: Int, _ prefix: String) -> Bool {
        let p = Array(prefix.utf8)
        guard index + p.count <= bytes.count else { return false }
        for k in 0..<p.count where bytes[index + k] != p[k] { return false }
        return true
    }

    static func indexOf(_ bytes: [UInt8], from: Int, _ target: UInt8) -> Int? {
        var i = from
        while i < bytes.count {
            if bytes[i] == target { return i }
            i += 1
        }
        return nil
    }

    static func isAsciiLetter(_ b: UInt8) -> Bool { (0x41...0x5A).contains(b) || (0x61...0x7A).contains(b) }
    static func isAsciiDigit(_ b: UInt8) -> Bool { (0x30...0x39).contains(b) }
    static func isAsciiNameByte(_ b: UInt8) -> Bool {
        isAsciiLetter(b) || isAsciiDigit(b) || b == 0x2D || b == 0x3A || b == 0x2E
    }
    static func isAsciiWhitespace(_ b: UInt8) -> Bool { b == 0x20 || b == 0x09 || b == 0x0A || b == 0x0D || b == 0x0C }
    static func lowerAscii(_ b: UInt8) -> UInt8 { (0x41...0x5A).contains(b) ? b + 32 : b }
}
