package com.knowflick.app.data

import com.knowflick.app.domain.KnowledgeCard
import java.io.File
import java.io.FileOutputStream
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

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

    companion object {
        // 同一目录进程级共享同一实例：应用持久化队列与桌面微件写回必须在同一把实例锁上
        // 串行化，各造各的实例会让 @Synchronized 形同虚设（A5 微件整库写回竞态）。
        private val sharedInstances = java.util.concurrent.ConcurrentHashMap<String, CardStorage>()

        /** 墓碑表容量上限（SYNC_PROTOCOL.md §4），超出裁最老 */
        const val TOMBSTONE_CAP = 1000

        /** 按目录取进程级共享实例；应用与微件的整库读写都应经此入口 */
        fun shared(baseDir: File): CardStorage =
            sharedInstances.computeIfAbsent(baseDir.absolutePath) { CardStorage(baseDir) }
    }

    /**
     * 原子读-改-写：在实例锁内以**最新**卡库为基线应用 transform 后整库写回。
     * 微件等调用方持有的旧快照只能当作「要施加的增量」的线索传进来，
     * 不得作为写回基线——否则两个读之间落库的应用写入会被整库冲掉。
     */
    @Synchronized
    fun updateCards(transform: (List<KnowledgeCard>) -> List<KnowledgeCard>): CardSaveResult =
        saveCards(transform(loadCards()))

    /** 保存卡片：主文件原子写，旧主文件字节轮转进备份 */
    @Synchronized
    fun saveCards(cards: List<KnowledgeCard>): CardSaveResult {
        val data = try {
            CardFileIO.encodeList(cards).toByteArray(Charsets.UTF_8)
        } catch (e: Exception) {
            return CardSaveResult.Failed("卡片编码失败: ${e.message}")
        }
        val previous = readFileSafe(cardsFile)
        val backupData: ByteArray = when {
            previous == null -> data
            corruptionFlag -> {
                // 仅当加载期发现过损坏时才解码校验，避免把坏字节转进备份
                val healthy = runCatching { CardFileIO.decodeList(previous.decodeToString()) }.getOrNull()
                if (!healthy.isNullOrEmpty()) previous else data
            }
            else -> previous
        }
        val backupError = atomicWrite(backupFile, backupData)
        return atomicWrite(cardsFile, data).let { mainError ->
            if (mainError == null) {
                corruptionFlag = false   // 主文件已是本进程写出的健康内容
                if (backupError != null) CardSaveResult.SavedWithoutBackup(backupError) else CardSaveResult.Saved
            } else {
                CardSaveResult.Failed(mainError)
            }
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

    fun saveSettingsJson(json: String): Boolean =
        atomicWrite(File(baseDir, "settings.json"), json.toByteArray(Charsets.UTF_8)) == null

    /** 语音配置单独落盘（settings.json 之外，密钥仍走 CredentialStore） */
    fun loadSpeechJson(): String? =
        readFileSafe(File(baseDir, "speech.json"))?.decodeToString()

    fun saveSpeechJson(json: String): Boolean =
        atomicWrite(File(baseDir, "speech.json"), json.toByteArray(Charsets.UTF_8)) == null

    // ---------- 墓碑表（SYNC_PROTOCOL.md §4：与卡片库同目录的独立小文件，上限 1000 裁最老） ----------

    private val tombstoneFile: File get() = File(baseDir, "tombstones.json")
    private val tombstoneSerializer = ListSerializer(com.knowflick.app.domain.Tombstone.serializer())

    /** 加载墓碑表：文件损坏时隔离（返回空表），不得让坏字节拖垮同步与卡库 */
    fun loadTombstones(): List<com.knowflick.app.domain.Tombstone> {
        val bytes = readFileSafe(tombstoneFile) ?: return emptyList()
        return try {
            jsonSerializer.decodeFromString(tombstoneSerializer, bytes.decodeToString())
        } catch (_: Throwable) {
            emptyList()
        }
    }

    /** 原子写墓碑表；超出上限（1000）按 deletedAt 裁最老，落盘保持时间升序 */
    fun saveTombstones(tombstones: List<com.knowflick.app.domain.Tombstone>): Boolean {
        val capped = if (tombstones.size <= TOMBSTONE_CAP) tombstones else {
            tombstones.sortedBy { it.deletedAt }.takeLast(TOMBSTONE_CAP)
        }
        val raw = try {
            jsonSerializer.encodeToString(tombstoneSerializer, capped)
        } catch (_: Throwable) {
            return false
        }
        return atomicWrite(tombstoneFile, raw.toByteArray(Charsets.UTF_8)) == null
    }

    // ---------- 搜索历史 (Search History) ----------

    private val stringListSerializer = ListSerializer(String.serializer())
    private val jsonSerializer = Json { ignoreUnknownKeys = true }

    /** 加载最近搜索历史（上限 8 条，LRU 顺序） */
    fun loadSearchHistory(): List<String> {
        val bytes = readFileSafe(File(baseDir, "search_history.json")) ?: return emptyList()
        return try {
            jsonSerializer.decodeFromString(stringListSerializer, bytes.decodeToString())
        } catch (_: Throwable) {
            emptyList()
        }
    }

    /** 保存搜索历史 */
    fun saveSearchHistory(history: List<String>): Boolean {
        val raw = try {
            jsonSerializer.encodeToString(stringListSerializer, history)
        } catch (_: Throwable) {
            return false
        }
        return atomicWrite(File(baseDir, "search_history.json"), raw.toByteArray(Charsets.UTF_8)) == null
    }

    /**
     * 同目录临时文件 + fsync + 原子替换；不支持 ATOMIC_MOVE 的文件系统退回安全替换。
     *
     * 已知取舍（P2-6）：rename 之后**未**对父目录做 fsync。极端掉电场景下 rename 的元数据
     * 可能未落盘，出现「主文件回退到上一版」。之所以接受该风险：① Java 层对目录取 fd 做
     * `fsync` 在 Android 上没有可移植写法（`FileOutputStream(dir)` 会抛
     * FileNotFoundException）；② 已有 `cards.backup.json` 轮转兜底，最坏结果是损失最近一次
     * 增量而非整库。若日后要严谨化，可考虑以 FileChannel + Os.fsync 走 JNI/NDK 路径。
     */
    private fun atomicWrite(target: File, data: ByteArray): String? {
        if (!baseDir.exists() && !baseDir.mkdirs()) return "无法创建存储目录"
        val temp = File(baseDir, ".${target.name}.${java.util.UUID.randomUUID()}.tmp")
        return try {
            FileOutputStream(temp).use { stream ->
                stream.write(data)
                stream.flush()
                stream.fd.sync()
            }
            try {
                Files.move(
                    temp.toPath(),
                    target.toPath(),
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING,
                )
            } catch (_: AtomicMoveNotSupportedException) {
                Files.move(temp.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING)
            }
            null
        } catch (e: Exception) {
            e.message ?: "未知写入失败"
        } finally {
            if (temp.exists()) temp.delete()
        }
    }

    private fun readFileSafe(file: File): ByteArray? = try {
        if (file.exists() && file.isFile) file.readBytes() else null
    } catch (_: Exception) {
        null
    }
}
