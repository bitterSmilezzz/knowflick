import Foundation
import Testing

@testable import KnowFlickCore

private actor CountingByteSource {
    private let bytes: [UInt8]
    private var nextIndex = 0

    init(_ bytes: [UInt8]) { self.bytes = bytes }

    var readCount: Int { nextIndex }

    func next() -> UInt8? {
        defer { nextIndex += 1 }
        guard nextIndex < bytes.count else { return nil }
        return bytes[nextIndex]
    }
}

private struct CountingByteSequence: AsyncSequence {
    typealias Element = UInt8
    let source: CountingByteSource

    struct Iterator: AsyncIteratorProtocol {
        let source: CountingByteSource
        mutating func next() async -> UInt8? { await source.next() }
    }

    func makeAsyncIterator() -> Iterator { Iterator(source: source) }
}

/// 剪藏网络层的**判定逻辑**（不碰网络）：内容类型闸门、超限截断、字符集直通、请求头。
/// Android 端 `WebClipFetcherTest.kt` 是同一批断言，两端口径必须一致。
struct WebClipFetcherTests {

    private let pageHTML = """
    <html><head><title>财务报表里的商誉</title></head>
    <body><article><p>商誉只有在被收购方业绩不及预期时才会暴露成一次性亏损，这是它最反直觉的地方。</p>
    <p>减值测试每年做一次，但管理层有动机把资产组划大，从而用未来现金流掩盖当下的下滑。</p></article></body></html>
    """

    private func url(_ string: String) -> URL { URL(string: string)! }

    @Test("只解析 HTML 类响应，PDF/图片/JSON 直接拒")
    func htmlGate() {
        #expect(WebClipFetcher.isHTMLContent("text/html; charset=utf-8"))
        #expect(WebClipFetcher.isHTMLContent("application/xhtml+xml"))
        #expect(WebClipFetcher.isHTMLContent(nil))       // 缺头时交给正文判定
        #expect(WebClipFetcher.isHTMLContent("text/plain"))
        #expect(!WebClipFetcher.isHTMLContent("application/pdf"))
        #expect(!WebClipFetcher.isHTMLContent("image/png"))
        #expect(!WebClipFetcher.isHTMLContent("application/json"))
    }

    @Test("非网页给出可读失败")
    func rejectsNonHTML() throws {
        let bytes = Array(pageHTML.utf8)
        #expect(throws: WebClipError.notHTML) {
            try WebClipFetcher.digest(fromBytes: bytes, contentType: "application/pdf", url: url("https://a.test/x.pdf"))
        }
    }

    @Test("超限页面按前缀解析并标记 truncated")
    func capsOversizedPage() throws {
        let padding = String(repeating: " ", count: WebClipEngine.maxHTMLBytes - pageHTML.utf8.count + 1)
        let bytes = Array((pageHTML + padding).utf8)
        let digest = try WebClipFetcher.digest(fromBytes: bytes, contentType: "text/html", url: url("https://b.test/long"))
        #expect(digest.truncated)
        #expect(digest.text.contains("商誉只有在被收购方"))
    }

    @Test("网页来源排在 AI 提炼卡片的第一条链接")
    func attributesClippedCardsWithSource() {
        let digest = WebClipDigest(
            sourceURL: "https://example.test/article?from=share",
            pageURL: "https://example.test/canonical",
            title: "A useful article",
            siteName: "Example",
            description: "Summary",
            text: "Article body",
            truncated: false
        )
        let card = KnowledgeCard(
            category: "AI",
            headline: "A useful idea",
            summary: "Summary",
            details: "Details",
            links: [
                ScienceLink(title: "Example", url: digest.pageURL),
                ScienceLink(title: "Research paper", url: "https://papers.test/1")
            ],
            source: .ai
        )

        let attributed = digest.attributing([card])

        #expect(attributed.count == 1)
        #expect(attributed[0].source == .imported)
        #expect(attributed[0].links.first == digest.sourceLink)
        #expect(attributed[0].links.filter { $0.url == digest.pageURL }.count == 1)
        #expect(attributed[0].links.last?.url == "https://papers.test/1")
    }

    @Test("流式读取在上限后一字节停止，并能区分刚好到限")
    func readsOnlyThroughOverflowSentinel() async throws {
        let oversizedSource = CountingByteSource([0, 1, 2, 3, 4, 5, 6, 7])
        var cancelled = false
        let oversized = try await WebClipFetcher.readCapped(
            CountingByteSequence(source: oversizedSource),
            maxByteCount: 4,
            onLimit: { cancelled = true }
        )
        let oversizedReadCount = await oversizedSource.readCount
        #expect(oversized.bytes == [0, 1, 2, 3, 4])
        #expect(oversized.truncated)
        #expect(oversizedReadCount == 5)
        #expect(cancelled)

        let exactSource = CountingByteSource([1, 2, 3, 4])
        var exactCancelled = false
        let exact = try await WebClipFetcher.readCapped(
            CountingByteSequence(source: exactSource),
            maxByteCount: 4,
            onLimit: { exactCancelled = true }
        )
        let exactReadCount = await exactSource.readCount
        #expect(exact.bytes == [1, 2, 3, 4])
        #expect(!exact.truncated)
        #expect(exactReadCount == 5) // 最后一轮只确认 EOF，没有额外缓存正文。
        #expect(!exactCancelled)
    }

    @Test("GBK 页面先按 charset 解码再抽取")
    func decodesGBK() throws {
        let bytes = Array(pageHTML.data(using: WebClipEngine.foundationEncoding(named: "gbk")!) ?? Data())
        let digest = try WebClipFetcher.digest(fromBytes: bytes, contentType: "text/html; charset=gbk", url: url("https://c.test/gbk"))
        #expect(digest.title == "财务报表里的商誉")
        #expect(digest.text.contains("减值测试每年做一次"))
    }

    @Test("抽不到正文就失败，而不是产出一张空卡")
    func rejectsEmptyPage() {
        let bytes = Array("<html><body><nav><a>/</a></nav><div>请登录后浏览</div></body></html>".utf8)
        #expect(throws: WebClipError.noText) {
            try WebClipFetcher.digest(fromBytes: bytes, contentType: "text/html; charset=utf-8", url: url("https://d.test/login"))
        }
    }

    @Test("请求是匿名 GET：浏览器同族 UA、不带 Cookie")
    func requestShape() throws {
        let request = WebClipFetcher.makeRequest(for: url("https://example.com/post?a=1"))
        #expect(request.httpMethod == "GET")
        #expect(request.url?.absoluteString == "https://example.com/post?a=1")
        #expect(request.value(forHTTPHeaderField: "User-Agent")?.contains("KnowFlick") == true)
        #expect(request.httpShouldHandleCookies == false)
        #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
    }

    @Test("会话配置不接收 Cookie、不落盘缓存")
    func sessionIsAnonymous() {
        let configuration = WebClipFetcher.anonymousConfiguration()
        #expect(configuration.httpCookieAcceptPolicy == .never)
        #expect(configuration.httpShouldSetCookies == false)
        #expect(configuration.urlCache == nil)
        #expect(configuration.urlCredentialStorage == nil)
        #expect(configuration.requestCachePolicy == .reloadIgnoringLocalCacheData)
        #expect(configuration.timeoutIntervalForRequest == WebClipFetcher.timeoutSeconds)
    }
}
