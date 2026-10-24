package com.knowflick.app.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** 与 mac `CardImportEngineTests` 里 Markdown 规则解析的断言对齐。 */
class NoteMarkdownParserTest {

    @Test
    fun dividersExtractCategoryHeadlineSummaryAndLink() {
        val md = """
            ---
            category: 心理学
            title: 峰终定律：大脑只记住高潮和结局
            ---
            > 过程的漫长被压缩，峰值与结束时刻决定整体体验。
            丹尼尔·卡尼曼提出的认知偏差。

            ---
            ## 幸存者偏差：看不见的弹孔最致命
            **领域**：[[统计学]]
            > 只统计幸存下来的样本，会得出完全颠倒的因果推论。
            沃德力排众议建议加强没有弹孔的机翼引擎。
            [沃德统计学故事](https://example.com/ward)
        """.trimIndent()

        val cards = NoteMarkdownParser.parse(md)
        assertEquals(2, cards.size)
        assertEquals("心理学", cards[0].category)
        assertTrue(cards[0].headline.contains("峰终定律"))
        assertTrue(cards[0].summary.contains("过程的漫长被压缩"))
        assertEquals(CardSource.IMPORTED, cards[0].source)
        assertEquals("统计学", cards[1].category)
        assertTrue(cards[1].headline.contains("幸存者偏差"))
        assertEquals(1, cards[1].links.size)
        assertEquals("沃德统计学故事", cards[1].links[0].title)
    }

    @Test
    fun singleNoteFallsBackToFirstLine() {
        val text = """
            为什么飞机的窗户都是圆角的？
            方形窗户在机舱加压时四角会产生巨大应力集中。
            慧星客机空难后，工程师发现尖锐转角是金属疲劳断裂的温床。
        """.trimIndent()
        val cards = NoteMarkdownParser.parse(text, defaultCategory = "工程学")
        assertEquals(1, cards.size)
        assertEquals("工程学", cards[0].category)
        assertTrue(cards[0].headline.contains("为什么飞机的窗户都是圆角的"))
        assertTrue(cards[0].details.contains("慧星客机空难"))
    }

    @Test
    fun numericHeadlineIsNotStrippedUnlessItIsAnOrderingPrefix() {
        assertEquals("3.14 是圆周率", NoteMarkdownParser.parse("# 3.14 是圆周率\n> 圆周率是无理数。\n祖冲之把它算到小数点后七位。").single().headline)
        assertEquals("2024. 年度总结", NoteMarkdownParser.parse("# 2024. 年度总结\n> 一年的关键结论。\n正文内容。").single().headline)
        assertEquals("1.5 倍增长", NoteMarkdownParser.parse("# 1.5 倍增长\n> 复利效应。\n正文内容。").single().headline)
        assertEquals("沉没成本不是成本", NoteMarkdownParser.parse("# 1. 沉没成本不是成本\n> 摘要。\n正文内容。").single().headline)
    }
}
