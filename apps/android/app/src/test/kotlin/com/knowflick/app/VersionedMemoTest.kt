package com.knowflick.app

import java.time.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals

class VersionedMemoTest {

    private val d1 = LocalDate.parse("2026-10-03")
    private val d2 = LocalDate.parse("2026-10-04")

    @Test
    fun sameVersionAndDateComputesOnlyOnce() {
        var constructions = 0
        val memo = VersionedMemo { today: LocalDate ->
            constructions++
            "plan@$today"
        }

        assertEquals("plan@2026-10-03", memo.get(1, d1))
        assertEquals("plan@2026-10-03", memo.get(1, d1))
        assertEquals("plan@2026-10-03", memo.get(1, d1))
        assertEquals(1, constructions, "同版本同日期的重复访问必须复用缓存，不得重算")
    }

    @Test
    fun versionBumpTriggersRecompute() {
        var constructions = 0
        val memo = VersionedMemo { today: LocalDate ->
            constructions++
            "plan@$today"
        }

        memo.get(1, d1)
        assertEquals("plan@2026-10-03", memo.get(2, d1))
        assertEquals(2, constructions, "版本推进后必须重算")
    }

    @Test
    fun dayChangeInvalidatesCacheEvenWithSameVersion() {
        var constructions = 0
        val memo = VersionedMemo { today: LocalDate ->
            constructions++
            "plan@$today"
        }

        assertEquals("plan@2026-10-03", memo.get(1, d1))
        assertEquals("plan@2026-10-04", memo.get(1, d2))
        assertEquals(2, constructions, "跨日必须失效重算，哪怕版本没变")
    }
}
