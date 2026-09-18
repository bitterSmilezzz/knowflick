package com.knowflick.app.data

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
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
 * 智能归档导入与数据恢复引擎：
 * 支持自适应检测 ZIP 全量备份包（提取 cards.json 与 settings.json）与独立 JSON 镜像文件。
 */
object ArchiveImportManager {

    private const val MAX_ARCHIVE_BYTES = 50 * 1024 * 1024 // 50 MiB 导入上限

    /**
     * 从指定 SAF Uri 读取并检测归档内容，生成解析预览
     */
    fun inspectArchive(context: Context, uri: Uri): Result<ArchivePreview> {
        return runCatching {
            val filename = queryDisplayName(context, uri) ?: "archive_data"
            val bytes = readBytesLimited(context, uri, MAX_ARCHIVE_BYTES)

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
                filename = filename,
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

    private fun queryDisplayName(context: Context, uri: Uri): String? {
        if (uri.scheme == "content") {
            try {
                context.contentResolver.query(
                    uri,
                    arrayOf(OpenableColumns.DISPLAY_NAME),
                    null,
                    null,
                    null,
                )?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val colIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        if (colIndex != -1) {
                            return cursor.getString(colIndex)
                        }
                    }
                }
            } catch (_: Exception) {
                // 回退处理
            }
        }
        return uri.lastPathSegment?.substringAfterLast('/')
    }

    private fun readBytesLimited(context: Context, uri: Uri, maxBytes: Int): ByteArray {
        val stream = context.contentResolver.openInputStream(uri)
            ?: throw IllegalArgumentException("无法打开文件输入流")
        return stream.use { input ->
            val baos = ByteArrayOutputStream(minOf(maxBytes, 64 * 1024))
            val buffer = ByteArray(8 * 1024)
            var total = 0
            while (true) {
                val len = input.read(buffer)
                if (len < 0) break
                total += len
                if (total > maxBytes) {
                    throw IllegalArgumentException("归档文件大小超过 ${maxBytes / 1024 / 1024} MiB 限制")
                }
                baos.write(buffer, 0, len)
            }
            baos.toByteArray()
        }
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
