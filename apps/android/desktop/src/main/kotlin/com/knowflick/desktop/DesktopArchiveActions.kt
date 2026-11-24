package com.knowflick.desktop

import com.knowflick.app.data.AppModel
import com.knowflick.app.data.ArchiveImportManager
import com.knowflick.app.domain.ArchivePreview
import com.knowflick.app.data.CardExportEngine
import com.knowflick.app.domain.RestoreStrategy
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
     * 第一步：探测归档（ZIP / JSON）并给出预览——**不写库**。
     * 与 Android 同一份 `ArchiveImportManager`，也就同一份交互：先看清内容与恢复策略，再由用户确认。
     */
    fun inspectArchive(fileName: String, bytes: ByteArray): Result<ArchivePreview> =
        ArchiveImportManager.inspect(fileName, bytes)

    /** 第二步：按用户确认的策略恢复，并立即落盘 */
    fun applyPreview(
        model: AppModel,
        preview: ArchivePreview,
        strategy: RestoreStrategy = RestoreStrategy.MERGE,
    ): CardStore.ArchiveRestoreResult {
        val result = ArchiveImportManager.applyRestore(model.store, preview, strategy)
        model.persistNow()
        return result
    }

    /**
     * 一步到位的导入（探测 + 按 MERGE 合并 + 落盘）。无头测试与「不需要预览」的路径用它；
     * 交互路径走 [inspectArchive] + [applyPreview]。
     */
    fun importBytes(
        model: AppModel,
        fileName: String,
        bytes: ByteArray,
        strategy: RestoreStrategy = RestoreStrategy.MERGE,
    ): Result<CardStore.ArchiveRestoreResult> =
        inspectArchive(fileName, bytes).map { preview -> applyPreview(model, preview, strategy) }

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
