package com.knowflick.app.data

import com.knowflick.app.domain.KnowledgeCard
import java.io.File

/** 保存结果（与 macOS 端 CardSaveResult 对齐） */
sealed class CardSaveResult {
    data object Saved : CardSaveResult()
    data class SavedWithoutBackup(val reason: String) : CardSaveResult()
    data class Failed(val message: String) : CardSaveResult()
}

/**
 * 本地 JSON 存储：cards.json（原子写）+ cards.backup.json（上一版字节轮转）+ settings.json。
 * 目录可注入以便 JVM 测试；默认目录为应用私有 files 目录（Android 无外部存储依赖）。
 */
class CardStorage(private val baseDir: File) {

    init {
        baseDir.mkdirs()
    }

    private val cardsFile: File get() = File(baseDir, "cards.json")
    private val backupFile: File get() = File(baseDir, "cards.backup.json")

    /** 损坏标记：加载发现主文件损坏后置位，下次备份轮转前解码校验（快路径常态零解码） */
    @Volatile
    private var corruptionFlag = false

    /** 保存卡片：主文件原子写，旧主文件字节轮转进备份 */
    @Synchronized
    fun saveCards(cards: List<KnowledgeCard>): CardSaveResult {
        val data = try {
            CardFileIO.encodeList(cards).toByteArray(Charsets.UTF_8)
        } catch (e: Exception) {
            return CardSaveResult.Failed("卡片编码失败: ${e.message}")
        }
        val previous = if (cardsFile.exists()) cardsFile.readBytes() else null
        val backupData: ByteArray = when {
            previous == null -> data
            corruptionFlag -> {
                // 仅当加载期发现过损坏时才解码校验，避免把坏字节转进备份
                val healthy = runCatching { CardFileIO.decodeList(previous.decodeToString()) }.getOrNull()
                if (!healthy.isNullOrEmpty()) previous else data
            }
            else -> previous
        }
        var backupError: String? = null
        try {
            backupFile.writeBytes(backupData)
        } catch (e: Exception) {
            backupError = e.message
        }
        return try {
            cardsFile.writeBytes(data)
            corruptionFlag = false   // 主文件已是本进程写出的健康内容
            if (backupError != null) CardSaveResult.SavedWithoutBackup(backupError!!) else CardSaveResult.Saved
        } catch (e: Exception) {
            CardSaveResult.Failed(e.message ?: "未知写入失败")
        }
    }

    /** 加载卡片：主文件 → 备份（并重建主文件）→ 空（种子合并由调用方负责） */
    fun loadCards(): List<KnowledgeCard> {
        val main = readFileSafe(cardsFile)
        val mainCards = main?.let { bytes ->
            runCatching { CardFileIO.decodeList(bytes.decodeToString()) }.getOrNull()
        }
        if (!mainCards.isNullOrEmpty()) return mainCards

        val backup = readFileSafe(backupFile)
        val backupCards = backup?.let { bytes ->
            runCatching { CardFileIO.decodeList(bytes.decodeToString()) }.getOrNull()
        }
        if (!backupCards.isNullOrEmpty()) {
            corruptionFlag = true
            saveCards(backupCards)   // 重建健康主文件
            return backupCards
        }
        corruptionFlag = true
        return emptyList()
    }

    /** 设置（AI 配置等）原样 JSON 字符串存取；编解码由 SettingsStore 负责 */
    fun loadSettingsJson(): String? =
        readFileSafe(File(baseDir, "settings.json"))?.decodeToString()

    fun saveSettingsJson(json: String): Boolean = try {
        File(baseDir, "settings.json").writeText(json)
        true
    } catch (_: Exception) {
        false
    }

    private fun readFileSafe(file: File): ByteArray? = try {
        if (file.exists() && file.isFile) file.readBytes() else null
    } catch (_: Exception) {
        null
    }
}
