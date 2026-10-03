package com.knowflick.app.speech

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SpeechTextSegmenterTest {

    private fun longChineseText(sentences: Int): String = buildString {
        repeat(sentences) { i ->
            append("这是第${i}句话，内容比较长，用来测试朗读分段逻辑。")
        }
    }

    /** 无段以孤立低代理开头、无段以孤立高代理结尾 */
    private fun assertNoSplitSurrogatePairs(segments: List<String>) {
        segments.forEach { segment ->
            assertTrue(
                segment.isEmpty() || !Character.isHighSurrogate(segment.last()),
                "段落不得以孤立高代理结尾：${segment.takeLast(4)}",
            )
            assertTrue(
                segment.isEmpty() || !Character.isLowSurrogate(segment.first()),
                "段落不得以孤立低代理开头：${segment.take(4)}",
            )
        }
    }

    @Test
    fun shortTextPassesThroughAsSingleSegment() {
        val text = "短文本，直接整卡朗读。"
        val segments = SpeechTextSegmenter.segment(text, maxLength = 4000)
        assertEquals(listOf(text), segments)
    }

    @Test
    fun longTextSplitsIntoBoundedSegmentsWithoutLoss() {
        val text = longChineseText(sentences = 300)   // 约 7000+ 字符，超过 4000 上限
        val limit = 4000
        val segments = SpeechTextSegmenter.segment(text, maxLength = limit)

        assertTrue(segments.size > 1, "超长文本必须切成多段")
        segments.forEachIndexed { index, segment ->
            assertTrue(
                segment.length <= limit,
                "第 $index 段长度 ${segment.length} 超过上限 $limit",
            )
        }
        assertEquals(text, segments.joinToString(""), "分段不得丢字或改字")
        // 贪心策略下段边界应落在句末标点上
        segments.dropLast(1).forEach { segment ->
            assertTrue(
                segment.last() in "。！？!?.；;\n",
                "段边界应落在句末标点，实际以「${segment.last()}」结尾",
            )
        }
    }

    @Test
    fun hardCutNeverSplitsSurrogatePairs() {
        // 9 个占位字符 + 一个 emoji（代理对，落在第 10-11 位）+ 后续正文：
        // 硬切点若按「每 maxLength 个字符」会正好劈开代理对
        val text = "aaaaaaaaa😀这是一句没有句末标点的超长正文"
        val limit = 10
        val segments = SpeechTextSegmenter.segment(text, maxLength = limit)

        assertTrue(segments.size > 1)
        segments.forEach { segment ->
            assertTrue(segment.length <= limit, "硬切段也不得超过上限：${segment.length}")
        }
        assertEquals(text, segments.joinToString(""), "硬切分段不得丢字")
        assertNoSplitSurrogatePairs(segments)
    }

    @Test
    fun sentenceBoundaryPreferredOverHardCut() {
        val s1 = "第一句话完整落在第一段里。"
        val s2 = "第二句话完整落在第二段里。"
        val segments = SpeechTextSegmenter.segment(s1 + s2, maxLength = s1.length + s2.length - 1)

        assertEquals(listOf(s1, s2), segments, "能按句切分时不得在句中硬切")
    }

    @Test
    fun oversizeSingleSentenceIsHardCutIntoBoundedPieces() {
        val sentence = "这句话没有任何句末标点".repeat(500) + "。"
        val limit = 100
        val segments = SpeechTextSegmenter.segment(sentence, maxLength = limit)

        assertTrue(segments.size > 1)
        segments.forEach { segment ->
            assertTrue(segment.length <= limit, "超长单句切分后不得超限：${segment.length}")
        }
        assertEquals(sentence, segments.joinToString(""), "超长单句切分不得丢字")
    }

    @Test
    fun snapBackToCodePointStartGuardsResumeOffset() {
        val text = "aaaaaaaaa😀后面的内容"
        // 索引 10 落在 emoji 的低代理上：回退到高代理之前，resume 不得劈开代理对
        assertEquals(9, SpeechTextSegmenter.snapBackToCodePointStart(text, 10))
        assertEquals(9, SpeechTextSegmenter.snapBackToCodePointStart(text, 9))
        assertEquals(5, SpeechTextSegmenter.snapBackToCodePointStart(text, 5))
        assertEquals(0, SpeechTextSegmenter.snapBackToCodePointStart(text, 0))
    }
}
