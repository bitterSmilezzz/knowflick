package com.knowflick.app.data

import com.knowflick.app.domain.WebClipEngine
import com.knowflick.app.domain.WebClipException
import com.knowflick.app.domain.WebClipFailure
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * 剪藏网络层的**判定逻辑**（不碰网络）：内容类型闸门、超限截断、字符集直通、请求头。
 *
 * mac 端 `WebClipFetcherTests.swift` 是同一批断言，两端口径必须一致。
 */
class WebClipFetcherTest {

    private val pageHtml = """
        <html><head><title>财务报表里的商誉</title></head>
        <body><article><p>商誉只有在被收购方业绩不及预期时才会暴露成一次性亏损，这是它最反直觉的地方。</p>
        <p>减值测试每年做一次，但管理层有动机把资产组划大，从而用未来现金流掩盖当下的下滑。</p></article></body></html>
    """.trimIndent()

    @Test
    fun onlyHTMLLikeResponsesAreParsed() {
        assertTrue(WebClipFetcher.isHTMLContent("text/html; charset=utf-8"))
        assertTrue(WebClipFetcher.isHTMLContent("application/xhtml+xml"))
        assertTrue(WebClipFetcher.isHTMLContent(null))       // 缺头时交给正文判定
        assertTrue(WebClipFetcher.isHTMLContent("text/plain"))
        assertFalse(WebClipFetcher.isHTMLContent("application/pdf"))
        assertFalse(WebClipFetcher.isHTMLContent("image/png"))
        assertFalse(WebClipFetcher.isHTMLContent("application/json"))
    }

    @Test
    fun nonHTMLBodyIsRejectedWithReadableError() {
        val bytes = pageHtml.toByteArray(Charsets.UTF_8)
        val failure = runCatching {
            WebClipFetcher.digestFromBytes(bytes, "application/pdf", "https://a.test/x.pdf")
        }.exceptionOrNull() as? WebClipException
        assertEquals(WebClipFailure.NOT_HTML, failure?.failure)
    }

    @Test
    fun pageBeyondSizeCapIsParsedAsPrefixAndMarkedTruncated() {
        val padded = pageHtml + " ".repeat(WebClipEngine.MAX_HTML_BYTES - pageHtml.toByteArray(Charsets.UTF_8).size + 1)
        val digest = WebClipFetcher.digestFromBytes(padded.toByteArray(Charsets.UTF_8), "text/html", "https://b.test/long")
        assertTrue(digest.truncated)
        assertTrue(digest.text.contains("商誉只有在被收购方"))
    }

    @Test
    fun gbkPageIsDecodedBeforeExtraction() {
        val bytes = pageHtml.toByteArray(charset("GBK"))
        val digest = WebClipFetcher.digestFromBytes(bytes, "text/html; charset=gbk", "https://c.test/gbk")
        assertEquals("财务报表里的商誉", digest.title)
        assertTrue(digest.text.contains("减值测试每年做一次"))
    }

    @Test
    fun pageWithoutBodyTextFailsInsteadOfProducingEmptyCard() {
        val bytes = "<html><body><nav><a>/</a></nav><div>请登录后浏览</div></body></html>".toByteArray(Charsets.UTF_8)
        val failure = runCatching {
            WebClipFetcher.digestFromBytes(bytes, "text/html; charset=utf-8", "https://d.test/login")
        }.exceptionOrNull() as? WebClipException
        assertEquals(WebClipFailure.NO_TEXT, failure?.failure)
    }

    @Test
    fun shortBodyIsReadWithoutEOF_andLongBodyIsCappedAtLimitPlusOne() {
        // 回归：readByteString(n) 的语义是「读满 n 字节」，正文短于 n 会抛 EOFException，
        // 表现为「站点已经返回 200，App 却报网络异常」（模拟器实测到过）。
        val small = okio.Buffer().write(pageHtml.toByteArray(Charsets.UTF_8))
        assertEquals(pageHtml.toByteArray(Charsets.UTF_8).size, WebClipFetcher.readCapped(small).size)

        val huge = okio.Buffer().write(ByteArray(WebClipEngine.MAX_HTML_BYTES + 500))
        assertEquals(WebClipEngine.MAX_HTML_BYTES + 1, WebClipFetcher.readCapped(huge).size)

        val failure = runCatching { WebClipFetcher.readCapped(null) }.exceptionOrNull() as? WebClipException
        assertEquals(WebClipFailure.NETWORK, failure?.failure)
    }

    @Test
    fun networkErrorsBecomeReadableChineseCopy() {
        val cleartext = WebClipFetcher.networkFailure(
            java.net.UnknownServiceException("CLEARTEXT communication to 10.0.2.2 not permitted by network security policy")
        )
        assertEquals(WebClipFailure.NETWORK, cleartext.failure)
        assertTrue(cleartext.message!!.contains("https"))

        val timeout = WebClipFetcher.networkFailure(java.net.SocketTimeoutException("timeout"))
        assertTrue(timeout.message!!.contains("超时"))

        val plain = WebClipFetcher.networkFailure(java.io.IOException("Connection reset"))
        assertTrue(plain.message!!.contains("Connection reset"))
    }

    @Test
    fun requestIsAnonymousGetWithBrowserUA() {
        val link = WebClipEngine.validatedLink("https://example.com/post?a=1")
        val request = WebClipFetcher.makeRequest(link)
        assertEquals("GET", request.method)
        assertEquals("https://example.com/post?a=1", request.url.toString())
        assertTrue(request.header("User-Agent")!!.contains("KnowFlick"))
        // 只读匿名抓取：绝不带 Cookie，也不接收 Set-Cookie
        assertEquals(null, request.header("Cookie"))
    }
}
