package com.knowflick.app.domain

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * 回环判定：与第一套桌面 `src/domain/loopback.test.ts` 用**同一批地址**。
 *
 * 口径必须两端一致（ADR-0002 §3：同一份 settings.json 在两端行为相同）。
 * 两边各写一份用例，是为了让「一致」这件事可核对，而不是靠记得对齐。
 */
class LoopbackHostTest {
    @Test
    fun ipv4LoopbackIsLoopback() {
        assertTrue(LoopbackHost.isLoopback("127.0.0.1"))
    }

    @Test
    fun localhostIsLoopback() {
        assertTrue(LoopbackHost.isLoopback("localhost"))
        assertTrue(LoopbackHost.isLoopback("LOCALHOST"))
    }

    @Test
    fun ipv6LoopbackFormsAreLoopback() {
        assertTrue(LoopbackHost.isLoopback("::1"))
        assertTrue(LoopbackHost.isLoopback("[::1]"))
        assertTrue(LoopbackHost.isLoopback("0:0:0:0:0:0:0:1"))
        assertTrue(LoopbackHost.isLoopback("[0:0:0:0:0:0:0:1]"))
    }

    @Test
    fun unspecifiedAddressIsNotLoopback() {
        assertFalse(LoopbackHost.isLoopback("::"))
        assertFalse(LoopbackHost.isLoopback("[::]"))
    }

    @Test
    fun ipv4MappedAddressIsNotLoopback() {
        // Rust 端 Ipv6Addr::is_loopback 只认 ::1，这种写法不算。
        assertFalse(LoopbackHost.isLoopback("::ffff:127.0.0.1"))
        assertFalse(LoopbackHost.isLoopback("[::ffff:7f00:1]"))
    }

    @Test
    fun ordinaryAddressesAreNotLoopback() {
        assertFalse(LoopbackHost.isLoopback("[2001:db8::1]"))
        assertFalse(LoopbackHost.isLoopback("192.168.1.10"))
        assertFalse(LoopbackHost.isLoopback("10.0.0.1"))
        assertFalse(LoopbackHost.isLoopback("example.com"))
    }

    @Test
    fun emptyAndMalformedInputIsNotLoopback() {
        assertFalse(LoopbackHost.isLoopback(null))
        assertFalse(LoopbackHost.isLoopback(""))
        assertFalse(LoopbackHost.isLoopback("   "))
        assertFalse(LoopbackHost.isLoopback("not a host"))
    }

    @Test
    fun urlFormMatchesHostForm() {
        assertTrue(LoopbackHost.isLoopbackUrl("http://127.0.0.1:11434/v1"))
        assertTrue(LoopbackHost.isLoopbackUrl("http://localhost:11434/v1"))
        assertTrue(LoopbackHost.isLoopbackUrl("http://[::1]:11434/v1"))
        assertFalse(LoopbackHost.isLoopbackUrl("https://api.example.test/v1"))
    }
}
