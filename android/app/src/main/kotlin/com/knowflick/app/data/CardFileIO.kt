package com.knowflick.app.data

import com.knowflick.app.domain.CardJson
import com.knowflick.app.domain.KnowledgeCard
import java.io.File
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray

/** 卡片文件 IO 辅助（统一 JSON 实例 + 逐卡挽救解码） */
object CardFileIO {
    private val json = Json { ignoreUnknownKeys = true }

    fun decodeList(text: String): List<KnowledgeCard> =
        json.decodeFromString(ListSerializer(CardJson.CardJsonSerializer), text)

    fun encodeList(cards: List<KnowledgeCard>): String =
        json.encodeToString(ListSerializer(CardJson.CardJsonSerializer), cards)

    /** 逐卡挽救解码：一张坏卡不再拖垮整个文件（对齐 macOS parseJSON 宽松语义） */
    fun decodeListSalvaging(text: String): List<KnowledgeCard> {
        val array = runCatching { Json.parseToJsonElement(text).jsonArray }.getOrNull()
            ?: return emptyList()
        return array.mapNotNull { element ->
            runCatching { CardJson.fromJsonElement(element) }.getOrNull()
        }
    }

    /** 备份文件路径（供测试断言轮转行为） */
    fun backupFile(baseDir: File): File = File(baseDir, "cards.backup.json")
}
