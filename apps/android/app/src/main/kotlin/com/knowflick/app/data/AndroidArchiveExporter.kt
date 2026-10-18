package com.knowflick.app.data

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import com.knowflick.app.domain.ArchiveExportFormat
import com.knowflick.app.domain.ArchiveExportScope
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.export.ArchiveExportManager
import com.knowflick.app.ui.common.ArchiveExporter
import com.knowflick.app.ui.common.LocalArchiveExporter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Android 侧的导出落地方式：**生成字节仍走共享引擎**（`:shared-data` 的 `CardArchiveEngine`），
 * 这里只做平台动作——写进系统 Downloads（MediaStore）与唤起系统分享。
 *
 * 共享的导出面板（`:shared-ui` 的 `BackupExportSheet`）通过 `LocalArchiveExporter` 调到它，
 * 所以面板本身不需要 `Context`、也不需要看见引擎类型。
 */
@Composable
fun ProvideAndroidArchiveExporter(content: @Composable () -> Unit) {
    val context = LocalContext.current
    val exporter = remember(context) { AndroidArchiveExporter(context) }
    CompositionLocalProvider(LocalArchiveExporter provides exporter) { content() }
}

private class AndroidArchiveExporter(private val context: Context) : ArchiveExporter {

    override val canShare: Boolean = true
    override val saveLabel: String = "保存至下载目录"

    override suspend fun export(
        scope: ArchiveExportScope,
        format: ArchiveExportFormat,
        cards: List<KnowledgeCard>,
        settingsJson: String?,
    ): Result<String> = withContext(Dispatchers.IO) {
        val (filename, bytes) = CardArchiveEngine.generateExportData(cards, format, settingsJson)
        ArchiveExportManager.saveToDownloads(
            context = context,
            filename = filename,
            mimeType = format.mimeType,
            bytes = bytes,
        )
    }

    override suspend fun share(
        scope: ArchiveExportScope,
        format: ArchiveExportFormat,
        cards: List<KnowledgeCard>,
        settingsJson: String?,
    ): Result<Unit> {
        val intent = withContext(Dispatchers.IO) {
            val (filename, bytes) = CardArchiveEngine.generateExportData(cards, format, settingsJson)
            ArchiveExportManager.createShareIntent(
                context = context,
                filename = filename,
                mimeType = format.mimeType,
                bytes = bytes,
                chooserTitle = "分享 ${format.title}",
            )
        }
        return intent.map { context.startActivity(it) }
    }
}
