package com.knowflick.app.domain

/** 文本工具：标题归一化（去空白/标点差异后比较）。与 macOS `CardImportEngine.normalizeHeadline` 对齐。 */
object CardTextUtils {
    fun normalizeHeadline(text: String): String = text.lowercase().filter { ch ->
        !ch.isWhitespace() && ch !in "，。！？「」"
    }
}
