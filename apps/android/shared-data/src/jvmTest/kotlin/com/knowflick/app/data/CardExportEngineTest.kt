package com.knowflick.app.data

import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Anki TSV 导出。
 *
 * 桌面端的 `exportAnkiTsv` 与这里的 `exportAnkiTSv` 必须产出**同一份格式**——
 * 两端产出的文件要能互相导入。桌面端有 4 项单测，这里补上安卓侧，
 * 格式靠两处测试对齐（表头、列数、特殊字符处理）。
 */
class CardExportEngineTest {

    private fun card(headlineText: String, detailsText: String, categoryText: String = "计算机") = KnowledgeCard(
        id = "x1",
        category = categoryText,
        headline = headlineText,
        summary = "摘要",
        details = detailsText,
        links = emptyList(),
        source = CardSource.IMPORTED,
        createdAt = 0L,
    )

    @Test
    fun `表头是 front back category`() {
        val tsv = CardExportEngine.exportAnkiTSV(listOf(card("标题", "正文")))
        assertEquals("front\tback\tcategory", tsv.lines()[0])
    }

    @Test
    fun `一张卡一行：正面标题、背面正文、分类`() {
        val tsv = CardExportEngine.exportAnkiTSV(listOf(card("复购率更重要", "获取成本更高", "商业")))
        val lines = tsv.lines()
        assertEquals(2, lines.size)
        assertEquals("复购率更重要\t获取成本更高\t商业", lines[1])
    }

    @Test
    fun `制表符与换行被替换成空格——否则会破坏 TSV 列结构`() {
        // 桌面端 exportAnkiTsv 同样把换行换成空格（原先只换制表符，
        // 多行正文会把 TSV 撑成多行，Anki 导入就错位）。
        val tsv = CardExportEngine.exportAnkiTSV(listOf(card("有\t制表符", "第一行\n第二行")))
        val lines = tsv.lines()
        assertEquals(2, lines.size)
        assertTrue(lines[1].contains("有 制表符"))
        assertTrue(lines[1].contains("第一行 第二行"))
    }

    @Test
    fun `空卡片列表只有表头`() {
        assertEquals("front\tback\tcategory", CardExportEngine.exportAnkiTSV(emptyList()))
    }
}
