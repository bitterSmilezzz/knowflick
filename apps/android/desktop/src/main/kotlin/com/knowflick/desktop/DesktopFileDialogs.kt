package com.knowflick.desktop

import java.awt.FileDialog
import java.awt.Frame
import java.io.File

/**
 * 桌面侧的平台边界：原生文件对话框。
 *
 * 这是**允许各端各写**的那类代码（系统文件选择器），刻意只有这一个文件、只有「选路径」。
 * AWT 的对话框是模态的，阻塞调用线程 —— 与系统原生行为一致；调用点都来自 UI 事件回调。
 */
object DesktopFileDialogs {

    /** 打开文件；用户取消返回 null。 */
    fun openFile(owner: Frame?, title: String, extensions: List<String>): File? {
        val dialog = FileDialog(owner, title, FileDialog.LOAD).apply {
            isMultipleMode = false
            if (extensions.isNotEmpty()) {
                setFilenameFilter { _, name -> extensions.any { name.lowercase().endsWith(it) } }
            }
        }
        dialog.isVisible = true
        return dialog.selectedFile()
    }

    /** 另存为；用户取消返回 null。 */
    fun saveFile(owner: Frame?, title: String, defaultName: String): File? {
        val dialog = FileDialog(owner, title, FileDialog.SAVE).apply {
            file = defaultName
        }
        dialog.isVisible = true
        return dialog.selectedFile()
    }

    private fun FileDialog.selectedFile(): File? {
        val dir = directory ?: return null
        val name = file ?: return null
        return File(dir, name)
    }
}
