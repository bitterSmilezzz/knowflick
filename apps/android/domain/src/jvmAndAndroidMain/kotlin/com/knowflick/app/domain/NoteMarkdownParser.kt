package com.knowflick.app.domain

/**
 * 笔记 → 卡片的规则解析。与 mac `CardImportEngine.parseMarkdown` 同一套分段：
 * 围栏内不切分、frontmatter、`---` 分卡、否则按同级标题切、再逐段抽标题/摘要/链接。
 */
object NoteMarkdownParser {

    fun parse(text: String, defaultCategory: String = "随手笔记"): List<KnowledgeCard> {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return emptyList()
        val rawLines = trimmed.split('\n')
        val cardSections = ArrayList<String>()
        val currentLines = ArrayList<String>()
        var inFrontmatter = false
        var fence: String? = null

        for ((index, line) in rawLines.withIndex()) {
            val t = line.trim()
            val marker = fenceMarker(t)
            if (marker != null) {
                fence = if (fence == null) marker else if (fence == marker) null else fence
                currentLines.add(line)
                continue
            }
            if (fence != null) {
                currentLines.add(line)
                continue
            }
            if (t == "---" || t == "***" || t == "___") {
                val nextLine = rawLines.drop(index + 1).firstOrNull { it.trim().isNotEmpty() }.orEmpty()
                val metadataStartsHere = t == "---" &&
                    currentLines.all { it.trim().isEmpty() } &&
                    nextLine.contains(METADATA_START)
                if (inFrontmatter) {
                    inFrontmatter = false
                    currentLines.add(line)
                } else if (metadataStartsHere) {
                    inFrontmatter = true
                    currentLines.add(line)
                } else {
                    if (currentLines.any { it.trim().isNotEmpty() }) {
                        cardSections.add(currentLines.joinToString("\n"))
                    }
                    currentLines.clear()
                }
            } else {
                currentLines.add(line)
            }
        }
        if (currentLines.isNotEmpty()) cardSections.add(currentLines.joinToString("\n"))

        val sections = if (cardSections.size <= 1) {
            val byHeadings = splitByHeadings(trimmed)
            if (byHeadings.size > 1) byHeadings else cardSections
        } else {
            cardSections
        }
        return sections.mapNotNull { parseSingleSection(it, defaultCategory) }
    }

    private val METADATA_START = Regex("""^\s*[A-Za-z_][A-Za-z_0-9-]*\s*:""")
    private val ORDER_PREFIX = Regex("""^\d{1,3}\.\s+""")

    private fun splitByHeadings(text: String): List<String> {
        val lines = text.split('\n')
        val headings = ArrayList<Pair<Int, Int>>()
        var fence: String? = null
        var frontmatter = false
        for ((index, line) in lines.withIndex()) {
            val trimmed = line.trim()
            if (trimmed == "---" && (index == 0 || frontmatter)) {
                frontmatter = !frontmatter
                continue
            }
            if (frontmatter) continue
            val marker = fenceMarker(trimmed)
            if (marker != null) {
                fence = if (fence == null) marker else if (fence == marker) null else fence
                continue
            }
            if (fence != null) continue
            val depth = trimmed.takeWhile { it == '#' }.length
            if (depth in 1..6 && trimmed.drop(depth).startsWith(" ")) {
                headings.add(index to depth)
            }
        }
        val depth = headings.minOfOrNull { it.second } ?: return listOf(text)
        val boundaries = headings.filter { it.second == depth }.drop(1).map { it.first }
        val sections = ArrayList<String>()
        var start = 0
        for (boundary in boundaries) {
            sections.add(lines.subList(start, boundary).joinToString("\n"))
            start = boundary
        }
        sections.add(lines.subList(start, lines.size).joinToString("\n"))
        return sections
    }

    private fun fenceMarker(line: String): String? = when {
        line.startsWith("```") -> "```"
        line.startsWith("~~~") -> "~~~"
        else -> null
    }

    private fun parseSingleSection(sectionText: String, defaultCategory: String): KnowledgeCard? {
        val lines = sectionText.split('\n')
        if (lines.isEmpty()) return null
        var category = defaultCategory
        var headline = ""
        var summary = ""
        val detailLines = ArrayList<String>()
        val links = ArrayList<ScienceLink>()
        var inFrontmatter = false
        var frontmatterChecked = false
        var fence: String? = null

        for (rawLine in lines) {
            val line = rawLine.trim()
            val marker = fenceMarker(line)
            if (marker != null) {
                fence = if (fence == null) marker else if (fence == marker) null else fence
                detailLines.add(rawLine)
                continue
            }
            if (fence != null) {
                detailLines.add(rawLine)
                continue
            }
            if (line.isEmpty()) continue
            if (line == "---" && !frontmatterChecked) {
                inFrontmatter = !inFrontmatter
                if (!inFrontmatter) frontmatterChecked = true
                continue
            }
            if (inFrontmatter) {
                when {
                    line.startsWith("category:") -> category = extractMetadataValue(line, "category:")
                    line.startsWith("title:") -> headline = extractMetadataValue(line, "title:")
                    line.startsWith("headline:") -> headline = extractMetadataValue(line, "headline:")
                }
                continue
            }
            if ((line.contains("领域") || line.contains("分类")) && extractCategoryFromLine(line)?.also { category = it } != null) {
                continue
            }
            if (headline.isEmpty() && (line.startsWith("#") || line.startsWith("【") || (line.contains("：") && !isBulletLine(line)))) {
                val cleaned = cleanHeadline(line)
                if (cleaned.isNotEmpty()) {
                    headline = cleaned
                    continue
                }
            }
            if (line.startsWith(">")) {
                val quote = line.drop(1).trim()
                if (quote.startsWith("**核心观点**")) continue
                summary = if (summary.isEmpty()) quote else "$summary $quote"
                continue
            }
            extractMarkdownLink(line)?.let { links.add(it) }
            if (line != "**深入剖析**" && line != "## 深入剖析" && line != "**延伸阅读**") {
                detailLines.add(line)
            }
        }

        if (headline.isEmpty() || headline == "---") {
            val firstReal = lines.firstOrNull { it != "---" && cleanHeadline(it).isNotEmpty() }
            if (firstReal != null) {
                headline = cleanHeadline(firstReal)
                detailLines.remove(firstReal)
            }
        }
        if (summary.isEmpty()) {
            if (detailLines.isNotEmpty()) summary = detailLines.removeAt(0) else summary = headline
        }
        if (headline.isEmpty()) return null
        val details = detailLines.joinToString("\n")
        return KnowledgeCard.create(
            category = category,
            headline = headline,
            summary = summary,
            details = if (details.isEmpty()) summary else details,
            links = links,
            source = CardSource.IMPORTED,
        )
    }

    private fun isBulletLine(line: String): Boolean {
        val trimmed = line.trim()
        return trimmed.startsWith("-") || trimmed.startsWith("*") || trimmed.startsWith("•") || trimmed.startsWith("+")
    }

    private fun cleanHeadline(raw: String): String {
        var s = raw.trim()
        while (s.startsWith("#")) s = s.drop(1)
        s = s.trim()
        ORDER_PREFIX.find(s)?.let { s = s.removeRange(it.range) }
        return s.trim()
    }

    private fun extractMetadataValue(line: String, key: String): String =
        line.drop(key.length).trim().trim('"', '\'', '`', '[', ']')

    private fun extractCategoryFromLine(line: String): String? {
        val open = line.indexOf("[[")
        val close = line.indexOf("]]")
        if (open >= 0 && close > open + 2) {
            val cat = line.substring(open + 2, close).trim()
            if (cat.isNotEmpty()) return cat
        }
        val firstTick = line.indexOf('`')
        val lastTick = line.lastIndexOf('`')
        if (firstTick >= 0 && lastTick > firstTick) {
            val cat = line.substring(firstTick + 1, lastTick).trim()
            if (cat.isNotEmpty()) return cat
        }
        return null
    }

    private fun extractMarkdownLink(line: String): ScienceLink? {
        val openBracket = line.indexOf('[')
        val closeBracket = line.indexOf(']')
        val openParen = line.indexOf('(')
        val closeParen = line.indexOf(')')
        if (openBracket < 0 || closeBracket < 0 || openParen < 0 || closeParen < 0) return null
        if (!(openBracket < closeBracket && closeBracket < openParen && openParen < closeParen)) return null
        val title = line.substring(openBracket + 1, closeBracket)
        val url = line.substring(openParen + 1, closeParen)
        if (title.isEmpty() || !(url.startsWith("http://") || url.startsWith("https://"))) return null
        return ScienceLink(title = title, url = url)
    }
}
