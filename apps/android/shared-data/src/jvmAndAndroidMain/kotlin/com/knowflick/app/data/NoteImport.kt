package com.knowflick.app.data

import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.NoteMarkdownParser

/** 笔记导入：JSON 备份走共享解码，其余走 Markdown 规则解析。 */
object NoteImport {
    const val MAX_BYTES = 32 * 1024 * 1024

    fun parse(content: String, fileName: String? = null): List<KnowledgeCard> {
        val text = content.trim()
        if (text.isEmpty()) return emptyList()
        val json = fileName?.lowercase()?.endsWith(".json") == true ||
            text.startsWith("{") ||
            text.startsWith("[")
        return if (json) CardFileIO.decodeListSalvaging(text) else NoteMarkdownParser.parse(text)
    }
}
