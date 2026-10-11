package com.knowflick.app.data

import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.CardStore
import com.knowflick.app.domain.KnowledgeCard
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.util.zip.ZipInputStream

/**
 * 导入恢复策略
 */
enum class RestoreStrategy(val title: String, val description: String) {
    MERGE(
        title = "增量合并恢复 (推荐)",
        description = "保留本机已有卡片与学习历史，智能识别并合并归档中的新卡片与更新进度",
    ),
    OVERWRITE(
        title = "全量覆盖重置",
        description = "使用归档数据完全覆盖替换当前卡库，适合全新设备数据迁移",
    ),
}

/**
 * 归档文件解析预览信息
 */
data class ArchivePreview(
    val filename: String,
    val totalCards: Int,
    val readCards: Int,
    val favoritedCards: Int,
    val sourcesSummary: Map<CardSource, Int>,
    val categoriesSummary: Map<String, Int>,
    val parsedCards: List<KnowledgeCard>,
    val settingsJson: String? = null,
    val isZipArchive: Boolean = false,
)

/**
 * 智能归档导入与数据恢复引擎——**与平台无关的那一半**：
 * 自适应检测 ZIP 全量备份包（提取 cards.json 与 settings.json）与独立 JSON 镜像文件，
 * 生成预览；并按恢复策略把预览应用到卡库。
 *
 * 平台边界只剩「字节从哪来」：Android 经 SAF `Uri` 读（`:app` 的 `AndroidArchiveReader`），
 * 桌面经文件对话框读（`:desktop`）。**读了字节之后一律走这里**——不要为第二个宿主再复制一份
 * ZIP/JSON 探测逻辑（第一原则）。
 */
object ArchiveImportManager {

    /** 单次导入的字节上限（50 MiB）：两个宿主都用它约束各自的读取方式 */
    const val MAX_ARCHIVE_BYTES = 50 * 1024 * 1024

    /**
     * 把归档字节解析成预览。纯函数、不碰 IO，宿主负责读文件。
     */
    fun inspect(fileName: String, bytes: ByteArray): Result<ArchivePreview> = runCatching {
        require(bytes.size <= MAX_ARCHIVE_BYTES) {
            "归档文件大小超过 ${MAX_ARCHIVE_BYTES / 1024 / 1024} MiB 限制"
        }

        val isZip = isZipStream(bytes)
        var cards = emptyList<KnowledgeCard>()
        var settingsJson: String? = null

        if (isZip) {
            // ZIP 解压探测
            ByteArrayInputStream(bytes).use { bais ->
                ZipInputStream(bais).use { zis ->
                    var entry = zis.nextEntry
                    while (entry != null) {
                        val entryName = entry.name.lowercase()
                        if (entryName == "cards.json" || entryName.endsWith("/cards.json")) {
                            val jsonBytes = readAllBytes(zis)
                            val jsonText = String(jsonBytes, Charsets.UTF_8)
                            cards = CardFileIO.decodeListSalvaging(jsonText)
                        } else if (entryName == "settings.json" || entryName.endsWith("/settings.json")) {
                            val jsonBytes = readAllBytes(zis)
                            settingsJson = String(jsonBytes, Charsets.UTF_8)
                        }
                        zis.closeEntry()
                        entry = zis.nextEntry
                    }
                }
            }
        } else {
            // 纯 JSON 解析
            val jsonText = String(bytes, Charsets.UTF_8)
            cards = CardFileIO.decodeListSalvaging(jsonText)
        }

        if (cards.isEmpty()) {
            throw IllegalArgumentException("所选文件中未检测到有效的 KnowFlick 卡片数据")
        }

        val readCount = cards.count { it.seenAt != null }
        val favCount = cards.count { it.isFavorite }
        val sources = cards.groupingBy { it.source }.eachCount()
        val categories = cards.groupingBy { it.category }.eachCount()

        ArchivePreview(
            filename = fileName,
            totalCards = cards.size,
            readCards = readCount,
            favoritedCards = favCount,
            sourcesSummary = sources,
            categoriesSummary = categories,
            parsedCards = cards,
            settingsJson = settingsJson,
            isZipArchive = isZip,
        )
    }

    /**
     * 根据恢复策略将解析预览应用到卡库
     */
    fun applyRestore(
        store: CardStore,
        preview: ArchivePreview,
        strategy: RestoreStrategy,
    ): CardStore.ArchiveRestoreResult {
        return when (strategy) {
            RestoreStrategy.MERGE -> {
                store.restoreArchive(preview.parsedCards, insertNewAtTop = true)
            }
            RestoreStrategy.OVERWRITE -> {
                store.replaceAll(preview.parsedCards)
                CardStore.ArchiveRestoreResult(
                    added = preview.parsedCards.size,
                    restored = 0,
                    ignored = 0,
                )
            }
        }
    }

    private fun isZipStream(bytes: ByteArray): Boolean {
        if (bytes.size < 4) return false
        // ZIP 本地文件头魔数: PK\x03\x04
        return bytes[0] == 0x50.toByte() &&
            bytes[1] == 0x4B.toByte() &&
            (bytes[2] == 0x03.toByte() && bytes[3] == 0x04.toByte() ||
                bytes[2] == 0x05.toByte() && bytes[3] == 0x06.toByte())
    }

    private fun readAllBytes(input: InputStream): ByteArray {
        val baos = ByteArrayOutputStream()
        val buffer = ByteArray(4 * 1024)
        var len: Int
        while (input.read(buffer).also { len = it } != -1) {
            baos.write(buffer, 0, len)
        }
        return baos.toByteArray()
    }
}
