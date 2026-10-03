package com.knowflick.app.sync

import kotlin.test.Test
import kotlin.test.assertEquals

/** B5 超时对齐（SYNC_PROTOCOL.md §6）：连接 6s、读 20s，双端一致 */
class SyncClientTimeoutsTest {

    @Test
    fun B5_timeoutsAlignWithSpecV2() {
        assertEquals(6_000, SyncClient.CONNECT_TIMEOUT_MS, "连接超时须从 5s 对齐为 6s")
        assertEquals(20_000, SyncClient.READ_TIMEOUT_MS, "读超时须从 15s 对齐为 20s")
    }
}
