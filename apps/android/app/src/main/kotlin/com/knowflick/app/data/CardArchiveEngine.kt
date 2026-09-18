package com.knowflick.app.data

import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.KnowledgeCard
import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** 导出目标格式定义 */
enum class ArchiveExportFormat(
    val title: String,
    val fileExtension: String,
    val mimeType: String,
    val description: String,
    val isRecommended: Boolean = false,
) {
    ZIP_FULL_BACKUP(
        title = "ZIP 全量数据备份包",
        fileExtension = "zip",
        mimeType = "application/zip",
        description = "完整卡片数据、学习足迹、收藏与配置，支持跨端恢复与防止数据丢失",
        isRecommended = true,
    ),
    JSON_ARCHIVE(
        title = "JSON 结构化镜像",
        fileExtension = "json",
        mimeType = "application/json",
        description = "标准 JSON 数组，包含所有字段及学习状态，全平台通用交换格式",
    ),
    MARKDOWN_SINGLE(
        title = "Markdown 整合排版笔记",
        fileExtension = "md",
        mimeType = "text/markdown",
        description = "含 YAML 元数据、目录跳转索引、核心观点与延伸链接，兼容各类笔记软件",
    ),
    OBSIDIAN_VAULT_ZIP(
        title = "Obsidian 独立双链笔记包",
        fileExtension = "zip",
        mimeType = "application/zip",
        description = "每张卡片生成独立 .md 文档，支持 [[分类]] 双链与 #标签，开箱即用",
    ),
    ANKI_TSV(
        title = "Anki 记忆牌组卡片",
        fileExtension = "tsv",
        mimeType = "text/tab-separated-values",
        description = "制表符分隔 TSV 文件，正面核心主张，背面深入解析，支持一键导入 Anki",
    ),
}

/** 导出范围筛选 */
enum class ArchiveExportScope(val title: String) {
    ALL("全部卡库"),
    FAVORITES("仅收藏阁"),
    HISTORY("历史足迹"),
}

/**
 * 离线归档与全量数据导出引擎：
 * 纯标准库实现，支持 ZIP 压缩包、JSON、Markdown、Obsidian 笔记及 Anki 牌组。
 */
object CardArchiveEngine {

    private val fileTimestampFormat = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault())
    private val readableDateFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())

    /**
     * 根据格式与卡片列表生成标准二进制产物及建议文件名
     */
    fun generateExportData(
        cards: List<KnowledgeCard>,
        format: ArchiveExportFormat,
        settingsJson: String? = null,
        customTitle: String? = null,
    ): Pair<String, ByteArray> {
        val timestamp = fileTimestampFormat.format(Date())
        val filename = when (format) {
            ArchiveExportFormat.ZIP_FULL_BACKUP -> "knowflick_backup_$timestamp.zip"
            ArchiveExportFormat.JSON_ARCHIVE -> "knowflick_cards_$timestamp.json"
            ArchiveExportFormat.MARKDOWN_SINGLE -> "knowflick_notes_$timestamp.md"
            ArchiveExportFormat.OBSIDIAN_VAULT_ZIP -> "knowflick_obsidian_$timestamp.zip"
            ArchiveExportFormat.ANKI_TSV -> "knowflick_anki_$timestamp.tsv"
        }

        val bytes = when (format) {
            ArchiveExportFormat.ZIP_FULL_BACKUP -> buildFullBackupZip(cards, settingsJson)
            ArchiveExportFormat.JSON_ARCHIVE -> buildJsonArchive(cards)
            ArchiveExportFormat.MARKDOWN_SINGLE -> buildMarkdownSingle(cards, customTitle ?: "KnowFlick 知识卡片")
            ArchiveExportFormat.OBSIDIAN_VAULT_ZIP -> buildObsidianVaultZip(cards)
            ArchiveExportFormat.ANKI_TSV -> buildAnkiTSV(cards)
        }

        return filename to bytes
    }

    /** 生成 ZIP 全量备份包（包含 cards.json、manifest.json、settings.json 与 README.txt） */
    fun buildFullBackupZip(cards: List<KnowledgeCard>, settingsJson: String? = null): ByteArray {
        val nowStr = readableDateFormat.format(Date())
        val favoritesCount = cards.count { it.isFavorite }
        val historyCount = cards.count { it.seenAt != null }

        val manifestJson = buildJsonObject {
            put("app", "KnowFlick")
            put("platform", "Android")
            put("version", "0.8.7")
            put("exportTime", nowStr)
            put("totalCards", cards.size)
            put("favoriteCards", favoritesCount)
            put("historyCards", historyCount)
            put("formatVersion", 1)
        }.toString()

        val readmeContent = """
            # KnowFlick 知识库离线完整备份包
            
            - 导出时间：$nowStr
            - 卡片总数：${cards.size} 张
            - 收藏卡片：$favoritesCount 张
            - 浏览历史：$historyCount 张
            
            文件结构：
            - cards.json: 包含全量卡片正文、分类、UUID、浏览时间及熟练度评分
            - manifest.json: 备份包元数据与校验信息
            - settings.json: 用户个性化偏好配置
            
            恢复方法：
            在 KnowFlick「知识库」或首页「更多」菜单中，点击「导入数据恢复…」，
            选择此 ZIP 压缩包即可一键恢复所有卡片与学习进度。
        """.trimIndent()

        val cardsJson = CardFileIO.encodeList(cards)

        val bos = ByteArrayOutputStream()
        ZipOutputStream(bos).use { zos ->
            // 1. cards.json
            zos.putNextEntry(ZipEntry("cards.json"))
            zos.write(cardsJson.toByteArray(StandardCharsets.UTF_8))
            zos.closeEntry()

            // 2. manifest.json
            zos.putNextEntry(ZipEntry("manifest.json"))
            zos.write(manifestJson.toByteArray(StandardCharsets.UTF_8))
            zos.closeEntry()

            // 3. settings.json
            if (!settingsJson.isNullOrBlank()) {
                zos.putNextEntry(ZipEntry("settings.json"))
                zos.write(settingsJson.toByteArray(StandardCharsets.UTF_8))
                zos.closeEntry()
            }

            // 4. README.txt
            zos.putNextEntry(ZipEntry("README.txt"))
            zos.write(readmeContent.toByteArray(StandardCharsets.UTF_8))
            zos.closeEntry()
        }

        return bos.toByteArray()
    }

    /** 生成 JSON 结构化归档字节流 */
    fun buildJsonArchive(cards: List<KnowledgeCard>): ByteArray {
        return CardFileIO.encodeList(cards).toByteArray(StandardCharsets.UTF_8)
    }

    /** 生成 Markdown 整合排版单文档 */
    fun buildMarkdownSingle(cards: List<KnowledgeCard>, title: String): ByteArray {
        val content = CardExportEngine.exportMarkdownSingleFile(cards, title)
        return content.toByteArray(StandardCharsets.UTF_8)
    }

    /** 生成 Obsidian 双链笔记 ZIP 压缩包 */
    fun buildObsidianVaultZip(cards: List<KnowledgeCard>): ByteArray {
        val dayFormatter = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
        val bos = ByteArrayOutputStream()
        val usedFilenames = mutableSetOf<String>()

        ZipOutputStream(bos).use { zos ->
            // 1. README.md
            val readme = """
                # KnowFlick Obsidian 知识库
                
                本知识库包含 ${cards.size} 张精选结构化卡片笔记。
                所有卡片均已预置 YAML Frontmatter、分类标签与 [[分类]] 双向链接，开箱即用。
            """.trimIndent()
            zos.putNextEntry(ZipEntry("README.md"))
            zos.write(readme.toByteArray(StandardCharsets.UTF_8))
            zos.closeEntry()

            cards.forEach { card ->
                val categoryName = card.category.ifBlank { "通用知识" }
                val safeHeadline = sanitizeFilename(card.headline)
                var baseName = sanitizeFilename("[$categoryName] $safeHeadline")
                if (baseName.length > 60) {
                    baseName = baseName.take(60)
                }
                var fileName = "cards/$baseName.md"
                var counter = 1
                while (usedFilenames.contains(fileName.lowercase(Locale.ROOT))) {
                    fileName = "cards/$baseName ($counter).md"
                    counter++
                }
                usedFilenames.add(fileName.lowercase(Locale.ROOT))

                val createdStr = dayFormatter.format(Date(card.createdAt))
                val safeCategoryTag = categoryName.replace(" ", "_")
                val sourceTag = card.source.raw

                val md = buildString {
                    appendLine("---")
                    appendLine("id: \"${card.id}\"")
                    appendLine("title: \"${card.headline.replace("\"", "\\\"")}\"")
                    appendLine("category: \"$categoryName\"")
                    appendLine("source: \"$sourceTag\"")
                    appendLine("created: \"$createdStr\"")
                    appendLine("mastery: ${card.masteryLevel}")
                    appendLine("tags:")
                    appendLine("  - knowflick")
                    appendLine("  - $safeCategoryTag")
                    appendLine("  - $sourceTag")
                    appendLine("---")
                    appendLine()
                    appendLine("# ${card.headline}")
                    appendLine()
                    val sourceDisplay = when (card.source) {
                        CardSource.AI -> "🤖 AI 灵感探索"
                        CardSource.IMPORTED -> "📥 外部笔记提纯"
                        CardSource.SEED -> "🌱 精选经典"
                    }
                    appendLine("**领域分类**：[[$categoryName]] · **知识来源**：$sourceDisplay")
                    appendLine()
                    appendLine("> **核心主张**")
                    appendLine("> ${card.summary}")
                    appendLine()
                    appendLine("## 深入解析")
                    appendLine()
                    appendLine(card.details)
                    appendLine()
                    if (card.links.isNotEmpty()) {
                        appendLine("## 延伸探索")
                        appendLine()
                        card.links.forEach { link ->
                            appendLine("- [${link.title}](${link.url})")
                        }
                        appendLine()
                    }
                }

                zos.putNextEntry(ZipEntry(fileName))
                zos.write(md.toByteArray(StandardCharsets.UTF_8))
                zos.closeEntry()
            }
        }

        return bos.toByteArray()
    }

    /** 生成 Anki 牌组 TSV 格式字节流 */
    fun buildAnkiTSV(cards: List<KnowledgeCard>): ByteArray {
        val content = CardExportEngine.exportAnkiTSV(cards)
        return content.toByteArray(StandardCharsets.UTF_8)
    }

    private fun sanitizeFilename(name: String): String {
        return name.replace(Regex("[\\\\/:*?\"<>|\n\r\t]"), "_").trim()
    }
}
