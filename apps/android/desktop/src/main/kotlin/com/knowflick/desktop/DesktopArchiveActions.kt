package com.knowflick.desktop

import com.knowflick.app.data.AppModel
import com.knowflick.app.data.ArchiveImportManager
import com.knowflick.app.data.CardExportEngine
import com.knowflick.app.data.RestoreStrategy
import com.knowflick.app.domain.CardStore
import com.knowflick.app.domain.KnowledgeCard
import java.io.File

/**
 * 桌面端的归档动作：**归档怎么解析、导出成什么格式，全部由 `:shared-data` 的引擎决定**，
 * 这里只做「选文件 / 写文件」这一层平台边界（第一原则：不要为第二个宿主复制逻辑）。
 *
 * 字节进出被刻意做成纯函数（[importBytes] / [exportJson]），一是便于无头测试，
 * 二是让对话框只负责取字节。
 */
object DesktopArchiveActions {

    /**
     * 导入归档字节：探测（ZIP / JSON）→ 按策略合并进卡库 → 落盘。
     * 与 Android 端走的是同一份 `ArchiveImportManager` 与同一份 `CardStorage`。
     */
    fun importBytes(
        model: AppModel,
        fileName: String,
        bytes: ByteArray,
        strategy: RestoreStrategy = RestoreStrategy.MERGE,
    ): Result<CardStore.ArchiveRestoreResult> =
        ArchiveImportManager.inspect(fileName, bytes).map { preview ->
            val result = ArchiveImportManager.applyRestore(model.store, preview, strategy)
            model.persistNow()
            result
        }

    /** 收藏阁导出为 Markdown（与 Android 端同一份实现） */
    fun exportMarkdown(cards: List<KnowledgeCard>, title: String): String =
        CardExportEngine.exportMarkdownSingleFile(cards, title)

    /** 整库导出为 JSON 镜像（与 Android 端同一份实现） */
    fun exportJson(cards: List<KnowledgeCard>): String =
        CardExportEngine.exportJSONArchive(cards)

    /** 读归档文件的字节；超过共享上限时提前拒绝，错误文案与两端一致 */
    fun readArchiveBytes(file: File): ByteArray {
        require(file.length() <= ArchiveImportManager.MAX_ARCHIVE_BYTES) {
            "归档文件大小超过 ${ArchiveImportManager.MAX_ARCHIVE_BYTES / 1024 / 1024} MiB 限制"
        }
        return file.readBytes()
    }
}
