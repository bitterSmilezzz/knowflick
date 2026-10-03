package com.knowflick.app.data

import com.knowflick.app.domain.CardJson
import com.knowflick.app.domain.KnowledgeCard
import java.io.File
import java.io.InputStream
import java.io.ByteArrayOutputStream
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

/** 卡片文件 IO 辅助（统一 JSON 实例 + 逐卡挽救解码） */
object CardFileIO {
    const val MAX_IMPORT_BYTES: Int = 25 * 1024 * 1024
    private val json = Json { ignoreUnknownKeys = true }

    fun decodeList(text: String): List<KnowledgeCard> =
        json.decodeFromString(ListSerializer(CardJson.CardJsonSerializer), text)

    fun encodeList(cards: List<KnowledgeCard>): String =
        json.encodeToString(ListSerializer(CardJson.CardJsonSerializer), cards)

    /** 逐卡挽救解码：一张坏卡不再拖垮整个文件（对齐 macOS parseJSON 宽松语义）。
     *  兼容 v2 信封与旧裸列表两种顶层形态（SYNC_PROTOCOL.md §3）：
     *  归档/导入文件可能是信封对象（取 cards 数组逐卡挽救），也可能是历史裸数组；
     *  非法或空载荷返回空列表，由调用方上浮「未检测到有效数据」。 */
    fun decodeListSalvaging(text: String): List<KnowledgeCard> {
        val root = runCatching { Json.parseToJsonElement(text) }.getOrNull() ?: return emptyList()
        val array = when (root) {
            is JsonArray -> root
            is JsonObject -> root["cards"] as? JsonArray ?: return emptyList()
            else -> return emptyList()
        }
        return array.mapNotNull { element ->
            runCatching { CardJson.fromJsonElement(element) }.getOrNull()
        }
    }

    /** 有上限地读取导入流，防止超大文件占满内存；读取和解析应由调用方放在 IO 线程。 */
    fun decodeStreamSalvaging(input: InputStream, maxBytes: Int = MAX_IMPORT_BYTES): List<KnowledgeCard> {
        require(maxBytes > 0) { "maxBytes 必须大于 0" }
        val output = ByteArrayOutputStream(minOf(maxBytes, 64 * 1024))
        val buffer = ByteArray(8 * 1024)
        var total = 0
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            total += read
            require(total <= maxBytes) { "导入文件超过 ${maxBytes / 1024 / 1024} MiB 上限" }
            output.write(buffer, 0, read)
        }
        return decodeListSalvaging(output.toString(Charsets.UTF_8.name()))
    }

    /** 备份文件路径（供测试断言轮转行为） */
    fun backupFile(baseDir: File): File = File(baseDir, "cards.backup.json")

    /** 第二代备份文件路径（B7 数据纵深：主文件 → backup → backup.2） */
    fun backup2File(baseDir: File): File = File(baseDir, "cards.backup.2.json")
}
