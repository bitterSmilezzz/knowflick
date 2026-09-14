package com.knowflick.app.data

import android.content.Context
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File

data class SharedTextFile(
    val uri: Uri,
    val file: File,
    val mimeType: String,
)

/** 把导出内容写成可授权读取的缓存文件，避免用 Intent EXTRA_TEXT 传大归档。 */
object ShareFileWriter {
    fun create(context: Context, text: String, requestedName: String): SharedTextFile {
        val directory = File(context.cacheDir, "shares").apply {
            check(exists() || mkdirs()) { "无法创建分享缓存目录" }
        }
        val cutoff = System.currentTimeMillis() - 24 * 60 * 60 * 1_000L
        directory.listFiles()?.filter { it.lastModified() < cutoff }?.forEach { it.delete() }

        val safeName = requestedName
            .substringAfterLast('/')
            .substringAfterLast('\\')
            .replace(Regex("[^A-Za-z0-9._\\-\\u4E00-\\u9FFF]"), "_")
            .trim('.', '_')
            .ifBlank { "knowflick_export.txt" }
        // 同名分享不能原地截断：接收方（或上一次的分享 Intent）可能仍在读旧文件。
        // 每次都写唯一文件，避免覆盖正在被读取的内容。
        val uniqueName = "${System.nanoTime()}_$safeName"
        val file = File(directory, uniqueName)
        file.writeText(text, Charsets.UTF_8)
        val mimeType = when (file.extension.lowercase()) {
            "json" -> "application/json"
            "md", "markdown" -> "text/markdown"
            "tsv" -> "text/tab-separated-values"
            else -> "text/plain"
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        return SharedTextFile(uri = uri, file = file, mimeType = mimeType)
    }
}
