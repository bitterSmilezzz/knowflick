package com.knowflick.app.ui.common

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MarkdownTextRendererTest {

    @Test
    fun `test formatMathSymbols converts LaTeX and superscripts`() {
        val input = "E = mc^2, \\alpha + \\beta = \\pi, a_1 \\le b_2, \\pm \\infty"
        val formatted = MarkdownTextRenderer.formatMathSymbols(input)

        assertTrue("应当将 ^2 转换为 ²", formatted.contains("mc²"))
        assertTrue("应当将 \\alpha 转换为 α", formatted.contains("α"))
        assertTrue("应当将 \\beta 转换为 β", formatted.contains("β"))
        assertTrue("应当将 \\pi 转换为 π", formatted.contains("π"))
        assertTrue("应当将 a_1 转换为 a₁", formatted.contains("a₁"))
        assertTrue("应当将 b_2 转换为 b₂", formatted.contains("b₂"))
        assertTrue("应当将 \\le 转换为 ≤", formatted.contains("≤"))
        assertTrue("应当将 \\pm 转换为 ±", formatted.contains("±"))
        assertTrue("应当将 \\infty 转换为 ∞", formatted.contains("∞"))
    }

    @Test
    fun `test render markdown handles bold and code blocks`() {
        val markdown = "这是 **粗体文字** 和 `行内代码`\n- 列表项"
        val annotated = MarkdownTextRenderer.render(markdown)

        // 验证文本内容正确提取
        val plainText = annotated.text
        assertTrue("纯文本包含粗体内容", plainText.contains("粗体文字"))
        assertTrue("纯文本包含代码内容", plainText.contains("行内代码"))
        assertTrue("列表行转换为 bullet", plainText.contains("• 列表项"))

        // 验证 Span 样式已正确注入
        assertTrue("存在样式标注", annotated.spanStyles.isNotEmpty())
    }

    @Test
    fun `test render empty string handles gracefully`() {
        val empty = MarkdownTextRenderer.render("")
        assertEquals("", empty.text)

        val blank = MarkdownTextRenderer.render("   ")
        assertEquals("", blank.text)
    }
}
