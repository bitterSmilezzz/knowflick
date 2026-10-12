package com.knowflick.app.domain

/**
 * 归档导入的**描述类型**：只描述「归档里有什么」，不碰 IO。
 *
 * 为什么在 `:domain` 而不是 `:shared-data`：它是**界面也要用的类型**——导入预览对话框
 * （`:shared-ui` 的 `ImportRestoreDialog`）拿它渲染「卡片总数 / 收藏 / 学习足迹 / 恢复策略」。
 * 而 `:shared-ui` 只依赖 `:domain`（不依赖持久化层，这个分层是刻意的）。
 * 引擎（ZIP/JSON 探测 + 合并）仍然留在 `:shared-data` 的 `ArchiveImportManager`。
 */

/** 导入恢复策略 */
enum class RestoreStrategy(val title: String, val description: String) {
    MERGE(
        title = "增量合并恢复 (推荐)",
        description = "保留本机已有卡片与学习历史，智能识别并合并归档中的新卡片与更新进度",
    ),
    OVERWRITE(
        title = "全量覆盖重置",
        description = "使用归档数据完全覆盖替换当前卡库，适合全新设备数据迁移",
    ),
}

/** 归档文件解析预览信息 */
data class ArchivePreview(
    val filename: String,
    val totalCards: Int,
    val readCards: Int,
    val favoritedCards: Int,
    val sourcesSummary: Map<CardSource, Int>,
    val categoriesSummary: Map<String, Int>,
    val parsedCards: List<KnowledgeCard>,
    val settingsJson: String? = null,
    val isZipArchive: Boolean = false,
)
