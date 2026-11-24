package com.knowflick.app.data

import com.knowflick.app.domain.ArchivePreview

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import java.io.ByteArrayOutputStream

/**
 * Android 侧的平台边界：把 SAF `Uri` 读成字节，其余解析一律交给共享的 [ArchiveImportManager]。
 *
 * 这里刻意只有「读」这一件事——ZIP/JSON 探测、预览构造、恢复策略应用都在 `:shared-data`，
 * 桌面端读文件后走的是同一份实现（第一原则：不要为第二个宿主复制逻辑）。
 */
object AndroidArchiveReader {

    /** 从 SAF Uri 读取并检测归档内容，生成解析预览 */
    fun inspectArchive(context: Context, uri: Uri): Result<ArchivePreview> = runCatching {
        val filename = queryDisplayName(context, uri) ?: "archive_data"
        val bytes = readBytesLimited(context, uri, ArchiveImportManager.MAX_ARCHIVE_BYTES)
        ArchiveImportManager.inspect(filename, bytes).getOrThrow()
    }

    private fun queryDisplayName(context: Context, uri: Uri): String? {
        if (uri.scheme == "content") {
            try {
                context.contentResolver.query(
                    uri,
                    arrayOf(OpenableColumns.DISPLAY_NAME),
                    null,
                    null,
                    null,
                )?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val colIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        if (colIndex != -1) {
                            return cursor.getString(colIndex)
                        }
                    }
                }
            } catch (_: Exception) {
                // 回退处理
            }
        }
        return uri.lastPathSegment?.substringAfterLast('/')
    }

    private fun readBytesLimited(context: Context, uri: Uri, maxBytes: Int): ByteArray {
        val stream = context.contentResolver.openInputStream(uri)
            ?: throw IllegalArgumentException("无法打开文件输入流")
        return stream.use { input ->
            val baos = ByteArrayOutputStream(minOf(maxBytes, 64 * 1024))
            val buffer = ByteArray(8 * 1024)
            var total = 0
            while (true) {
                val len = input.read(buffer)
                if (len < 0) break
                total += len
                if (total > maxBytes) {
                    throw IllegalArgumentException("归档文件大小超过 ${maxBytes / 1024 / 1024} MiB 限制")
                }
                baos.write(buffer, 0, len)
            }
            baos.toByteArray()
        }
    }
}
