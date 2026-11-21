package com.knowflick.app.domain

/**
 * 回环主机判定：本地部署的服务（Ollama、本地网关）用。
 *
 * 口径必须与第一套桌面一致（ADR-0002 §3：同一份 settings.json 在两端行为相同）：
 * - 第一套桌面 `src/domain/ingest.ts` 的 `requiresKey`
 * - 第一套桌面 `src-tauri/src/http.rs` 的 `is_loopback_host`
 *
 * 判定内容：127.0.0.1、localhost、以及 IPv6 回环。
 *
 * IPv6 回环不能只比字符串：地址可以写成 `::1`、`[::1]`，也可以写成展开形式
 * `0:0:0:0:0:0:0:1`——三种都指同一个回环地址。
 *
 * 两端一致的关键细节：**只认恰好等于 ::1 的地址**。
 * `::ffff:127.0.0.1`（IPv4 映射写法）不算回环——Rust 端 `Ipv6Addr::is_loopback`
 * 也只认 `::1`，若这里用 `InetAddress.isLoopbackAddress` 会把它算成回环，
 * 两端就又不一致了。
 *
 * 同样地，`::`（未指定地址）与普通 IPv6 地址**不是**回环，不获得本机豁免。
 */
object LoopbackHost {
    /** 主机名（可带方括号的 IPv6 字面量）是否是本机回环。 */
    fun isLoopback(rawHost: String?): Boolean {
        val host = rawHost?.trim()?.trim('[', ']')?.lowercase() ?: return false
        if (host.isEmpty()) return false
        if (host == "localhost" || host == "127.0.0.1") return true
        return isIpv6LoopbackLiteral(host)
    }

    /** 从 URL 文本取主机名并判定；解析失败一律按「非本机」处理。 */
    fun isLoopbackUrl(rawUrl: String): Boolean {
        val host = runCatching {
            java.net.URI(rawUrl.trim()).host
        }.getOrNull()
        return isLoopback(host)
    }

    /**
     * IPv6 字面量是否恰好是 ::1。
     *
     * 只接受 IPv6 字面量的字符集——含字母 o、p、q 之类的东西交给
     * `InetAddress.getByName` 会变成一次 DNS 查询（可能卡住网络超时），
     * 所以先自己挡一道。
     */
    private fun isIpv6LoopbackLiteral(host: String): Boolean {
        if (!host.contains(':')) return false
        val allowed = host.all { it.isDigit() || it in 'a'..'f' || it == ':' || it == '.' || it == '%' }
        if (!allowed) return false
        val address = runCatching { java.net.InetAddress.getByName(host) }.getOrNull()
        // getByName 会把 IPv4 映射地址转成 Inet4Address；那种不是 ::1。
        if (address !is java.net.Inet6Address) return false
        val bytes = address.address
        if (bytes.size != 16) return false
        val loopback = ByteArray(16) { index -> if (index == 15) 1 else 0 }
        return bytes.contentEquals(loopback)
    }
}
