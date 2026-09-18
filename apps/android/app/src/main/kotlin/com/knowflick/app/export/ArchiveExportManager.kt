package com.knowflick.app.export

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream

/**
 * 离线归档与全量备份导出管理器：
 * 支持通过 MediaStore 写入 Download/KnowFlick 公共目录，
 * 以及通过 FileProvider 调起系统 Sharesheet 原生分享。
 */
object ArchiveExportManager {

    /**
     * 将归档/备份文件保存至公共下载目录 (Download/KnowFlick)。
     * 兼容 Android 10+ 分区存储 (Scoped Storage) 与旧版文件系统。
     *
     * @return 成功保存后的友好文件路径提示字符串，如 "Download/KnowFlick/knowflick_backup_20260918.zip"
     */
    fun saveToDownloads(
        context: Context,
        filename: String,
        mimeType: String,
        bytes: ByteArray,
    ): Result<String> {
        return runCatching {
            val resolver = context.contentResolver
            val relativeDir = "${Environment.DIRECTORY_DOWNLOADS}/KnowFlick"

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val contentValues = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, filename)
                    put(MediaStore.Downloads.MIME_TYPE, mimeType)
                    put(MediaStore.Downloads.RELATIVE_PATH, relativeDir)
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }

                val itemUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, contentValues)
                    ?: error("无法在系统下载目录创建文件项")

                try {
                    resolver.openOutputStream(itemUri)?.use { os ->
                        os.write(bytes)
                        os.flush()
                    } ?: error("无法打开文件写入流")
                } finally {
                    contentValues.clear()
                    contentValues.put(MediaStore.Downloads.IS_PENDING, 0)
                    resolver.update(itemUri, contentValues, null, null)
                }
            } else {
                @Suppress("DEPRECATION")
                val baseDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                val targetDir = File(baseDir, "KnowFlick").apply {
                    if (!exists()) mkdirs()
                }
                val targetFile = File(targetDir, filename)
                FileOutputStream(targetFile).use { os ->
                    os.write(bytes)
                    os.flush()
                }
                MediaScannerConnection.scanFile(context, arrayOf(targetFile.absolutePath), arrayOf(mimeType), null)
            }

            "$relativeDir/$filename"
        }
    }

    /**
     * 写入应用临时缓存目录并构建调起系统 Sharesheet 的 Intent。
     */
    fun createShareIntent(
        context: Context,
        filename: String,
        mimeType: String,
        bytes: ByteArray,
        chooserTitle: String = "分享知识库数据",
    ): Result<Intent> {
        return runCatching {
            val shareDir = File(context.cacheDir, "shares").apply {
                if (!exists()) mkdirs()
            }

            // 清理 24 小时前的过期临时文件
            val cutoff = System.currentTimeMillis() - 24 * 60 * 60 * 1000L
            shareDir.listFiles()?.filter { it.lastModified() < cutoff }?.forEach { it.delete() }

            val file = File(shareDir, filename).canonicalFile
            FileOutputStream(file).use { os ->
                os.write(bytes)
                os.flush()
            }

            val contentUri: Uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.files",
                file,
            )

            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = mimeType
                putExtra(Intent.EXTRA_STREAM, contentUri)
                putExtra(Intent.EXTRA_SUBJECT, filename)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            Intent.createChooser(shareIntent, chooserTitle).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        }
    }
}
