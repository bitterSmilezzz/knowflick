package com.knowflick.app.sync

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** 对端协议版本提示文案（SYNC_PROTOCOL.md §2）：不阻断同步，只在结果文案里提醒 */
class SyncVersionHintTest {

    @Test
    fun F_missingVersionMeansOlderPeerHint() {
        assertEquals("对端版本较旧，建议两端升级", syncVersionHint(null))
    }

    @Test
    fun newerPeerVersionGetsUpdateHint() {
        assertEquals("对端版本更新", syncVersionHint(CardJsonProtocolCurrent + 1))
        assertEquals("对端版本更新", syncVersionHint(99))
    }

    @Test
    fun sameVersionGetsNoHint() {
        assertNull(syncVersionHint(CardJsonProtocolCurrent))
    }

    private companion object {
        const val CardJsonProtocolCurrent = com.knowflick.app.domain.CardJson.PROTOCOL_VERSION
    }
}
