package com.knowflick.desktop

import com.knowflick.app.data.CardArchiveEngine
import com.knowflick.app.domain.ArchiveExportFormat
import com.knowflick.app.domain.ArchiveExportScope
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.ui.common.ArchiveExportCancelled
import com.knowflick.app.ui.common.ArchiveExporter
import java.awt.Frame
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 桌面侧的导出落地：字节仍由共享 `CardArchiveEngine` 生成，这里只弹出原生「另存为」并写文件。
 * 没有系统分享（[ArchiveExporter.canShare] 为 false，面板会藏起分享按钮）。
 *
 * [pickSaveFile] 可注入，无头测试不必真的弹出对话框。
 */
class DesktopArchiveExporter(
    private val owner: () -> Frame? = { null },
    private val pickSaveFile: (title: String, defaultName: String) -> File? = { title, defaultName ->
        DesktopFileDialogs.saveFile(owner(), title, defaultName)
    },
) : ArchiveExporter {

    override val canShare: Boolean = false
    override val saveLabel: String = "另存为"

    override suspend fun export(
        scope: ArchiveExportScope,
        format: ArchiveExportFormat,
        cards: List<KnowledgeCard>,
        settingsJson: String?,
    ): Result<String> {
        val (filename, bytes) = withContext(Dispatchers.IO) {
            CardArchiveEngine.generateExportData(cards, format, settingsJson)
        }
        val target = pickSaveFile("导出${format.title}", filename)
            ?: return Result.failure(ArchiveExportCancelled())
        return withContext(Dispatchers.IO) {
            runCatching {
                target.parentFile?.mkdirs()
                target.writeBytes(bytes)
                target.absolutePath
            }
        }
    }
}
