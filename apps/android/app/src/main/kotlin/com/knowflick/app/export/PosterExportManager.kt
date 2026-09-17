package com.knowflick.app.export

import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.FileProvider
import com.knowflick.app.domain.KnowledgeCard
import java.io.File
import java.io.FileOutputStream

/**
 * 海报导出协调器：负责系统相册保存、原生 Sharesheet 分享与剪贴板操作。
 */
object PosterExportManager {

    /**
     * 将海报保存至系统相册 (Pictures/KnowFlick)。
     * 兼容 Android 10+ 分区存储 (Scoped Storage) 与早期版本。
     */
    fun saveToGallery(
        context: Context,
        bitmap: Bitmap,
        card: KnowledgeCard,
    ): Result<Uri> {
        return runCatching {
            val safeCategory = card.category.replace(Regex("[^A-Za-z0-9\\u4E00-\\u9FFF]"), "_")
            val safeTitle = card.headline.take(12).replace(Regex("[^A-Za-z0-9\\u4E00-\\u9FFF]"), "_")
            val filename = "KnowFlick_${safeCategory}_${safeTitle}_${System.currentTimeMillis()}.png"

            val resolver = context.contentResolver
            val contentValues = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, filename)
                put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/KnowFlick")
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                }
            }

            val imageUri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, contentValues)
                ?: error("无法在系统相册创建媒体项")

            resolver.openOutputStream(imageUri)?.use { os ->
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, os)
            } ?: error("无法写入图片输出流")

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                contentValues.clear()
                contentValues.put(MediaStore.Images.Media.IS_PENDING, 0)
                resolver.update(imageUri, contentValues, null, null)
            } else {
                // 老版本通知 MediaScanner 刷新
                val filePath = getLegacyPath(context, imageUri)
                if (filePath != null) {
                    MediaScannerConnection.scanFile(context, arrayOf(filePath), arrayOf("image/png"), null)
                }
            }

            imageUri
        }
    }

    /**
     * 构建调起系统分享菜单的 Intent。
     */
    fun createShareIntent(
        context: Context,
        bitmap: Bitmap,
        card: KnowledgeCard,
    ): Intent {
        val shareDir = File(context.cacheDir, "shares").apply {
            if (!exists()) mkdirs()
        }
        // 清理 24 小时前的旧分享图片
        val cutoff = System.currentTimeMillis() - 24 * 60 * 60 * 1000L
        shareDir.listFiles()?.filter { it.lastModified() < cutoff }?.forEach { it.delete() }

        val safeTitle = card.headline.take(8).replace(Regex("[^A-Za-z0-9\\u4E00-\\u9FFF]"), "_")
        val file = File(shareDir, "poster_${System.nanoTime()}_$safeTitle.png").canonicalFile
        FileOutputStream(file).use { os ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, os)
        }

        val contentUri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.files",
            file,
        )

        val shareIntent = Intent(Intent.ACTION_SEND).apply {
            type = "image/png"
            putExtra(Intent.EXTRA_STREAM, contentUri)
            putExtra(
                Intent.EXTRA_TEXT,
                "“${card.summary}” ——《${card.headline}》· 来自 KnowFlick 知识卡片",
            )
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

        return Intent.createChooser(shareIntent, "分享知识海报")
    }

    /**
     * 复制卡片知识文本至剪贴板。
     */
    fun copyCardText(context: Context, card: KnowledgeCard) {
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val text = buildString {
            append("【").append(card.category).append("】").append(card.headline).append("\n\n")
            append("“").append(card.summary).append("”\n\n")
            append(card.details).append("\n\n")
            append("— 每天学点新东西 · KnowFlick")
        }
        val clip = ClipData.newPlainText("KnowFlick Card", text)
        clipboard.setPrimaryClip(clip)
    }

    private fun getLegacyPath(context: Context, uri: Uri): String? {
        return runCatching {
            val proj = arrayOf(MediaStore.Images.Media.DATA)
            context.contentResolver.query(uri, proj, null, null, null)?.use { cursor ->
                val colIdx = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATA)
                if (cursor.moveToFirst()) cursor.getString(colIdx) else null
            }
        }.getOrNull()
    }
}
