import Foundation
import Testing

@testable import KnowFlickCore

/// 网页剪藏内核测试。断言的是**双端共同契约**（同一份 HTML 在 mac 与 Android 上必须
/// 抽出同样的标题与正文），所以期望值写成字面量而不是「非空即可」。
/// 等价用例见 Android `domain/WebClipEngineTest.kt`。
struct WebClipEngineTests {

    private func url(_ string: String) -> URL { URL(string: string)! }

    // MARK: - 链接校验

    @Test("裸域名补 https，显式协议保留")
    func normalizesScheme() throws {
        #expect(try WebClipEngine.validatedURL(fromString: "example.com/post").scheme == "https")
        #expect(try WebClipEngine.validatedURL(fromString: "http://example.com").scheme == "http")
        #expect(try WebClipEngine.validatedURL(fromString: "  https://a.test/x  ").absoluteString == "https://a.test/x")
    }

    @Test("非 http/https、缺域名、带凭据一律拒绝")
    func rejectsUnsafeURLs() {
        #expect(throws: WebClipError.unsupportedScheme("ftp")) {
            try WebClipEngine.validatedURL(fromString: "ftp://example.com/file")
        }
        #expect(throws: WebClipError.unsupportedScheme("javascript")) {
            try WebClipEngine.validatedURL(fromString: "javascript:alert(1)")
        }
        #expect(throws: WebClipError.blank) {
            try WebClipEngine.validatedURL(fromString: "   ")
        }
        #expect(throws: WebClipError.missingHost) {
            try WebClipEngine.validatedURL(fromString: "https://")
        }
        // 带 userinfo 的链接会把凭据原样写进卡片来源链接，必须拒绝
        #expect(throws: WebClipError.hasCredentials) {
            try WebClipEngine.validatedURL(fromString: "https://user:pw@example.com/x")
        }
    }

    @Test("host:port 不被误判成协议，mailto 与 tel 拒绝")
    func distinguishesPortFromScheme() throws {
        #expect(try WebClipEngine.validatedURL(fromString: "example.com:8080/x").port == 8080)
        #expect(try WebClipEngine.validatedURL(fromString: "localhost:8080/x").host == "localhost")
        #expect(throws: WebClipError.unsupportedScheme("mailto")) {
            try WebClipEngine.validatedURL(fromString: "mailto:someone@example.com")
        }
        #expect(throws: WebClipError.unsupportedScheme("tel")) {
            try WebClipEngine.validatedURL(fromString: "tel:12345")
        }
    }

    @Test("分享文本里抓第一个链接，去掉中文句读尾巴")
    func extractsFirstURLFromShareText() {
        #expect(WebClipEngine.firstURL(in: "强烈推荐这篇 https://example.com/a。") == "https://example.com/a")
        #expect(WebClipEngine.firstURL(in: "看这个 http://a.test/1 和 http://b.test/2") == "http://a.test/1")
        #expect(WebClipEngine.firstURL(in: "没有链接") == nil)
        #expect(WebClipEngine.firstURL(in: "<https://c.test/x>") == "https://c.test/x")
    }

    // MARK: - 正文抽取

    private let articleHTML = """
    <!DOCTYPE html>
    <html lang="zh">
    <head>
      <meta charset="utf-8">
      <title>复利的第七十天 &amp; 一个反直觉的结论</title>
      <meta name="description" content="为什么 1% 的日增长在 70 天后会翻倍">
      <meta property="og:site_name" content="科普示例站">
      <link rel="canonical" href="/finance/compound-70">
      <style>.nav{color:red}</style>
      <script>var hidden = "脚本里的文字不该出现";</script>
    </head>
    <body>
      <header class="site-header">
        <nav><a href="/">首页</a><a href="/about">关于本站</a></nav>
      </header>
      <div id="sidebar" class="sidebar related-content">
        <p>侧栏推荐：这篇文章讲的是一个完全不同的话题，它足够长以便在按长度挑选正文容器时胜出，然而它是推荐位而不是正文内容区域。</p>
      </div>
      <article class="post-content">
        <h1>复利的第七十天</h1>
        <p>每天进步 1%，七十天后总量翻倍——这是金融里最常用的粗略估算，它的名字叫「72 法则」。</p>
        <p>法则的分母取 72 而不是 70，是因为 72 有十二个因子，能被 2、3、4、6、8、9 整除，口算时更顺手。</p>
        <p>但真实的复利要扣通胀与手续费，名义翻倍不等于购买力翻倍。</p>
        <form><input type="text" placeholder="订阅"></form>
        <p>表单之后的这一段仍然属于文章正文，它验证自闭合标签不会把后续文字一起丢掉。</p>
      </article>
      <section id="comments">
        <p>评论区评论：楼主说得对我完全同意，这条评论也很长，用来验证 comment 容器会被否决而不会当成正文容器。</p>
      </section>
      <footer>© 2026 科普示例站 版权所有 未经授权禁止转载</footer>
    </body>
    </html>
    """

    @Test("标题/站点名/canonical 与摘要从 head 抽出")
    func readsHeadMetadata() throws {
        let digest = try #require(WebClipEngine.digest(html: articleHTML, sourceURL: url("https://example.com/anything")))
        #expect(digest.title == "复利的第七十天 & 一个反直觉的结论")
        #expect(digest.siteName == "科普示例站")
        #expect(digest.description == "为什么 1% 的日增长在 70 天后会翻倍")
        #expect(digest.pageURL == "https://example.com/finance/compound-70")
        #expect(digest.sourceURL == "https://example.com/anything")
    }

    @Test("正文只留文章段落：脚本/导航/侧栏/评论/页脚全部出局")
    func keepsArticleTextOnly() throws {
        let digest = try #require(WebClipEngine.digest(html: articleHTML, sourceURL: url("https://example.com/x")))
        #expect(digest.text.contains("七十天后总量翻倍"))
        #expect(digest.text.contains("72 有十二个因子"))
        #expect(digest.text.contains("表单之后的这一段"))
        #expect(!digest.text.contains("脚本里的文字不该出现"))
        #expect(!digest.text.contains("color:red"))
        #expect(!digest.text.contains("关于本站"))
        #expect(!digest.text.contains("侧栏推荐"))
        #expect(!digest.text.contains("评论区评论"))
        #expect(!digest.text.contains("版权所有"))
        #expect(!digest.text.contains("订阅"))
    }

    @Test("抽出的正文每行一句、无空行、无连续空格")
    func textIsNormalized() throws {
        let digest = try #require(WebClipEngine.digest(html: articleHTML, sourceURL: url("https://example.com/x")))
        #expect(!digest.text.contains("\n\n"))
        #expect(!digest.text.contains("  "))
        for line in digest.text.split(separator: "\n") {
            #expect(line.count >= 4, "短行应被丢掉：\(line)")
        }
    }

    @Test("无 article/main 的普通页面退化为整页文字")
    func fallsBackToWholeBody() throws {
        let html = """
        <html><head><title>随便一页</title></head><body>
        <div><p>这里没有语义容器，但有足够长的一段正文，用来验证退化路径。</p></div>
        <div><p>第二段同样是正文，它也应该出现。</p></div>
        </body></html>
        """
        let digest = try #require(WebClipEngine.digest(html: html, sourceURL: url("https://a.test/p")))
        #expect(digest.text.contains("这里没有语义容器"))
        #expect(digest.text.contains("第二段同样是正文"))
        #expect(digest.siteName == "a.test")
    }

    @Test("整页只有样板文字时判定为抽不到正文")
    func rejectsBoilerplateOnlyPage() {
        let html = """
        <html><body><nav><a href="/">首页</a></nav>
        <div>请登录后继续浏览，本站内容受版权保护</div>
        <footer>版权所有 2026</footer></body></html>
        """
        #expect(WebClipEngine.digest(html: html, sourceURL: url("https://b.test/")) == nil)
    }

    @Test("超长正文按行截断并标记 truncated")
    func truncatesLongText() throws {
        let paragraph = String(repeating: "复利是把双刃剑，它在前期几乎看不见效果。", count: 40)
        let html = "<html><body><article>" + String(repeating: "<p>\(paragraph)</p>", count: 10) + "</article></body></html>"
        let digest = try #require(WebClipEngine.digest(html: html, sourceURL: url("https://c.test/long")))
        #expect(digest.truncated)
        #expect(digest.text.count <= WebClipEngine.maxTextCharacters)
        #expect(digest.text.count > 3_000)
    }

    // MARK: - 容错（真实网页比理想 HTML 脏得多）

    @Test("实体解码：具名、十进制、十六进制、未配对的 &")
    func decodesEntities() {
        #expect(WebClipEngine.decodeEntities("a&amp;b") == "a&b")
        #expect(WebClipEngine.decodeEntities("&#20320;&#x597D;") == "你好")
        #expect(WebClipEngine.decodeEntities("A&nbsp;B") == "A B")
        #expect(WebClipEngine.decodeEntities("R&B 保持原样") == "R&B 保持原样")
        #expect(WebClipEngine.decodeEntities("&unknownthing;") == "&unknownthing;")
        #expect(WebClipEngine.decodeEntities("软连字符&#173;消失") == "软连字符消失")
    }

    @Test("大写标签、未加引号属性、属性里带 > 都能过")
    func toleratesMessyMarkup() throws {
        let html = """
        <HTML><BODY><ARTICLE CLASS=post>
        <P TITLE=带>号的标题>第一段：这一段要能抽出来，它足够长以通过短行过滤。</P>
        <P>第二段：这一句也要在。</P>
        </ARTICLE></BODY></HTML>
        """
        let digest = try #require(WebClipEngine.digest(html: html, sourceURL: url("https://d.test/")))
        #expect(digest.text.contains("第一段"))
        #expect(digest.text.contains("第二段"))
    }

    @Test("未闭合标签不会让后面的内容消失")
    func toleratesUnclosedTags() throws {
        let html = """
        <html><body><div id="content"><p>第一段没有闭合标签，但它后面还有内容需要被抽出来。
        <p>第二段也正常闭合。</p></div></body></html>
        """
        let digest = try #require(WebClipEngine.digest(html: html, sourceURL: url("https://e.test/")))
        #expect(digest.text.contains("第一段没有闭合标签"))
        #expect(digest.text.contains("第二段也正常闭合"))
    }

    @Test("注释里的正文不算内容")
    func ignoresComments() throws {
        let html = """
        <html><body><article><p>可见的正文段落，它需要足够长以通过短行过滤规则的检查。</p>
        <!-- 这段注释里的文字不该出现，因为它被包在注释中，长度也够长。 -->
        </article></body></html>
        """
        let digest = try #require(WebClipEngine.digest(html: html, sourceURL: url("https://f.test/")))
        #expect(!digest.text.contains("不该出现"))
    }

    @Test("脚本标签未闭合时按整段跳过到下一个结束标签")
    func handlesScriptWithoutClosing() {
        let html = "<html><head><script>var x = 1;</script></head><body><p>这一段的文字必须被正常抽取出来。</p></body></html>"
        let digest = WebClipEngine.digest(html: html, sourceURL: url("https://g.test/"))
        #expect(digest?.text.contains("这一段的文字") == true)
    }

    // MARK: - 字符集

    @Test("charset 从 HTTP 头与 meta 嗅探，未知则回落 UTF-8")
    func sniffsCharset() throws {
        #expect(WebClipEngine.charsetName(contentType: "text/html; charset=GBK") == "gbk")
        #expect(WebClipEngine.charsetName(contentType: "text/html;Charset=\"utf-8\"") == "utf-8")
        #expect(WebClipEngine.charsetName(head: Array("<html><head><meta charset=\"gbk\">".utf8)) == "gbk")
        #expect(WebClipEngine.charsetName(head: Array("<meta http-equiv=Content-Type content=\"text/html; charset=Big5\">".utf8)) == "big5")
        #expect(WebClipEngine.charsetName(head: Array("<html><body>没有声明".utf8)) == nil)
        let gbk = Array("复利的第七十天与中文正文".data(using: WebClipEngine.foundationEncoding(named: "gbk")!) ?? Data())
        #expect(WebClipEngine.decodeHTML(Array(gbk), contentType: "text/html; charset=gbk") == "复利的第七十天与中文正文")
        #expect(WebClipEngine.decodeHTML(Array("纯 UTF-8 页面".utf8), contentType: "text/html; charset=不存在的编码") == "纯 UTF-8 页面")
    }

    // MARK: - 交付物形状

    @Test("aiNote 带上标题、来源与正文；sourceLink 用 canonical")
    func shapesPromptInput() throws {
        let digest = try #require(WebClipEngine.digest(html: articleHTML, sourceURL: url("https://example.com/x")))
        #expect(digest.aiNote.contains("标题：复利的第七十天"))
        #expect(digest.aiNote.contains("来源：https://example.com/finance/compound-70"))
        #expect(digest.aiNote.contains("七十天后总量翻倍"))
        #expect(digest.sourceLink.url == "https://example.com/finance/compound-70")
        #expect(digest.sourceLink.title == "科普示例站")
    }

    @Test("元信息折行限长")
    func capsMetaLine() {
        let long = String(repeating: "长", count: 300)
        #expect(WebClipEngine.singleLine("a\n  \(long)").count == 160)
        #expect(WebClipEngine.singleLine("  多  行\n 文本  ") == "多 行 文本")
    }
}
