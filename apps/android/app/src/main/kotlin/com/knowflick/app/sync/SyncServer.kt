package com.knowflick.app.sync

import com.knowflick.app.domain.CardJson
import com.knowflick.app.domain.CardStore
import com.knowflick.app.domain.KnowledgeCard
import java.io.OutputStream
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

data class RemoteDeviceInfo(
    val deviceName: String,
    val cardCount: Int,
    val favoriteCount: Int,
    val timestamp: Long,
)

/**
 * 局域网轻量极速同步服务端 (LAN P2P Sync Server)
 *
 * 基于标准库原生 ServerSocket 构建，0 外部网络依赖，
 * 提供局域网端对端卡片数据拉取、推送与增量智能双向合并。
 */
class SyncServer(
    private val accessCode: String,
    private val getCards: suspend () -> List<KnowledgeCard>,
    private val onReceiveCards: suspend (List<KnowledgeCard>) -> CardStore.ArchiveRestoreResult,
) {
    private var serverSocket: ServerSocket? = null
    private var executor: ExecutorService? = null
    @Volatile
    var isRunning: Boolean = false
        private set
    var boundPort: Int = 8998
        private set

    @Synchronized
    fun start(preferredPort: Int = 8998): Result<Int> {
        if (isRunning) return Result.success(boundPort)
        return runCatching {
            var port = preferredPort
            var socket: ServerSocket? = null
            var attempts = 0
            while (attempts < 5 && socket == null) {
                try {
                    socket = ServerSocket().apply {
                        reuseAddress = true
                        bind(InetSocketAddress(port))
                    }
                } catch (_: Exception) {
                    port++
                    attempts++
                }
            }
            val ss = socket ?: error("无法在可用端口绑定局域网同步服务")
            serverSocket = ss
            boundPort = port
            isRunning = true

            val pool = Executors.newFixedThreadPool(4) { r ->
                Thread(r, "KnowFlickSyncWorker").apply { isDaemon = true }
            }
            executor = pool

            val acceptThread = Thread({
                while (isRunning && !ss.isClosed) {
                    try {
                        val client = ss.accept()
                        pool.submit {
                            handleClient(client)
                        }
                    } catch (_: Exception) {
                        break
                    }
                }
            }, "KnowFlickSyncAcceptor").apply { isDaemon = true }
            acceptThread.start()

            port
        }
    }

    @Synchronized
    fun stop() {
        isRunning = false
        try {
            serverSocket?.close()
        } catch (_: Exception) {}
        serverSocket = null
        try {
            executor?.shutdownNow()
        } catch (_: Exception) {}
        executor = null
    }

    private fun readHttpLine(input: java.io.InputStream): String? {
        val baos = java.io.ByteArrayOutputStream()
        while (true) {
            val b = input.read()
            if (b == -1) {
                if (baos.size() == 0) return null
                break
            }
            if (b == '\n'.code) {
                break
            }
            if (b != '\r'.code) {
                baos.write(b)
                if (baos.size() > MAX_HEADER_LINE_BYTES) {
                    error("请求头过长")
                }
            }
        }
        return baos.toString(StandardCharsets.UTF_8.name())
    }

    private fun handleClient(client: Socket) {
        client.use { s ->
            s.soTimeout = 10000
            val input = java.io.BufferedInputStream(s.getInputStream())
            val out = s.getOutputStream()

            val requestLine = readHttpLine(input) ?: return
            val parts = requestLine.split(" ")
            if (parts.size < 2) return
            val method = parts[0].uppercase()
            val path = parts[1].substringBefore("?")

            var contentLength = 0
            val headers = HashMap<String, String>()
            var line: String?
            var headerCount = 0
            while (readHttpLine(input).also { line = it } != null) {
                if (line.isNullOrBlank()) break
                headerCount++
                if (headerCount > MAX_HEADER_COUNT) error("请求头过多")
                val header = line!!
                val separator = header.indexOf(':')
                if (separator > 0) {
                    headers[header.substring(0, separator).trim().lowercase()] =
                        header.substring(separator + 1).trim()
                }
                if (header.startsWith("Content-Length:", ignoreCase = true)) {
                    contentLength = header.substringAfter(":").trim().toIntOrNull() ?: 0
                }
            }

            if (headers[AUTH_HEADER.lowercase()] != accessCode) {
                sendResponse(out, 401, "Unauthorized", "application/json", """{"error":"Invalid pairing code"}""")
                return
            }

            if (contentLength !in 0..MAX_REQUEST_BODY_BYTES) {
                sendResponse(out, 413, "Payload Too Large", "application/json", """{"error":"Payload Too Large"}""")
                return
            }

            when (path) {
                "/api/info" -> {
                    if (method == "GET") {
                        val cards = runBlocking { getCards() }
                        val favCount = cards.count { it.isFavorite }
                        val deviceName = try {
                            "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}".trim().ifBlank { "Android Device" }
                        } catch (_: Throwable) {
                            "KnowFlick Host"
                        }
                        val json = buildJsonObject {
                            put("deviceName", deviceName)
                            put("cardCount", cards.size)
                            put("favoriteCount", favCount)
                            put("timestamp", System.currentTimeMillis())
                        }.toString()
                        sendResponse(out, 200, "OK", "application/json; charset=utf-8", json)
                    } else {
                        sendResponse(out, 405, "Method Not Allowed", "application/json", """{"error":"Method Not Allowed"}""")
                    }
                }
                "/api/cards" -> {
                    when (method) {
                        "GET" -> {
                            val cards = runBlocking { getCards() }
                            val json = CardJson.encodeList(cards)
                            sendResponse(out, 200, "OK", "application/json; charset=utf-8", json)
                        }
                        "POST" -> {
                            val body = if (contentLength > 0) {
                                val bytes = ByteArray(contentLength)
                                var totalRead = 0
                                while (totalRead < contentLength) {
                                    val r = input.read(bytes, totalRead, contentLength - totalRead)
                                    if (r == -1) break
                                    totalRead += r
                                }
                                String(bytes, 0, totalRead, StandardCharsets.UTF_8)
                            } else {
                                ""
                            }
                            val incoming = CardJson.decodeList(body)
                            val result = runBlocking { onReceiveCards(incoming) }
                            val resp = buildJsonObject {
                                put("status", "success")
                                put("restored", result.restored)
                                put("added", result.added)
                                put("ignored", result.ignored)
                                put("total", runBlocking { getCards() }.size)
                            }.toString()
                            sendResponse(out, 200, "OK", "application/json; charset=utf-8", resp)
                        }
                        else -> {
                            sendResponse(out, 405, "Method Not Allowed", "application/json", """{"error":"Method Not Allowed"}""")
                        }
                    }
                }
                else -> {
                    sendResponse(out, 404, "Not Found", "application/json", """{"error":"Not Found"}""")
                }
            }
        }
    }

    private fun sendResponse(out: OutputStream, code: Int, message: String, contentType: String, body: String) {
        val bytes = body.toByteArray(StandardCharsets.UTF_8)
        val header = "HTTP/1.1 $code $message\r\n" +
            "Content-Type: $contentType\r\n" +
            "Content-Length: ${bytes.size}\r\n" +
            "Connection: close\r\n" +
            "\r\n"
        out.write(header.toByteArray(StandardCharsets.UTF_8))
        if (bytes.isNotEmpty()) {
            out.write(bytes)
        }
        out.flush()
    }

    companion object {
        const val AUTH_HEADER = "X-KnowFlick-Token"
        const val MAX_REQUEST_BODY_BYTES = 25 * 1024 * 1024
        private const val MAX_HEADER_LINE_BYTES = 8 * 1024
        private const val MAX_HEADER_COUNT = 64

        fun getLocalIpAddress(): String? {
            return try {
                val interfaces = NetworkInterface.getNetworkInterfaces() ?: return null
                var fallback: String? = null
                for (intf in interfaces) {
                    if (intf.isLoopback || !intf.isUp) continue
                    for (addr in intf.inetAddresses) {
                        if (!addr.isLoopbackAddress && addr is Inet4Address) {
                            if (addr.isSiteLocalAddress) return addr.hostAddress
                            if (fallback == null && addr.isLinkLocalAddress) fallback = addr.hostAddress
                        }
                    }
                }
                fallback
            } catch (_: Exception) {
                null
            }
        }
    }
}
