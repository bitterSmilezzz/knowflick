package com.knowflick.app

import java.time.LocalDate

/**
 * 按 (版本号, 日期) 记忆化的派生值缓存。
 *
 * 适用于计算重（O(n log n) 级全库扫描）、访问频繁（每次重组都会读）且只在
 * 「版本推进」或「跨日」时才需要重算的派生量（如今日到期复习队列）。
 * 只在主线程/组合中访问，字段可见性由主线程单一访问者保证。
 */
internal class VersionedMemo<V>(private val compute: (today: LocalDate) -> V) {

    private class Entry<V>(val version: Int, val date: LocalDate, val value: V)

    private var entry: Entry<V>? = null

    /** 版本不变且未跨日时直接返回缓存；生产路径可不传 today（默认当天） */
    fun get(version: Int, today: LocalDate = LocalDate.now()): V {
        entry?.let { cached ->
            if (cached.version == version && cached.date == today) return cached.value
        }
        return compute(today).also { value ->
            entry = Entry(version, today, value)
        }
    }
}
