package com.knowflick.app.ui.common

import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp

/**
 * 轻量级高性能 Markdown & 数学公式排版渲染引擎：
 * 1. 结构标记解析：粗体 (**text**)、斜体 (*text*)、行内代码 (`code`)、无序列表 (- item)；
 * 2. 基础 LaTeX / 科学符号解析：
 *    - 希腊字母 (\alpha -> α, \beta -> β, \pi -> π, \Delta -> Δ 等)；
 *    - 科学算符 (\times -> ×, \approx -> ≈, \neq -> ≠, \le -> ≤, \ge -> ≥, \pm -> ±, \infty -> ∞, \sqrt -> √)；
 *    - 上下标转换 (^2 -> ², _0 -> ₀, _i -> ᵢ 等)；
 * 3. 零 WebView 开销，直接生成 Compose [AnnotatedString]，享受底层原生排版性能与换行算法。
 */
object MarkdownTextRenderer {

    // 常用 LaTeX 科学符号映射
    private val LATEX_SYMBOL_MAP = mapOf(
        "\\alpha" to "α",
        "\\beta" to "β",
        "\\gamma" to "γ",
        "\\delta" to "δ",
        "\\epsilon" to "ε",
        "\\zeta" to "ζ",
        "\\eta" to "η",
        "\\theta" to "θ",
        "\\lambda" to "λ",
        "\\mu" to "μ",
        "\\nu" to "ν",
        "\\xi" to "ξ",
        "\\pi" to "π",
        "\\rho" to "ρ",
        "\\sigma" to "σ",
        "\\tau" to "τ",
        "\\phi" to "φ",
        "\\chi" to "χ",
        "\\psi" to "ψ",
        "\\omega" to "ω",
        "\\Delta" to "Δ",
        "\\Sigma" to "Σ",
        "\\Omega" to "Ω",
        "\\approx" to "≈",
        "\\neq" to "≠",
        "\\le" to "≤",
        "\\ge" to "≥",
        "\\leq" to "≤",
        "\\geq" to "≥",
        "\\times" to "×",
        "\\div" to "÷",
        "\\pm" to "±",
        "\\mp" to "∓",
        "\\infty" to "∞",
        "\\sqrt" to "√",
        "\\to" to "→",
        "\\leftarrow" to "←",
        "\\rightarrow" to "→",
        "\\in" to "∈",
        "\\notin" to "∉",
        "\\subset" to "⊂",
        "\\forall" to "∀",
        "\\exists" to "∃",
        "\\cdot" to "·",
    )

    // 上标映射
    private val SUPERSCRIPT_MAP = mapOf(
        '0' to '⁰', '1' to '¹', '2' to '²', '3' to '³', '4' to '⁴',
        '5' to '⁵', '6' to '⁶', '7' to '⁷', '8' to '⁸', '9' to '⁹',
        '+' to '⁺', '-' to '⁻', '=' to '⁼', '(' to '⁽', ')' to '⁾',
        'n' to 'ⁿ', 'i' to 'ⁱ',
    )

    // 下标映射
    private val SUBSCRIPT_MAP = mapOf(
        '0' to '₀', '1' to '₁', '2' to '₂', '3' to '₃', '4' to '₄',
        '5' to '₅', '6' to '₆', '7' to '₇', '8' to '₈', '9' to '₉',
        '+' to '₊', '-' to '₋', '=' to '₌', '(' to '₍', ')' to '₎',
        'a' to 'ₐ', 'e' to 'ₑ', 'i' to 'ᵢ', 'j' to 'ⱼ', 'o' to 'ₒ',
        'r' to 'ᵣ', 'u' to 'ᵤ', 'v' to 'ᵥ', 'x' to 'ₓ', 'n' to 'ₙ',
    )

    /**
     * 将包含 LaTeX / 上下标简写文本转换为美化的科学符号表示
     */
    fun formatMathSymbols(input: String): String {
        var text = input

        // 替换 LaTeX 科学符号
        for ((k, v) in LATEX_SYMBOL_MAP) {
            text = text.replace(k, v)
        }

        // 处理上标 ^2 -> ², ^n -> ⁿ
        val superRegex = Regex("""\^([0-9+\-n=()i])""")
        text = superRegex.replace(text) { match ->
            val ch = match.groupValues[1][0]
            SUPERSCRIPT_MAP[ch]?.toString() ?: match.value
        }

        // 处理下标 _0 -> ₀, _i -> ᵢ
        val subRegex = Regex("""_([0-9+\-aeijoruvxn=()])""")
        text = subRegex.replace(text) { match ->
            val ch = match.groupValues[1][0]
            SUBSCRIPT_MAP[ch]?.toString() ?: match.value
        }

        return text
    }

    /**
     * 将 Markdown 原文解析为包含粗体、代码高亮、斜体与数学符号的 [AnnotatedString]
     */
    fun render(
        markdown: String,
        codeBackgroundColor: Color = Color(0x22888888),
        codeTextColor: Color = Color(0xFFE08244),
    ): AnnotatedString {
        if (markdown.isBlank()) return AnnotatedString("")

        val preprocessed = formatMathSymbols(markdown)
        val lines = preprocessed.lines()

        return buildAnnotatedString {
            lines.forEachIndexed { index, line ->
                val trimmed = line.trimStart()
                val isBullet = trimmed.startsWith("- ") || trimmed.startsWith("* ")
                val isQuote = trimmed.startsWith("> ")

                val contentLine = when {
                    isBullet -> "• " + trimmed.substring(2)
                    isQuote -> trimmed.substring(2)
                    else -> line
                }

                if (isQuote) {
                    withStyle(
                        SpanStyle(
                            fontStyle = FontStyle.Italic,
                            color = Color(0xFF9E9E9E),
                        ),
                    ) {
                        appendInlineMarkdown(contentLine, codeBackgroundColor, codeTextColor)
                    }
                } else {
                    appendInlineMarkdown(contentLine, codeBackgroundColor, codeTextColor)
                }

                if (index < lines.size - 1) {
                    append("\n")
                }
            }
        }
    }

    private fun AnnotatedString.Builder.appendInlineMarkdown(
        line: String,
        codeBgColor: Color,
        codeTextColor: Color,
    ) {
        var i = 0
        val len = line.length

        while (i < len) {
            when {
                // 行内代码 `code`
                line[i] == '`' -> {
                    val end = line.indexOf('`', i + 1)
                    if (end != -1) {
                        val codeContent = line.substring(i + 1, end)
                        withStyle(
                            SpanStyle(
                                fontFamily = FontFamily.Monospace,
                                background = codeBgColor,
                                color = codeTextColor,
                                fontSize = 13.sp,
                            ),
                        ) {
                            append(" $codeContent ")
                        }
                        i = end + 1
                    } else {
                        append(line[i])
                        i++
                    }
                }

                // 粗体 **bold** 或 __bold__
                (i + 1 < len) && ((line[i] == '*' && line[i + 1] == '*') || (line[i] == '_' && line[i + 1] == '_')) -> {
                    val delim = line.substring(i, i + 2)
                    val end = line.indexOf(delim, i + 2)
                    if (end != -1) {
                        val boldContent = line.substring(i + 2, end)
                        withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
                            append(boldContent)
                        }
                        i = end + 2
                    } else {
                        append(delim)
                        i += 2
                    }
                }

                // 斜体 *italic* 或 _italic_
                line[i] == '*' || line[i] == '_' -> {
                    val delim = line[i]
                    val end = line.indexOf(delim, i + 1)
                    if (end != -1 && end > i + 1 && line[end - 1] != ' ') {
                        val italicContent = line.substring(i + 1, end)
                        withStyle(SpanStyle(fontStyle = FontStyle.Italic)) {
                            append(italicContent)
                        }
                        i = end + 1
                    } else {
                        append(line[i])
                        i++
                    }
                }

                // 数学公式 $...$
                line[i] == '$' -> {
                    val end = line.indexOf('$', i + 1)
                    if (end != -1 && end > i + 1) {
                        val mathContent = line.substring(i + 1, end)
                        withStyle(
                            SpanStyle(
                                fontFamily = FontFamily.Serif,
                                fontStyle = FontStyle.Italic,
                                fontWeight = FontWeight.Medium,
                            ),
                        ) {
                            append(mathContent)
                        }
                        i = end + 1
                    } else {
                        append(line[i])
                        i++
                    }
                }

                else -> {
                    append(line[i])
                    i++
                }
            }
        }
    }
}

/**
 * 封装的 Compose Markdown 文本展示组件
 */
@Composable
fun MarkdownText(
    markdown: String,
    modifier: Modifier = Modifier,
    color: Color = Color.Unspecified,
    style: TextStyle = LocalTextStyle.current,
    maxLines: Int = Int.MAX_VALUE,
    overflow: TextOverflow = TextOverflow.Clip,
    lineHeight: TextUnit = TextUnit.Unspecified,
) {
    val codeBg = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f)
    val codeColor = MaterialTheme.colorScheme.primary
    val annotated = remember(markdown, codeBg, codeColor) {
        MarkdownTextRenderer.render(
            markdown = markdown,
            codeBackgroundColor = codeBg,
            codeTextColor = codeColor,
        )
    }

    Text(
        text = annotated,
        modifier = modifier,
        color = color,
        style = style,
        maxLines = maxLines,
        overflow = overflow,
        lineHeight = lineHeight,
    )
}
