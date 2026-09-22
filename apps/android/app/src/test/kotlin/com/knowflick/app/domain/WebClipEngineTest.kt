package com.knowflick.app.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * 网页剪藏内核测试。
 *
 * 断言的是**双端共同契约**：期望值全部写成字面量，且夹具 HTML 与 mac 端
 * `WebClipEngineTests.swift` 逐字相同。同一链接在手机与桌面必须抽出同样的标题与正文，
 * 任何一端改规则而没有同步，这里或那里会红。
 */
class WebClipEngineTest {

    // MARK: - 链接校验

    @Test
    fun bareDomainGetsHttpsAndExplicitSchemeIsKept() {
        assertEquals("https", WebClipEngine.validatedLink("example.com/post").scheme)
        assertEquals("http", WebClipEngine.validatedLink("http://example.com").scheme)
        assertEquals("https://a.test/x", WebClipEngine.validatedLink("  https://a.test/x  ").absolute)
    }

    @Test
    fun unsafeLinksAreRejected() {
        assertEquals("ftp", failureOf("ftp://example.com/file")?.detail)
        assertEquals("javascript", failureOf("javascript:alert(1)")?.detail)
        assertEquals(WebClipFailure.BLANK, failureOf("   ")?.failure)
        assertEquals(WebClipFailure.MISSING_HOST, failureOf("https://")?.failure)
        // 带 userinfo 的链接会把凭据原样写进卡片来源链接，必须拒绝
        assertEquals(WebClipFailure.HAS_CREDENTIALS, failureOf("https://user:pw@example.com/x")?.failure)
        assertEquals(WebClipFailure.UNSUPPORTED_SCHEME, failureOf("mailto:someone@example.com")?.failure)
        assertEquals("mailto", failureOf("mailto:someone@example.com")?.detail)
    }

    @Test
    fun hostPortIsNotMistakenForAScheme() {
        assertEquals("8080", WebClipEngine.validatedLink("example.com:8080/x").port)
        assertEquals("localhost", WebClipEngine.validatedLink("localhost:8080/x").host)
        assertEquals(WebClipFailure.UNSUPPORTED_SCHEME, failureOf("tel:12345")?.failure)
        assertEquals("tel", failureOf("tel:12345")?.detail)
    }

    @Test
    fun shareTextYieldsFirstLinkWithoutTrailingPunctuation() {
        assertEquals("https://example.com/a", WebClipEngine.firstURL("强烈推荐这篇 https://example.com/a。"))
        assertEquals("http://a.test/1", WebClipEngine.firstURL("看这个 http://a.test/1 和 http://b.test/2"))
        assertNull(WebClipEngine.firstURL("没有链接"))
        assertEquals("https://c.test/x", WebClipEngine.firstURL("<https://c.test/x>"))
    }

    private fun failureOf(raw: String): WebClipException? =
        try {
            WebClipEngine.validatedLink(raw)
            null
        } catch (e: WebClipException) {
            e
        }

    // MARK: - 正文抽取

    private val articleHTML = """
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
    """.trimIndent()

    private val articleLink = WebClipEngine.validatedLink("https://example.com/anything")

    @Test
    fun headMetadataIsExtracted() {
        val digest = WebClipEngine.digest(articleHTML, articleLink) ?: return fail("应能抽到正文")
        assertEquals("复利的第七十天 & 一个反直觉的结论", digest.title)
        assertEquals("科普示例站", digest.siteName)
        assertEquals("为什么 1% 的日增长在 70 天后会翻倍", digest.description)
        assertEquals("https://example.com/finance/compound-70", digest.pageURL)
        assertEquals("https://example.com/anything", digest.sourceURL)
    }

    @Test
    fun onlyArticleParagraphsSurvive() {
        val digest = WebClipEngine.digest(articleHTML, articleLink) ?: return fail("应能抽到正文")
        assertTrue(digest.text.contains("七十天后总量翻倍"))
        assertTrue(digest.text.contains("72 有十二个因子"))
        assertTrue(digest.text.contains("表单之后的这一段"))
        assertFalse(digest.text.contains("脚本里的文字不该出现"))
        assertFalse(digest.text.contains("color:red"))
        assertFalse(digest.text.contains("关于本站"))
        assertFalse(digest.text.contains("侧栏推荐"))
        assertFalse(digest.text.contains("评论区评论"))
        assertFalse(digest.text.contains("版权所有"))
        assertFalse(digest.text.contains("订阅"))
    }

    @Test
    fun textHasNoBlankLinesOrDoubleSpaces() {
        val digest = WebClipEngine.digest(articleHTML, articleLink) ?: return fail("应能抽到正文")
        assertFalse(digest.text.contains("\n\n"))
        assertFalse(digest.text.contains("  "))
        for (line in digest.text.split('\n')) {
            assertTrue("短行应被丢掉：$line", line.length >= 4)
        }
    }

    @Test
    fun plainPageFallsBackToWholeBody() {
        val html = """
        <html><head><title>随便一页</title></head><body>
        <div><p>这里没有语义容器，但有足够长的一段正文，用来验证退化路径。</p></div>
        <div><p>第二段同样是正文，它也应该出现。</p></div>
        </body></html>
        """.trimIndent()
        val digest = WebClipEngine.digest(html, WebClipEngine.validatedLink("https://a.test/p"))
            ?: return fail("应能抽到正文")
        assertTrue(digest.text.contains("这里没有语义容器"))
        assertTrue(digest.text.contains("第二段同样是正文"))
        assertEquals("a.test", digest.siteName)
    }

    @Test
    fun boilerplateOnlyPageIsRejected() {
        val html = """
        <html><body><nav><a href="/">首页</a></nav>
        <div>请登录后继续浏览，本站内容受版权保护</div>
        <footer>版权所有 2026</footer></body></html>
        """.trimIndent()
        assertNull(WebClipEngine.digest(html, WebClipEngine.validatedLink("https://b.test/")))
    }

    @Test
    fun longArticleIsTruncatedAtLineBoundary() {
        val paragraph = "复利是把双刃剑，它在前期几乎看不见效果。".repeat(40)
        val html = "<html><body><article>" +
            List(10) { "<p>$paragraph</p>" }.joinToString("") +
            "</article></body></html>"
        val digest = WebClipEngine.digest(html, WebClipEngine.validatedLink("https://c.test/long"))
            ?: return fail("应能抽到正文")
        assertTrue(digest.truncated)
        assertTrue(digest.text.length <= WebClipEngine.MAX_TEXT_CHARACTERS)
        assertTrue(digest.text.length > 3_000)
    }

    // MARK: - 容错（真实网页比理想 HTML 脏得多）

    @Test
    fun entitiesDecodeNamedDecimalHexAndBareAmpersand() {
        assertEquals("a&b", WebClipEngine.decodeEntities("a&amp;b"))
        assertEquals("你好", WebClipEngine.decodeEntities("&#20320;&#x597D;"))
        assertEquals("A B", WebClipEngine.decodeEntities("A&nbsp;B"))
        assertEquals("R&B 保持原样", WebClipEngine.decodeEntities("R&B 保持原样"))
        assertEquals("&unknownthing;", WebClipEngine.decodeEntities("&unknownthing;"))
        assertEquals("软连字符消失", WebClipEngine.decodeEntities("软连字符&#173;消失"))
    }

    @Test
    fun uppercaseTagsUnquotedAttributesAndAngleBracketInsideValue() {
        val html = """
        <HTML><BODY><ARTICLE CLASS=post>
        <P TITLE=带>号的标题>第一段：这一段要能抽出来，它足够长以通过短行过滤。</P>
        <P>第二段：这一句也要在。</P>
        </ARTICLE></BODY></HTML>
        """.trimIndent()
        val digest = WebClipEngine.digest(html, WebClipEngine.validatedLink("https://d.test/"))
            ?: return fail("应能抽到正文")
        assertTrue(digest.text.contains("第一段"))
        assertTrue(digest.text.contains("第二段"))
    }

    @Test
    fun unclosedTagsDoNotSwallowLaterContent() {
        val html = """
        <html><body><div id="content"><p>第一段没有闭合标签，但它后面还有内容需要被抽出来。
        <p>第二段也正常闭合。</p></div></body></html>
        """.trimIndent()
        val digest = WebClipEngine.digest(html, WebClipEngine.validatedLink("https://e.test/"))
            ?: return fail("应能抽到正文")
        assertTrue(digest.text.contains("第一段没有闭合标签"))
        assertTrue(digest.text.contains("第二段也正常闭合"))
    }

    @Test
    fun commentedOutTextIsNotContent() {
        val html = """
        <html><body><article><p>可见的正文段落，它需要足够长以通过短行过滤规则的检查。</p>
        <!-- 这段注释里的文字不该出现，因为它被包在注释中，长度也够长。 -->
        </article></body></html>
        """.trimIndent()
        val digest = WebClipEngine.digest(html, WebClipEngine.validatedLink("https://f.test/"))
            ?: return fail("应能抽到正文")
        assertFalse(digest.text.contains("不该出现"))
    }

    @Test
    fun scriptInHeadDoesNotAffectBody() {
        val html = "<html><head><script>var x = 1;</script></head><body><p>这一段的文字必须被正常抽取出来。</p></body></html>"
        val digest = WebClipEngine.digest(html, WebClipEngine.validatedLink("https://g.test/"))
        assertTrue(digest?.text?.contains("这一段的文字") == true)
    }

    // MARK: - 字符集

    @Test
    fun charsetIsSniffedWithUTF8Fallback() {
        assertEquals("gbk", WebClipEngine.charsetFromContentType("text/html; charset=GBK"))
        assertEquals("utf-8", WebClipEngine.charsetFromContentType("text/html;Charset=\"utf-8\""))
        assertEquals("gbk", WebClipEngine.charsetFromHead("<html><head><meta charset=\"gbk\">"))
        assertEquals("big5", WebClipEngine.charsetFromHead("<meta http-equiv=Content-Type content=\"text/html; charset=Big5\">"))
        assertNull(WebClipEngine.charsetFromHead("<html><body>没有声明"))
        val gbk = "复利的第七十天与中文正文".toByteArray(charset("GBK"))
        assertEquals("复利的第七十天与中文正文", WebClipEngine.decodeHTML(gbk, "text/html; charset=gbk"))
        assertEquals(
            "纯 UTF-8 页面",
            WebClipEngine.decodeHTML("纯 UTF-8 页面".toByteArray(Charsets.UTF_8), "text/html; charset=不存在的编码")
        )
    }

    // MARK: - 交付物形状

    @Test
    fun aiNoteCarriesTitleAndSource() {
        val digest = WebClipEngine.digest(articleHTML, articleLink) ?: return fail("应能抽到正文")
        assertTrue(digest.aiNote.contains("标题：复利的第七十天"))
        assertTrue(digest.aiNote.contains("来源：https://example.com/finance/compound-70"))
        assertTrue(digest.aiNote.contains("七十天后总量翻倍"))
        assertEquals("https://example.com/finance/compound-70", digest.sourceLink.url)
        assertEquals("科普示例站", digest.sourceLink.title)
    }

    @Test
    fun metaLineIsCollapsedAndCapped() {
        val long = "长".repeat(300)
        assertEquals(160, WebClipEngine.singleLine("a\n  $long").length)
        assertEquals("多 行 文本", WebClipEngine.singleLine("  多  行\n 文本  "))
    }
}
