import Foundation

/// 剪藏的网络出口：只发 GET、不带任何本地凭据、限大小限时长。
///
/// 与 Android `data/WebClipFetcher.kt` 同一口径（同一 URL 双端应得到同一 digest）。
/// 抓取本身不进单测（依赖外网可达性），因此把**所有判定**下沉到
/// `digest(fromBytes:contentType:url:)` 这个纯函数里离线测，网络层只负责搬运字节。
public enum WebClipFetcher {
    /// 与真实浏览器同族 UA：不少站点会对无 UA 或纯 App UA 的请求返回精简页甚至直接拦截
    public static let userAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) KnowFlick/4.3 Safari/605.1.15"

    public static let timeoutSeconds: TimeInterval = 15

    /// 允许当正文解析的响应类型。PDF/图片/JSON 走这条路径只会抽出乱码。
    static func isHTMLContent(_ contentType: String?) -> Bool {
        guard let raw = contentType?.lowercased() else { return true }  // 缺头时交给正文判定
        let media = raw.components(separatedBy: ";").first?.trimmingCharacters(in: .whitespaces) ?? ""
        return media.isEmpty || media.contains("html") || media.contains("xml") || media == "text/plain"
    }

    public static func makeRequest(for url: URL) -> URLRequest {
        var request = URLRequest(url: url, timeoutInterval: timeoutSeconds)
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false   // 剪藏不该带走浏览器/服务凭据
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("text/html,application/xhtml+xml;q=0.9,*/*;q=0.1", forHTTPHeaderField: "Accept")
        request.setValue("gzip", forHTTPHeaderField: "Accept-Encoding")
        return request
    }

    /// 不写磁盘缓存、不接收也不发送 Cookie 的会话配置：剪藏是匿名只读抓取。
    /// 单独暴露出来（而不是藏在 `URLSession` 里）是因为 `URLSession.configuration` 返回的是
    /// 一份拷贝，`urlCache = nil` 会被 Foundation 归一化掉，只有原始配置可断言。
    public static func anonymousConfiguration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieAcceptPolicy = .never
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = timeoutSeconds
        configuration.timeoutIntervalForResource = timeoutSeconds
        return configuration
    }

    public static func anonymousSession() -> URLSession {
        URLSession(configuration: anonymousConfiguration())
    }

    /// 抓链接并抽正文。`text` 可以是分享面板里的「正文 + 链接」混排文本。
    public static func clip(text: String, session: URLSession? = nil) async throws -> WebClipDigest {
        let urlString = WebClipEngine.firstURL(in: text) ?? text
        let url = try WebClipEngine.validatedURL(fromString: urlString)
        let ownsSession = session == nil
        let client = session ?? anonymousSession()
        defer { if ownsSession { client.invalidateAndCancel() } }
        let (data, response) = try await client.data(for: makeRequest(for: url))
        guard let http = response as? HTTPURLResponse else { throw WebClipError.network("非 HTTP 响应") }
        guard (200...299).contains(http.statusCode) else {
            // 3xx 由 URLSession 自动跟随；走到这里说明是 4xx/5xx 或重定向环
            throw WebClipError.status(http.statusCode)
        }
        return try digest(fromBytes: Array(data), contentType: http.value(forHTTPHeaderField: "Content-Type"), url: url)
    }

    /// 纯函数：字节 → digest。大小上限、内容类型、抽不到正文都在这里判定，可离线测试。
    public static func digest(fromBytes bytes: [UInt8], contentType: String?, url: URL) throws -> WebClipDigest {
        guard isHTMLContent(contentType) else { throw WebClipError.notHTML }
        let capped = bytes.count > WebClipEngine.maxHTMLBytes
        let source: [UInt8] = capped ? Array(bytes.prefix(WebClipEngine.maxHTMLBytes)) : bytes
        let html = WebClipEngine.decodeHTML(source, contentType: contentType)
        guard let parsed = WebClipEngine.digest(html: html, sourceURL: url) else {
            throw WebClipError.noText
        }
        guard capped else { return parsed }
        return WebClipDigest(
            sourceURL: parsed.sourceURL,
            pageURL: parsed.pageURL,
            title: parsed.title,
            siteName: parsed.siteName,
            description: parsed.description,
            text: parsed.text,
            truncated: true
        )
    }
}
