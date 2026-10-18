package com.knowflick.app.domain

/**
 * 归档导出的**描述类型**（放 `:domain` 的理由同 [ArchivePreview]）：导出面板（`:shared-ui`）要用它们
 * 展示选项、推导文件名与 MIME，而 `:shared-ui` 只依赖 `:domain`。引擎（生成 ZIP/JSON/Markdown/Anki
 * 字节）仍在 `:shared-data` 的 `CardArchiveEngine`。
 */
enum class ArchiveExportFormat(
    val title: String,
    val fileExtension: String,
    val mimeType: String,
    val description: String,
    val isRecommended: Boolean = false,
) {
    ZIP_FULL_BACKUP(
        title = "ZIP 全量数据备份包",
        fileExtension = "zip",
        mimeType = "application/zip",
        description = "完整卡片数据、学习足迹、收藏与配置，支持跨端恢复与防止数据丢失",
        isRecommended = true,
    ),
    JSON_ARCHIVE(
        title = "JSON 结构化镜像",
        fileExtension = "json",
        mimeType = "application/json",
        description = "标准 JSON 数组，包含所有字段及学习状态，全平台通用交换格式",
    ),
    MARKDOWN_SINGLE(
        title = "Markdown 整合排版笔记",
        fileExtension = "md",
        mimeType = "text/markdown",
        description = "含 YAML 元数据、目录跳转索引、核心观点与延伸链接，兼容各类笔记软件",
    ),
    OBSIDIAN_VAULT_ZIP(
        title = "Obsidian 独立双链笔记包",
        fileExtension = "zip",
        mimeType = "application/zip",
        description = "每张卡片生成独立 .md 文档，支持 [[分类]] 双链与 #标签，开箱即用",
    ),
    ANKI_TSV(
        title = "Anki 记忆牌组卡片",
        fileExtension = "tsv",
        mimeType = "text/tab-separated-values",
        description = "制表符分隔 TSV 文件，正面核心主张，背面深入解析，支持一键导入 Anki",
    ),
}

enum class ArchiveExportScope(val title: String) {
    ALL("全部卡库"),
    FAVORITES("仅收藏阁"),
    HISTORY("历史足迹"),
}
