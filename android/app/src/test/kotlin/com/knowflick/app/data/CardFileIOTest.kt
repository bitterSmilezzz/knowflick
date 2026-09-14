package com.knowflick.app.data

import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
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
}
