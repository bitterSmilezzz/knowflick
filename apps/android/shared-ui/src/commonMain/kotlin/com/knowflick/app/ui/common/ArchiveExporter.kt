package com.knowflick.app.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import com.knowflick.app.domain.ArchiveExportFormat
import com.knowflick.app.domain.ArchiveExportScope
import com.knowflick.app.domain.KnowledgeCard

/**
 * 归档导出的**落地方式**（宿主提供）：
 * - Android：写进系统 Downloads（MediaStore）并提供系统分享 Intent；
 * - 桌面：原生「另存为」对话框，没有系统分享（[canShare] = false，分享按钮自动隐藏）。
 *
 * 共享的导出面板只决定「导出什么」（范围 + 格式，都是共享引擎的活），
 * 「落到哪里」是彻头彻尾的平台边界——按第一原则收在这里，而不是让面板各端各写一份。
 */
/** 用户关掉「另存为」：面板不把它当成失败提示 */
class ArchiveExportCancelled : Exception()

interface ArchiveExporter {
    /** 本端是否有系统分享能力（Android 有；桌面用「另存为」代替） */
    val canShare: Boolean get() = false

    /** 保存按钮文案：Android「保存至下载目录」，桌面「另存为」 */
    val saveLabel: String get() = "保存"

    /**
     * 导出并落地。**宿主内部调共享引擎**（`:shared-data` 的 `CardArchiveEngine.generateExportData`）
     * 生成字节，再写到自己平台的位置；`Result` 的值是给用户看的落地位置描述。
     *
     * 接口刻意收在「意图」这一层（范围 + 格式 + 卡片）：面板不需要看见字节，
     * 也就不会把 `:shared-data` 的引擎类型泄漏进 `:shared-ui`（UI 只依赖 `:domain`）。
     */
    suspend fun export(
        scope: ArchiveExportScope,
        format: ArchiveExportFormat,
        cards: List<KnowledgeCard>,
        settingsJson: String?,
    ): Result<String>

    /** 唤起系统分享；默认报告「不支持」，由 [canShare] 决定界面是否显示该入口 */
    suspend fun share(
        scope: ArchiveExportScope,
        format: ArchiveExportFormat,
        cards: List<KnowledgeCard>,
        settingsJson: String?,
    ): Result<Unit> = Result.failure(UnsupportedOperationException("本端不支持系统分享"))
}

/** 未提供时明确失败（而不是静默丢数据）——导出是用户主动动作，必须给回执 */
val LocalArchiveExporter = staticCompositionLocalOf<ArchiveExporter> {
    object : ArchiveExporter {
        override suspend fun export(
            scope: ArchiveExportScope,
            format: ArchiveExportFormat,
            cards: List<KnowledgeCard>,
            settingsJson: String?,
        ): Result<String> = Result.failure(UnsupportedOperationException("宿主未提供导出能力"))
    }
}

@Composable
fun rememberArchiveExporter(): ArchiveExporter = LocalArchiveExporter.current
