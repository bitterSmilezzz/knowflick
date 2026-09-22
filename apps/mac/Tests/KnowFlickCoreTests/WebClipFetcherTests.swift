import Foundation
import Testing

@testable import KnowFlickCore

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
