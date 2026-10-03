package com.knowflick.app.data

import com.knowflick.app.domain.CardJson
import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.Tombstone
import java.io.ByteArrayInputStream
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class CardFileIOTest {
    @Test
    fun limitedStreamDecodeReadsValidArchive() {
        val card = KnowledgeCard.create("测试", "流式导入", "摘要", "正文", source = CardSource.IMPORTED)
        val input = ByteArrayInputStream(CardFileIO.encodeList(listOf(card)).toByteArray())

        val decoded = CardFileIO.decodeStreamSalvaging(input, maxBytes = 4_096)

        assertEquals(listOf(card.id), decoded.map { it.id })
    }

    @Test
    fun limitedStreamDecodeRejectsOversizedInput() {
        val input = ByteArrayInputStream(ByteArray(1_025) { 'x'.code.toByte() })

        assertFailsWith<IllegalArgumentException> {
            CardFileIO.decodeStreamSalvaging(input, maxBytes = 1_024)
        }
    }

    @Test
    fun salvagingDecodeAcceptsV2EnvelopeAndLegacyBareList() {
        // 信封用于线格式与归档导入导出（SYNC_PROTOCOL.md §3）；导入必须同时兼容旧裸列表
        val card = KnowledgeCard.create("测试", "信封导入", "摘要", "正文", source = CardSource.IMPORTED)
        val envelopeText = CardJson.encodeEnvelope(listOf(card), listOf(Tombstone("dead", 1_727_900_001_000)))
        val bareText = CardFileIO.encodeList(listOf(card))

        assertEquals(listOf(card.id), CardFileIO.decodeListSalvaging(envelopeText).map { it.id })
        assertEquals(listOf(card.id), CardFileIO.decodeListSalvaging(bareText).map { it.id })
    }

    @Test
    fun strictLocalDecodeRejectsEnvelope() {
        // 本地 cards.json 保持裸列表不变：严格解码路径不得接受信封对象
        val envelopeText = CardJson.encodeEnvelope(
            listOf(KnowledgeCard.create("测试", "信封卡", "摘要", "正文", source = CardSource.IMPORTED)),
        )

        assertFailsWith<IllegalArgumentException> { CardFileIO.decodeList(envelopeText) }
    }
}
