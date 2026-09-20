package com.knowflick.app.sync

import com.knowflick.app.domain.CardJson
import com.knowflick.app.domain.CardStore
import com.knowflick.app.domain.KnowledgeCard
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.charset.StandardCharsets
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

data class SyncResult(
    val pushedCount: Int,
    val pulledCount: Int,
    val addedCount: Int,
    val restoredCount: Int,
)

/** 局域网同步客户端。仅允许回环、链路本地和 RFC1918 IPv4，避免把卡库误传到公网主机。 */
object SyncClient {

    private const val CONNECT_TIMEOUT_MS = 5_000
    private const val READ_TIMEOUT_MS = 15_000
    private const val MAX_RESPONSE_BODY_BYTES = SyncServer.MAX_REQUEST_BODY_BYTES

    private data class Target(val address: InetAddress, val hostLabel: String, val port: Int, val accessCode: String)
    private data class HttpResponse(val status: Int, val body: String)

    private fun parseTarget(raw: String): Target {
        val value = raw.trim().removePrefix("http://").removePrefix("https://").removeSuffix("/")
        val endpoint = value.substringBefore('#').substringBefore('/')
        val accessCode = value.substringAfter('#', "").trim()
        require(accessCode.matches(Regex("[0-9]{6}"))) { "同步地址缺少有效的 6 位配对码" }

        val host = endpoint.substringBeforeLast(':').trim()
        val port = endpoint.substringAfterLast(':', "8998").toIntOrNull()
            ?.takeIf { it in 1..65_535 }
            ?: error("同步端口无效")
        require(host.isNotBlank()) { "同步地址无效" }

        val address = InetAddress.getAllByName(host).firstOrNull(::isPrivateLanAddress)
            ?: error("只允许连接本机或私有局域网 IPv4 地址")
        return Target(address, host, port, accessCode)
    }

    private fun isPrivateLanAddress(address: InetAddress): Boolean =
        address is Inet4Address &&
            (address.isLoopbackAddress || address.isLinkLocalAddress || address.isSiteLocalAddress)

    private fun readLine(input: BufferedInputStream): String? {
        val bytes = ByteArrayOutputStream()
        while (true) {
            val value = input.read()
            if (value == -1) return if (bytes.size() == 0) null else bytes.toString(StandardCharsets.UTF_8.name())
            if (value == '\n'.code) return bytes.toString(StandardCharsets.UTF_8.name())
            if (value != '\r'.code) {
                bytes.write(value)
                require(bytes.size() <= 8 * 1024) { "对端响应头过长" }
            }
        }
    }

    private fun request(target: Target, method: String, path: String, body: ByteArray? = null): HttpResponse {
        Socket().use { socket ->
            socket.connect(InetSocketAddress(target.address, target.port), CONNECT_TIMEOUT_MS)
            socket.soTimeout = READ_TIMEOUT_MS
            val output = socket.getOutputStream()
            val payload = body ?: ByteArray(0)
            val headers = buildString {
                append("$method $path HTTP/1.1\r\n")
                append("Host: ${target.hostLabel}:${target.port}\r\n")
                append("${SyncServer.AUTH_HEADER}: ${target.accessCode}\r\n")
                append("Accept: application/json\r\n")
                if (body != null) append("Content-Type: application/json; charset=utf-8\r\n")
                append("Content-Length: ${payload.size}\r\n")
                append("Connection: close\r\n\r\n")
            }
            output.write(headers.toByteArray(StandardCharsets.UTF_8))
            if (payload.isNotEmpty()) output.write(payload)
            output.flush()

            val input = BufferedInputStream(socket.getInputStream())
            val statusLine = readLine(input) ?: error("对端未返回响应")
            val status = statusLine.split(' ').getOrNull(1)?.toIntOrNull() ?: error("对端响应格式无效")
            var contentLength: Int? = null
            var headerCount = 0
            while (true) {
                val line = readLine(input) ?: break
                if (line.isBlank()) break
                headerCount++
                require(headerCount <= 64) { "对端响应头过多" }
                if (line.startsWith("Content-Length:", ignoreCase = true)) {
                    contentLength = line.substringAfter(':').trim().toIntOrNull()
                }
            }
            val length = contentLength ?: error("对端响应缺少 Content-Length")
            require(length in 0..MAX_RESPONSE_BODY_BYTES) { "对端响应数据过大" }
            val responseBytes = ByteArray(length)
            var offset = 0
            while (offset < length) {
                val count = input.read(responseBytes, offset, length - offset)
                if (count < 0) error("对端响应不完整")
                offset += count
            }
            return HttpResponse(status, String(responseBytes, StandardCharsets.UTF_8))
        }
    }

    private fun requestWithRetry(
        target: Target,
        method: String,
        path: String,
        body: ByteArray? = null,
        maxAttempts: Int = 3,
    ): HttpResponse {
        var lastException: Exception? = null
        for (attempt in 1..maxAttempts) {
            try {
                val response = request(target, method, path, body)
                if (response.status == 401) {
                    error("配对码错误，请核对 6 位数字配对码是否与对端一致")
                }
                if (response.status == 413) {
                    error("卡片数据超过 25 MiB 同步上限")
                }
                if (response.status in 200..299) {
                    return response
                }
                if (response.status in listOf(502, 503)) {
                    error("对端设备暂时繁忙 (HTTP ${response.status})")
                }
                error("对端设备响应错误 HTTP ${response.status}")
            } catch (e: Exception) {
                val msg = e.message.orEmpty()
                if (msg.contains("配对码错误") || msg.contains("超过 25 MiB") || msg.contains("响应头过多")) {
                    throw e
                }
                lastException = e
                if (attempt < maxAttempts) {
                    val baseDelay = 500L * (1L shl (attempt - 1))
                    val jitter = (Math.random() * 100).toLong()
                    try {
                        Thread.sleep(baseDelay + jitter)
                    } catch (_: InterruptedException) {}
                }
            }
        }
        val ex = lastException ?: IllegalStateException("同步请求失败")
        when (ex) {
            is java.net.SocketTimeoutException -> throw java.net.SocketTimeoutException("连接对端超时，请检查两端是否在同一 Wi-Fi 或检查局域网防火墙配置")
            is java.net.ConnectException -> throw java.net.ConnectException("无法连接到对端设备，请确认对端已开启「接收服务」且两端连接至同一 Wi-Fi")
            else -> throw ex
        }
    }

    suspend fun fetchRemoteInfo(target: String): Result<RemoteDeviceInfo> = withContext(Dispatchers.IO) {
        runCatching {
            val response = requestWithRetry(parseTarget(target), "GET", "/api/info")
            if (response.status !in 200..299) error("对端设备响应错误 HTTP ${response.status}")
            val obj = Json.parseToJsonElement(response.body).jsonObject
            RemoteDeviceInfo(
                deviceName = obj["deviceName"]?.jsonPrimitive?.content ?: "未知设备",
                cardCount = obj["cardCount"]?.jsonPrimitive?.intOrNull ?: 0,
                favoriteCount = obj["favoriteCount"]?.jsonPrimitive?.intOrNull ?: 0,
                timestamp = obj["timestamp"]?.jsonPrimitive?.longOrNull ?: 0L,
            )
        }
    }

    /** 网络读写放在 IO；卡库合并回到调用方上下文，避免后台线程直接修改 Compose 状态。 */
    suspend fun executeBidirectionalSync(
        target: String,
        localCards: List<KnowledgeCard>,
        onApplyRemoteCards: (List<KnowledgeCard>) -> CardStore.ArchiveRestoreResult,
    ): Result<SyncResult> = runCatching {
        val parsed = withContext(Dispatchers.IO) { parseTarget(target) }
        val pulledCards = withContext(Dispatchers.IO) {
            val response = requestWithRetry(parsed, "GET", "/api/cards")
            if (response.status !in 200..299) error("拉取对端卡片失败 HTTP ${response.status}")
            CardJson.decodeList(response.body)
        }

        val mergeResult = onApplyRemoteCards(pulledCards)

        withContext(Dispatchers.IO) {
            val payload = CardJson.encodeList(localCards).toByteArray(StandardCharsets.UTF_8)
            require(payload.size <= SyncServer.MAX_REQUEST_BODY_BYTES) { "本机卡片数据超过 25 MiB 同步上限" }
            val response = requestWithRetry(parsed, "POST", "/api/cards", payload)
            if (response.status !in 200..299) error("推送卡片至对端失败 HTTP ${response.status}")
        }

        SyncResult(
            pushedCount = localCards.size,
            pulledCount = pulledCards.size,
            addedCount = mergeResult.added,
            restoredCount = mergeResult.restored,
        )
    }
}
