package com.knowflick.app.domain

/**
 * 网页剪藏内核：把一篇 HTML 抽成「可交 AI 提炼的正文 + 来源元信息」。
 *
 * 与 mac 端 `KnowFlickCore/Models/WebClipEngine.swift` 是同一套规则的双端移植版：
 * 标签黑名单、正文容器候选、样板行过滤、实体解码与截断口径必须逐条一致，否则同一链接
 * 在手机与桌面会剪出不同内容。改规则请同步两端并各跑一次测试
 * （用例见 `WebClipEngineTest.kt` 与 mac 的 `WebClipEngineTests.swift`）。
 *
 * 扫描按 UTF-8 字节推进：HTML 结构字符全是 ASCII，中文正文的多字节序列不会误触。
 */

/** 剪藏失败原因（文案直接给用户看） */
enum class WebClipFailure(val message: String) {
    BLANK("链接为空"),
    UNPARSEABLE("无法识别这个链接"),
    UNSUPPORTED_SCHEME("只支持 http/https"),
    MISSING_HOST("链接缺少域名"),
    HAS_CREDENTIALS("链接里带有账号密码，已拒绝"),
    TOO_LARGE("网页过大，已放弃解析"),
    NO_TEXT("没从这一页抽到正文（可能需登录，或内容全靠脚本渲染）"),
    HTTP_STATUS("站点返回了错误"),
    NOT_HTML("这个链接不是网页，抽不出正文"),
    NETWORK("取不到这个页面"),
}

class WebClipException(val failure: WebClipFailure, val detail: String = "") :
    Exception(if (detail.isEmpty()) failure.message else "${failure.message}：$detail")

/** 一次剪藏的结构化结果 */
data class WebClipDigest(
    val sourceURL: String,
    /** canonical 优先、回落到 sourceURL：入库时作为卡片的来源链接 */
    val pageURL: String,
    val title: String,
    val siteName: String,
    val description: String,
    val text: String,
    val truncated: Boolean,
) {
    /** 交 AI 提炼的正文：标题 + 网页摘要 + 正文，并显式带上来源，免得模型编出处 */
    val aiNote: String
        get() = buildString {
            if (title.isNotEmpty()) appendLine("标题：$title")
            if (description.isNotEmpty()) appendLine("网页摘要：$description")
            appendLine("来源：$pageURL")
            appendLine()
            append(text)
        }

    val sourceLink: ScienceLink
        get() = ScienceLink(title = siteName.ifEmpty { pageURL }, url = pageURL)

    /** Keep the canonical page first and remove AI links that repeat either known clip URL. */
    fun attributing(cards: List<KnowledgeCard>): List<KnowledgeCard> {
        val sourceURLs = setOf(sourceURL, sourceLink.url)
        return cards.map { card ->
            card.copy(
                links = listOf(sourceLink) + card.links.filterNot { it.url in sourceURLs },
                source = CardSource.IMPORTED,
            )
        }
    }
}

object WebClipEngine {
    /** 正文上限。刻意与 AI 提炼提示词的既有预算同量级：长文按行截断后再交模型 */
    const val MAX_TEXT_CHARACTERS = 4_000

    /** 解析输入上限：超过即放弃，防止把几十 MB 的页面读进内存 */
    const val MAX_HTML_BYTES = 4_000_000

    /** 抽到这么多有效字符就停止扫描：够提炼了，不必读完整页 */
    private const val SCAN_STOP_CHARACTERS = MAX_TEXT_CHARACTERS * 3

    // MARK: - 规则表（双端逐条对齐）

    /** 连子树一起丢掉文字的标签 */
    private val DROP_TAGS = setOf(
        "script", "style", "noscript", "template", "svg", "canvas", "iframe",
        "video", "audio", "object", "embed", "track", "map", "form", "input",
        "select", "option", "textarea", "button", "label", "nav", "header",
        "footer", "aside", "dialog", "head",
    )

    /** 自闭合标签：不能压栈，否则后面的结束标签会错位弹栈 */
    private val VOID_TAGS = setOf(
        "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "param", "source", "track", "wbr",
    )

    /** 断行标签 */
    private val BLOCK_TAGS = setOf(
        "p", "div", "li", "ul", "ol", "dl", "dd", "dt", "h1", "h2", "h3", "h4",
        "h5", "h6", "article", "section", "main", "aside", "blockquote", "pre",
        "figure", "figcaption", "table", "thead", "tbody", "tr", "td", "th", "br",
    )

    /** 语义正文标签：判候选时权重加倍 */
    private val SEMANTIC_CANDIDATE_TAGS = setOf("article", "main")

    /** id/class 命中这些词即视为正文容器候选 */
    private val CANDIDATE_HINTS = listOf(
        "articlebody", "article-body", "article-content", "post-content",
        "entry-content", "rich_text", "rich-text", "markdown-body", "main-content",
        "article", "content", "post", "entry", "story",
    )

    /** 命中即否决候选：评论区、侧栏、翻页里到处都是 "content"/"post" */
    private val CANDIDATE_VETOES = listOf(
        "comment", "sidebar", "side-bar", "footer", "header", "nav", "menu",
        "share", "related", "recommend", "promo", "advert", "breadcrumb",
        "pagination", "search", "toolbar", "tags", "reply", "vote", "toc",
    )

    /** 整行命中即丢弃的样板文案（只在短行上生效，避免误伤正文里的同名句子） */
    private val JUNK_TOKENS = listOf(
        "版权所有", "保留所有权利", "未经授权", "未经许可", "转载至", "文章来源",
        "登录查看", "扫码下载", "APP下载", "关注我们", "扫码关注", "分享到", "打赏",
        "相关推荐", "相关阅读", "下一篇", "上一篇", "返回列表", "返回顶部", "阅读原文",
        "查看原文", "订阅本文", "评论区", "Cookie", "隐私政策", "用户协议", "登录",
        "注册", "广告", "JavaScript", "copyright", "all rights reserved", "privacy",
        "terms of", "sign in", "log in", "subscribe", "newsletter", "advertisement",
        "enable javascript",
    )

    private const val JUNK_TOKEN_MAX_LINE_CHARACTERS = 48

    /** 短于此的行基本是按钮/菜单，不是知识 */
    private const val MIN_LINE_CHARACTERS = 4

    /** 元信息行长上限 */
    private const val META_LINE_CHARACTERS = 160

    private val NAMED_ENTITIES: Map<String, Char> = mapOf(
        "amp" to '&', "lt" to '<', "gt" to '>', "quot" to '"', "apos" to '\'',
        "nbsp" to ' ', "thinsp" to ' ', "ensp" to ' ', "emsp" to ' ',
        "copy" to '©', "reg" to '®', "trade" to '™', "hellip" to '…', "mdash" to '—',
        "ndash" to '–', "lsquo" to '‘', "rsquo" to '’', "ldquo" to '“', "rdquo" to '”',
        "laquo" to '«', "raquo" to '»', "middot" to '·', "bull" to '•', "deg" to '°',
        "plusmn" to '±', "times" to '×', "divide" to '÷', "frac12" to '½', "sect" to '§',
        "eacute" to 'é', "egrave" to 'è', "agrave" to 'à', "ccedil" to 'ç', "uuml" to 'ü',
        "ouml" to 'ö', "auml" to 'ä', "szlig" to 'ß',
    )

    /** 解码后什么都不留的实体 */
    private val DROPPED_ENTITIES = setOf("shy")

    // MARK: - 链接校验

    /** 解析出的链接部件（手工解析，避免 java.net.URI 对中文/端口的宽松度与 Foundation 不一致） */
    data class Link(val scheme: String, val userInfo: String?, val host: String, val port: String, val rest: String) {
        val origin: String get() = "$scheme://$host" + (if (port.isEmpty()) "" else ":$port")
        val absolute: String get() = origin + rest
    }

    /** 只接受纯 http/https；带 userinfo 一律拒绝（否则凭据会被写进卡片来源链接） */
    @Throws(WebClipException::class)
    fun validatedLink(raw: String): Link {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) throw WebClipException(WebClipFailure.BLANK)
        explicitNonHTTPScheme(trimmed)?.let { throw WebClipException(WebClipFailure.UNSUPPORTED_SCHEME, it) }
        val candidate = if (trimmed.contains("://")) trimmed else "https://$trimmed"
        val link = parseLink(candidate) ?: throw WebClipException(WebClipFailure.UNPARSEABLE)
        if (link.scheme != "http" && link.scheme != "https") {
            throw WebClipException(WebClipFailure.UNSUPPORTED_SCHEME, link.scheme)
        }
        if (link.host.isEmpty()) throw WebClipException(WebClipFailure.MISSING_HOST)
        if (!link.userInfo.isNullOrEmpty()) throw WebClipException(WebClipFailure.HAS_CREDENTIALS)
        return link
    }

    /** 冒号前像协议、冒号后既不是 // 也不是「带点主机名:端口」时，判定为用户显式写了非 http 协议 */
    internal fun explicitNonHTTPScheme(text: String): String? {
        val colon = text.indexOf(':')
        if (colon <= 0) return null
        val head = text.substring(0, colon)
        if (head.contains('/')) return null
        if (!head.all { it.isLetterOrDigit() || it == '+' || it == '-' || it == '.' }) return null
        val tail = text.substring(colon + 1)
        if (tail.startsWith("//")) return null
        // host:port 只在 head 真的像主机名时成立；否则 `tel:12345` 会被当成 http://tel:12345
        if (tail.isNotEmpty() && tail[0].isDigit() && (head.contains('.') || head.lowercase() == "localhost")) return null
        val lowered = head.lowercase()
        return if (lowered == "http" || lowered == "https") null else lowered
    }

    /** scheme://[userInfo@]host[:port][/rest]；不合规返回 null */
    internal fun parseLink(text: String): Link? {
        val schemeEnd = text.indexOf("://")
        if (schemeEnd <= 0) return null
        val scheme = text.substring(0, schemeEnd).lowercase()
        if (scheme.isEmpty() || !scheme[0].isLetter()) return null
        var i = schemeEnd + 3
        val authorityEnd = text.indexOfFirstFrom(i) { it == '/' || it == '?' || it == '#' }
            .let { if (it < 0) text.length else it }
        val authority = text.substring(i, authorityEnd)
        val at = authority.lastIndexOf('@')
        val userInfo = if (at >= 0) authority.substring(0, at) else null
        val hostPort = if (at >= 0) authority.substring(at + 1) else authority
        val colon = hostPort.lastIndexOf(':')
        val host = if (colon >= 0) hostPort.substring(0, colon) else hostPort
        val port = if (colon >= 0) hostPort.substring(colon + 1) else ""
        return Link(
            scheme = scheme,
            userInfo = userInfo,
            host = host.lowercase(),
            port = port,
            rest = text.substring(authorityEnd),
        )
    }

    private inline fun String.indexOfFirstFrom(start: Int, predicate: (Char) -> Boolean): Int {
        for (k in start until length) if (predicate(this[k])) return k
        return -1
    }

    /** 分享面板常收到「正文 + 链接」混排文本，取第一个 http(s) 链接 */
    fun firstURL(text: String): String? {
        val delimiters = charArrayOf(' ', '\t', '\n', '\r', '<', '>', '"', '\'', '(', ')', '[', ']', ',', ';', '{', '}', '|')
        val trailing = charArrayOf('.', '。', '，', ',', '、', '！', '?', '”', '»', ')', ']', '}', ':')
        for (rawToken in text.split(*delimiters)) {
            var token = rawToken
            while (token.isNotEmpty() && trailing.contains(token.last())) token = token.dropLast(1)
            val lowered = token.lowercase()
            if (lowered.startsWith("http://") || lowered.startsWith("https://")) return token
        }
        return null
    }

    /** canonical 之类的相对地址解析成绝对地址 */
    internal fun resolve(href: String, base: Link): String {
        val trimmed = href.trim()
        if (trimmed.isEmpty()) return base.absolute
        val lowered = trimmed.lowercase()
        if (lowered.startsWith("http://") || lowered.startsWith("https://")) return trimmed
        if (trimmed.startsWith("//")) return "${base.scheme}:$trimmed"
        if (trimmed.startsWith("/")) return base.origin + trimmed
        val queryCut = trimmed.indexOfFirst { it == '?' || it == '#' }
        val pathPart = if (queryCut < 0) trimmed else trimmed.substring(0, queryCut)
        val suffix = if (queryCut < 0) "" else trimmed.substring(queryCut)
        val baseDir = base.rest.substringBeforeLast('/', "")
        return base.origin + baseDir + "/" + pathPart + suffix
    }

    // MARK: - 抽取

    /** 从 HTML 抽正文；抽不到文字返回 null（调用方负责给出可读失败） */
    fun digest(html: String, sourceURL: String): WebClipDigest? {
        val link = parseLink(if (sourceURL.contains("://")) sourceURL else "https://$sourceURL") ?: return null
        return digest(html, link)
    }

    fun digest(html: String, base: Link): WebClipDigest? {
        val bytes = html.toByteArray(Charsets.UTF_8)
        if (bytes.size > MAX_HTML_BYTES) return null
        val out = TextCollector(SCAN_STOP_CHARACTERS)
        val frames = ArrayList<String>()
        val openCandidates = ArrayList<Candidate>()
        val candidates = ArrayList<Candidate>()
        var dropDepth = 0
        var capturingTitle = false
        var rawTitle = ""
        var canonical: String? = null
        var ogTitle = ""
        var siteName = ""
        var pageDescription = ""
        var i = 0

        while (i < bytes.size) {
            if (bytes[i].toInt() != LT) {
                var end = i
                while (end < bytes.size && bytes[end].toInt() != LT) end++
                val chunk = decodeEntities(String(bytes, i, end - i, Charsets.UTF_8))
                if (capturingTitle) {
                    val piece = singleLine(chunk)
                    if (piece.length > rawTitle.length) rawTitle = piece
                } else if (dropDepth == 0) {
                    out.append(chunk)
                }
                i = end
                continue
            }

            if (matches(bytes, i, "<!--")) {
                val close = indexOf(bytes, i + 4, GT)
                if (close < 0) break
                i = close + 1
                continue
            }
            if (matches(bytes, i, "<!") || matches(bytes, i, "<?")) {
                val close = indexOf(bytes, i + 2, GT)
                if (close < 0) break
                i = close + 1
                continue
            }
            val tag = parseTag(bytes, i) ?: break
            i = tag.nextIndex
            if (out.hitLimit) break

            if (tag.isClosing) {
                if (tag.name == "title") capturingTitle = false
                val depth = frames.lastIndexOf(tag.name)
                if (depth >= 0) {
                    while (frames.size > depth) {
                        val popped = frames.removeAt(frames.size - 1)
                        if (popped in DROP_TAGS) dropDepth--
                        if (openCandidates.lastOrNull()?.tag == popped) {
                            val top = openCandidates.removeAt(openCandidates.size - 1)
                            if (!top.vetoed) {
                                top.end = out.count
                                candidates.add(top)
                            }
                        }
                    }
                }
                continue
            }

            val isVoid = tag.name in VOID_TAGS
            if (!isVoid) frames.add(tag.name)
            if (tag.name in DROP_TAGS && !isVoid && !tag.selfClosing) dropDepth++
            if (tag.name == "title" && !isVoid && !tag.selfClosing) {
                capturingTitle = true
                continue
            }

            if (tag.name == "meta" || tag.name == "link") {
                val rel = (tag.attributes["rel"] ?: "").lowercase()
                if (tag.name == "link" && rel == "canonical") {
                    val href = tag.attributes["href"] ?: ""
                    if (href.isNotEmpty()) canonical = resolve(href, base)
                }
                val key = (tag.attributes["property"] ?: tag.attributes["name"] ?: "").lowercase()
                val value = tag.attributes["content"] ?: ""
                when (key) {
                    "og:title" -> if (value.length > ogTitle.length) ogTitle = value
                    "og:site_name" -> if (siteName.isEmpty()) siteName = value
                    "og:description", "description", "twitter:description" ->
                        if (value.length > pageDescription.length) pageDescription = value
                }
                continue
            }

            if (tag.name in BLOCK_TAGS) out.newline()
            if (!isVoid && !tag.selfClosing) {
                val lowered = ("${tag.attributes["id"] ?: ""} ${tag.attributes["class"] ?: ""}").lowercase()
                if (isCandidateContainer(tag.name, lowered)) {
                    openCandidates.add(
                        Candidate(
                            tag = tag.name,
                            start = out.count,
                            vetoed = CANDIDATE_VETOES.any { lowered.contains(it) },
                        )
                    )
                }
            }
        }

        // 未闭合的候选容器按当前位置收口
        while (openCandidates.isNotEmpty()) {
            val top = openCandidates.removeAt(openCandidates.size - 1)
            if (!top.vetoed) {
                top.end = out.count
                candidates.add(top)
            }
        }

        val finalized = finalizeText(chooseText(candidates, out.text))
        if (finalized.text.isEmpty()) return null

        val og = singleLine(ogTitle)
        val site = singleLine(siteName)
        return WebClipDigest(
            sourceURL = base.absolute,
            pageURL = canonical ?: base.absolute,
            title = if (rawTitle.length >= og.length) rawTitle else og,
            siteName = site.ifEmpty { base.host.removePrefix("www.") },
            description = singleLine(pageDescription),
            text = finalized.text,
            truncated = finalized.truncated,
        )
    }

    internal class Candidate(val tag: String, val start: Int, var end: Int = 0, val vetoed: Boolean) {
        val length: Int get() = maxOf(0, end - start)
    }

    internal fun isCandidateContainer(tag: String, loweredAttributes: String): Boolean {
        if (tag in SEMANTIC_CANDIDATE_TAGS) return true
        return CANDIDATE_HINTS.any { loweredAttributes.contains(it) }
    }

    /** 正文容器要占整页文字一半以上才采信，否则整页更可靠（内容分散型页面如维基） */
    internal fun chooseText(candidates: List<Candidate>, full: String): String {
        val best = candidates.maxByOrNull { it.length } ?: return full
        if (best.length <= 0) return full
        val boosted = best.length * (if (best.tag in SEMANTIC_CANDIDATE_TAGS) 2 else 1)
        if (boosted * 2 < full.length) return full
        val from = minOf(best.start, full.length)
        return full.substring(from, minOf(best.end, full.length))
    }

    class FinalizedText(val text: String, val truncated: Boolean)

    /** 逐行清洗：丢短行与样板行，再按字数上限截断（不切半行） */
    internal fun finalizeText(raw: String): FinalizedText {
        val kept = ArrayList<String>()
        for (slice in raw.split('\n', '\r')) {
            val line = slice.trim()
            if (line.length < MIN_LINE_CHARACTERS) continue
            if (isJunkLine(line)) continue
            kept.add(line)
        }
        val result = StringBuilder()
        var used = 0
        for (line in kept) {
            val cost = line.length + if (result.isEmpty()) 0 else 1
            if (used + cost > MAX_TEXT_CHARACTERS) {
                // 一行都放不下时至少留个开头，别让整篇变空
                return FinalizedText(
                    text = if (result.isEmpty()) line.substring(0, minOf(line.length, MAX_TEXT_CHARACTERS)) else result.toString(),
                    truncated = true,
                )
            }
            if (result.isNotEmpty()) result.append('\n')
            result.append(line)
            used += cost
        }
        return FinalizedText(result.toString(), false)
    }

    internal fun isJunkLine(line: String): Boolean {
        if (line.length > JUNK_TOKEN_MAX_LINE_CHARACTERS) return false
        val lowered = line.lowercase()
        return JUNK_TOKENS.any { lowered.contains(it) }
    }

    /** 元信息与 `<title>`：折成一行、限长 */
    fun singleLine(raw: String): String {
        // 先把 NBSP 折成普通空格：Swift 的 .whitespacesAndNewlines 含 NBSP，Java 的 \s 不含
        val collapsed = raw.replace('\u00A0', ' ').trim().split(Regex("\\s+")).joinToString(" ")
        return collapsed.substring(0, minOf(collapsed.length, META_LINE_CHARACTERS))
    }

    /** 不可见字符：软连字符与零宽/方向标记留着会让正文出现「看不见但影响检索」的字节 */
    internal fun isInvisible(c: Char): Boolean =
        c == '\u00AD' || c in '\u200B'..'\u200F' || c == '\u2028' || c == '\u2029' ||
            c in '\u202A'..'\u202E' || c == '\uFEFF'

    // MARK: - 文本缓冲（HTML 空白折叠）

    /** 连续空白折成一个分隔符：源码里的换行缩进不该变成空行 */
    private class TextCollector(private val limit: Int) {
        private val buffer = StringBuilder()
        val text: String get() = buffer.toString()
        var count = 0
            private set
        var hitLimit = false
            private set
        private var pendingSpace = false
        private var sawNewline = false

        fun append(chunk: String) {
            for (c in chunk) {
                if (c == '\n') {
                    sawNewline = true
                    pendingSpace = true
                    continue
                }
                if (c == ' ' || c == '\t' || c == '\r' || c == '\u000C' || c == '\u00A0') {
                    pendingSpace = true
                    continue
                }
                if (c.code in 0..0x1F) continue  // 其余 C0 控制字符是网页垃圾字节
                if (isInvisible(c)) continue
                flushSpace()
                if (count >= limit) {
                    hitLimit = true
                    return
                }
                buffer.append(c)
                count++
            }
        }

        fun newline() {
            flushSpace()
            if (count >= limit) {
                hitLimit = true
                return
            }
            if (buffer.isNotEmpty() && buffer.last() == '\n') return
            buffer.append('\n')
            count++
            sawNewline = false
            pendingSpace = false
        }

        private fun flushSpace() {
            if (!pendingSpace) return
            pendingSpace = false
            val separator = if (sawNewline) '\n' else ' '
            sawNewline = false
            if (count == 0 || (buffer.isNotEmpty() && buffer.last() == '\n')) return
            if (count >= limit) {
                hitLimit = true
                return
            }
            buffer.append(separator)
            count++
        }
    }

    // MARK: - 实体解码

    /** 只解 `&name;` / `&#123;` / `&#x7B;`。绝不吞正文里正常的 `&` */
    fun decodeEntities(raw: String): String {
        if (!raw.contains('&')) return raw
        val out = StringBuilder(raw.length)
        var i = 0
        while (i < raw.length) {
            val c = raw[i]
            if (c != '&') {
                if (c.code >= 0x20 || c == '\n') {
                    if (!isInvisible(c)) out.append(c)
                }
                i++
                continue
            }
            var j = i + 1
            val body = StringBuilder()
            var terminated = false
            while (j < raw.length && body.length < 12) {
                val b = raw[j]
                if (b == ';') {
                    terminated = true
                    break
                }
                if (b == '&' || b == '<' || b == ' ' || b == '\n') break
                body.append(b)
                j++
            }
            if (!terminated || body.isEmpty()) {
                out.append('&')
                i++
                continue
            }
            val text = body.toString()
            if (text.startsWith("#")) {
                val hex = text.length > 1 && (text[1] == 'x' || text[1] == 'X')
                val digits = if (hex) text.substring(2) else text.substring(1)
                val value = digits.toIntOrNull(if (hex) 16 else 10)
                if (value != null && (value == 0x0A || value >= 0x20) && value <= 0x10FFFF) {
                    try {
                        val decoded = String(Character.toChars(value))
                        if (!isInvisible(decoded[0])) out.append(decoded)
                    } catch (_: IllegalArgumentException) {
                        // 代理区/越界码点：丢掉即可，正文里没有合法用途
                    }
                }
                i = j + 1
                continue
            }
            val key = text.lowercase()
            if (key in DROPPED_ENTITIES) {
                i = j + 1
                continue
            }
            val mapped = NAMED_ENTITIES[key]
            if (mapped != null) {
                out.append(mapped)
                i = j + 1
                continue
            }
            out.append('&')
            i++
        }
        return out.toString()
    }

    // MARK: - 字符集

    /** 按「HTTP 头 charset → 前 1024 字节里的 `<meta charset>` → UTF-8」的优先级解码页面字节。
     *  中文站仍有一批输出 GBK/GB2312/Big5，硬按 UTF-8 读会得到一串 ``，正文抽取也就废了。 */
    fun decodeHTML(bytes: ByteArray, contentType: String?): String {
        val head = String(bytes, 0, minOf(1024, bytes.size), Charsets.ISO_8859_1)
        val name = charsetFromContentType(contentType) ?: charsetFromHead(head)
        if (name != null) {
            val charset = try {
                java.nio.charset.Charset.forName(name)
            } catch (_: Exception) {
                null
            }
            if (charset != null) return String(bytes, charset)
        }
        return String(bytes, Charsets.UTF_8)
    }

    internal fun charsetFromContentType(contentType: String?): String? = contentType?.let { charsetValue(it) }

    /** 从页面开头嗅探 charset：`<meta charset="gbk">` 与 http-equiv 变体 */
    internal fun charsetFromHead(head: String): String? {
        for (candidate in head.lowercase().split("meta")) {
            charsetValue(candidate)?.let { return it }
        }
        return null
    }

    private fun charsetValue(text: String): String? {
        val lowered = text.lowercase()
        val at = lowered.indexOf("charset")
        if (at < 0) return null
        var i = at + "charset".length
        fun skipTrivia() {
            while (i < lowered.length && (lowered[i] == ' ' || lowered[i] == '\t' || lowered[i] == '\n')) i++
        }
        skipTrivia()
        if (i >= lowered.length || lowered[i] != '=') return null
        i++
        skipTrivia()
        if (i >= lowered.length) return null
        val quote = if (lowered[i] == '"' || lowered[i] == '\'') lowered[i] else null
        if (quote != null) i++
        val value = StringBuilder()
        while (i < lowered.length) {
            val c = lowered[i]
            if (quote != null) {
                if (c == quote) { i++; break }
            } else if (c == ';' || c == ',' || c == '"' || c == '\'' || c == '>' || c == ' ' || c == '\t' || c == '\n') {
                break
            }
            value.append(c)
            i++
        }
        val trimmed = value.toString().trim()
        return trimmed.ifEmpty { null }
    }

    // MARK: - 标签扫描

    internal class ParsedTag(
        val name: String,
        val attributes: Map<String, String>,
        val selfClosing: Boolean,
        val isClosing: Boolean,
        val nextIndex: Int,
    )

    /** 手工扫描而非正则：要能扛住属性里带 `>`、值不加引号、大小写混写的真实网页 */
    internal fun parseTag(bytes: ByteArray, start: Int): ParsedTag? {
        var i = start + 1
        var isClosing = false
        if (i < bytes.size && bytes[i].toInt() == SLASH) {
            isClosing = true
            i++
        }
        if (i >= bytes.size || !isAsciiLetter(bytes[i])) return null
        val nameBytes = ArrayList<Byte>()
        while (i < bytes.size && isAsciiNameByte(bytes[i])) {
            nameBytes.add(lowerAscii(bytes[i]))
            i++
        }
        val name = bytesOf(nameBytes).toString(Charsets.UTF_8)

        val attributes = HashMap<String, String>()
        var selfClosing = false
        while (i < bytes.size) {
            val c = bytes[i].toInt()
            if (c == GT) {
                return ParsedTag(name, attributes, selfClosing, isClosing, i + 1)
            }
            if (c == SLASH) {
                selfClosing = true
                i++
                continue
            }
            if (isAsciiWhitespace(c)) {
                i++
                continue
            }
            val keyBytes = ArrayList<Byte>()
            while (i < bytes.size && bytes[i].toInt() != EQ && bytes[i].toInt() != GT &&
                bytes[i].toInt() != SLASH && !isAsciiWhitespace(bytes[i].toInt())
            ) {
                keyBytes.add(lowerAscii(bytes[i]))
                i++
            }
            if (keyBytes.isEmpty()) {
                i++
                continue
            }
            val key = bytesOf(keyBytes).toString(Charsets.UTF_8)
            var k = i
            while (k < bytes.size && isAsciiWhitespace(bytes[k].toInt())) k++
            if (k >= bytes.size || bytes[k].toInt() != EQ) {
                attributes[key] = ""
                i = if (k > i) k else i + 1
                continue
            }
            i = k + 1
            while (i < bytes.size && isAsciiWhitespace(bytes[i].toInt())) i++
            if (i >= bytes.size) break
            val valueBytes = ArrayList<Byte>()
            val quote = bytes[i].toInt()
            if (quote == QUOTE || quote == APOS) {
                i++
                while (i < bytes.size && bytes[i].toInt() != quote) {
                    valueBytes.add(bytes[i])
                    i++
                }
                i++
            } else {
                while (i < bytes.size && bytes[i].toInt() != GT && !isAsciiWhitespace(bytes[i].toInt())) {
                    valueBytes.add(bytes[i])
                    i++
                }
            }
            attributes[key] = decodeEntities(bytesOf(valueBytes).toString(Charsets.UTF_8))
        }
        return ParsedTag(name, attributes, selfClosing, isClosing, bytes.size)
    }

    // MARK: - 字节工具

    private const val LT = 0x3C
    private const val GT = 0x3E
    private const val SLASH = 0x2F
    private const val EQ = 0x3D
    private const val QUOTE = 0x22
    private const val APOS = 0x27

    private fun bytesOf(list: List<Byte>): ByteArray {
        val array = ByteArray(list.size)
        for (k in list.indices) array[k] = list[k]
        return array
    }

    private fun matches(bytes: ByteArray, at: Int, prefix: String): Boolean {
        val p = prefix.toByteArray(Charsets.UTF_8)
        if (at + p.size > bytes.size) return false
        for (k in p.indices) if (bytes[at + k] != p[k]) return false
        return true
    }

    private fun indexOf(bytes: ByteArray, from: Int, target: Int): Int {
        var i = maxOf(0, from)
        while (i < bytes.size) {
            if (bytes[i].toInt() == target) return i
            i++
        }
        return -1
    }

    private fun isAsciiLetter(b: Byte): Boolean {
        val v = b.toInt() and 0xFF
        return v in 0x41..0x5A || v in 0x61..0x7A
    }

    private fun isAsciiNameByte(b: Byte): Boolean {
        val v = b.toInt() and 0xFF
        return v in 0x41..0x5A || v in 0x61..0x7A || v in 0x30..0x39 ||
            v == 0x2D || v == 0x3A || v == 0x2E
    }

    private fun isAsciiWhitespace(v: Int): Boolean = v == 0x20 || v == 0x09 || v == 0x0A || v == 0x0D || v == 0x0C

    private fun lowerAscii(b: Byte): Byte {
        val v = b.toInt() and 0xFF
        return if (v in 0x41..0x5A) (v + 32).toByte() else b
    }
}
