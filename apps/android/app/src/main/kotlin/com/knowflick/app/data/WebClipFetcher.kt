package com.knowflick.app.data

import com.knowflick.app.domain.WebClipDigest
import com.knowflick.app.domain.WebClipEngine
import com.knowflick.app.domain.WebClipException
import com.knowflick.app.domain.WebClipFailure
import com.knowflick.app.net.executeCancellable
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.CookieJar
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * 剪藏的网络出口：只发 GET、不带任何本地凭据、限大小限时长。
 *
 * 与 mac 端 `KnowFlickCore/Services/WebClipFetcher.swift` 同一口径（同一 URL 双端应得到
 * 同一 digest）。抓取本身不进单测（依赖外网可达性），因此把**所有判定**下沉到
 * [digestFromBytes] 这个纯函数里离线测，网络层只负责搬运字节。
 */
object WebClipFetcher {
    /** 与真实浏览器同族 UA：不少站点会对无 UA 或纯 App UA 的请求返回精简页甚至直接拦截 */
    const val USER_AGENT =
        "Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 KnowFlick/1.0"

    const val CONNECT_TIMEOUT_SECONDS = 10L
    const val READ_TIMEOUT_SECONDS = 15L

    private val client by lazy {
        OkHttpClient.Builder()
            // 剪藏是匿名只读抓取：不带 Cookie、不存 Cookie，也不接收 Set-Cookie
            .cookieJar(CookieJar.NO_COOKIES)
            .connectTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .readTimeout(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .callTimeout(CONNECT_TIMEOUT_SECONDS + READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .followRedirects(true)
            .retryOnConnectionFailure(true)
            .build()
    }

    /** 允许当正文解析的响应类型。PDF/图片/JSON 走这条路径只会抽出乱码。 */
    fun isHTMLContent(contentType: String?): Boolean {
        val raw = contentType?.lowercase() ?: return true  // 缺头时交给正文判定
        val media = raw.substringBefore(';').trim()
        return media.isEmpty() || media.contains("html") || media.contains("xml") || media == "text/plain"
    }

    fun makeRequest(link: WebClipEngine.Link): Request = Request.Builder()
        .url(link.absolute)
        .get()
        .header("User-Agent", USER_AGENT)
        .header("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1")
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.6")
        .build()

    /** 抓链接并抽正文。`text` 可以是分享面板里的「正文 + 链接」混排文本。 */
    suspend fun clip(text: String): WebClipDigest {
        val link = WebClipEngine.validatedLink(WebClipEngine.firstURL(text) ?: text)
        val request = makeRequest(link)
        return withContext(Dispatchers.IO) {
            try {
                client.executeCancellable(request) { response ->
                    if (!response.isSuccessful) {
                        // 3xx 由客户端自动跟随；走到这里说明是 4xx/5xx 或重定向环
                        throw WebClipException(WebClipFailure.HTTP_STATUS, response.code.toString())
                    }
                    digestFromBytes(readCapped(response.body?.source()), response.header("Content-Type"), link.absolute)
                }
            } catch (e: WebClipException) {
                throw e
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                throw networkFailure(e)
            }
        }
    }

    /**
     * 读上限 +1 字节：多出来的那一字节就是「页面超限」的证据，同时避免超大响应吃光内存。
     *
     * 不能直接 `readByteString(n)`——那是「读满 n 字节」的语义，正文短于 n 时会抛
     * EOFException（模拟器实测：站点已返回 200，App 却报「网络异常」）。先 request()
     * 到 EOF 或攒够上限，再按缓冲区实际大小读。
     */
    internal fun readCapped(source: okio.BufferedSource?): ByteArray {
        source ?: throw WebClipException(WebClipFailure.NETWORK, "无响应体")
        source.request(WebClipEngine.MAX_HTML_BYTES.toLong() + 1L)
        return source.readByteString(minOf(source.buffer.size, WebClipEngine.MAX_HTML_BYTES.toLong() + 1L)).toByteArray()
    }

    /** 把底层异常翻成用户能看懂的话（错误文案不该是一串 Java 类名） */
    internal fun networkFailure(error: Exception): WebClipException = when {
        // 本 App 的 network security config 只对回环放开明文 HTTP
        error is java.net.UnknownServiceException && error.message?.contains("CLEARTEXT") == true ->
            WebClipException(WebClipFailure.NETWORK, "该站点禁止明文访问，请改用 https 链接")
        error is java.net.SocketTimeoutException ->
            WebClipException(WebClipFailure.NETWORK, "抓取超时（${CONNECT_TIMEOUT_SECONDS + READ_TIMEOUT_SECONDS} 秒）")
        else -> WebClipException(WebClipFailure.NETWORK, error.message ?: "连接失败")
    }

    /** 纯函数：字节 → digest。大小上限、内容类型、抽不到正文都在这里判定，可离线测试。 */
    fun digestFromBytes(bytes: ByteArray, contentType: String?, sourceURL: String): WebClipDigest {
        if (!isHTMLContent(contentType)) throw WebClipException(WebClipFailure.NOT_HTML)
        val capped = bytes.size > WebClipEngine.MAX_HTML_BYTES
        val source = if (capped) bytes.copyOf(WebClipEngine.MAX_HTML_BYTES) else bytes
        val html = WebClipEngine.decodeHTML(source, contentType)
        val parsed = WebClipEngine.digest(html, sourceURL) ?: throw WebClipException(WebClipFailure.NO_TEXT)
        return if (capped) parsed.copy(truncated = true) else parsed
    }
}
