package com.knowflick.desktop

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.knowflick.app.data.AppModel
import java.awt.Frame

/**
 * 桌面宿主的状态容器 —— 对应 Android 端 `KnowFlickViewModel` 的角色：
 * 持有「卡库版本号」（卡库本身不是 Compose 状态，改动后靠它触发重组）与提示文案，
 * 并把平台动作收敛成可直接调用的方法。
 *
 * 这样拆的另一个好处是**可测**：导入/导出不经过原生对话框时也能在无头环境里驱动
 * （对话框只负责取路径，见 [DesktopFileDialogs]）。
 */
class DesktopHostState(val model: AppModel) {

    /** 卡库版本：每次写入后 +1，界面据此重新读取 `model.store.cards` */
    var version by mutableIntStateOf(0)
        private set

    /** 一次性提示文案（导入/导出结果），显示在界面底部 */
    var notice by mutableStateOf<String?>(null)
        private set

    /** 导入归档字节：探测 → 合并 → 落盘 → 刷新界面 */
    fun importBytes(fileName: String, bytes: ByteArray): String {
        val message = DesktopArchiveActions.importBytes(model, fileName, bytes).fold(
            onSuccess = { result ->
                "已导入：新增 ${result.added} 张，恢复 ${result.restored} 张，忽略 ${result.ignored} 张"
            },
            onFailure = { error -> "导入失败：${error.message ?: "未知错误"}" },
        )
        notice = message
        version++
        return message
    }

    /** 导出文本：走原生「另存为」；用户取消则不改提示 */
    fun saveText(owner: Frame?, title: String, defaultName: String, text: String): String? {
        val target = DesktopFileDialogs.saveFile(owner, title, defaultName) ?: return null
        val message = runCatching { target.writeText(text) }.fold(
            onSuccess = { "已导出：${target.name}" },
            onFailure = { error -> "导出失败：${error.message ?: "无法写入文件"}" },
        )
        notice = message
        return message
    }

    fun dismissNotice() {
        notice = null
    }

    /** 直接给用户一句提示（例如读取文件失败） */
    fun showNotice(message: String) {
        notice = message
    }
}
