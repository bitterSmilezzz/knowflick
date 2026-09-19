package com.knowflick.app.domain

import androidx.compose.runtime.Immutable
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** 刷走意图：左划不喜欢 / 右划感兴趣 / skip 系统跳过（仅计已刷，不表达喜好） */
@Serializable
enum class SwipeDirection(val raw: String) {
    LEFT("left"),
    RIGHT("right"),
    SKIP("skip");

    companion object {
        fun fromRaw(raw: String?): SwipeDirection? = entries.firstOrNull { it.raw == raw }
    }
}

/** 卡片来源：预置知识库 / AI 实时生成 / 外部导入提炼 */
@Serializable
enum class CardSource(val raw: String) {
    SEED("seed"),
    AI("ai"),
    IMPORTED("imported");

    companion object {
        /** 未知来源兜底为 seed（与 macOS 端 CardSource 自定义解码一致） */
        fun fromRaw(raw: String?): CardSource = entries.firstOrNull { it.raw == raw } ?: SEED
    }
}

/** 科普链接 */
@Immutable
@Serializable
data class ScienceLink(val title: String, val url: String)

/**
 * 一条知识卡片（预置或 AI 生成）。
 *
 * JSON 线格式与 macOS 端 `KnowledgeCard` 逐字段对齐（CamelCase key、ISO8601 日期、可选字段缺省语义）。
 * 序列化细节见 [CardJson]——kotlinx.serialization 默认生成器无法表达 Swift 侧
 * 「缺字段回填 / 未知来源兜底 / 宽松日期」的解码语义，故由 [CardJson.CardJsonSerializer] 接管编解码。
 */
@Immutable
@Serializable(with = CardJson.CardJsonSerializer::class)
data class KnowledgeCard(
    val id: String,
    val category: String,
    val headline: String,
    val summary: String,
    val details: String,
    val links: List<ScienceLink>,
    val source: CardSource,
    val createdAt: Long,
    val seenAt: Long? = null,
    val swiped: SwipeDirection? = null,
    /** 收藏状态：与 swiped（喜好意图）解耦；取消收藏只清此标记 */
    val isFavorite: Boolean = false,
    /** 收藏时间：收藏阁排序依据；收藏未读卡不应计为「已浏览」 */
    val favoritedAt: Long? = null,
    /** 累计复习次数 */
    val reviewCount: Int = 0,
    /** 熟练度：0-未测验 1-学习中 2-已掌握 */
    val masteryLevel: Int = 0,
    /** 上次复习时间戳 */
    val lastReviewedAt: Long? = null,
    /** SM-2 连续成功复习次数 */
    val repetition: Int = 0,
    /** SM-2 / FSRS 下次复习间隔天数（初始 1 天） */
    val intervalDays: Int = 1,
    /** SM-2 简易度系数 EF（初始 2.5，范围 1.3 ~ 3.0） */
    val easeFactor: Double = 2.5,
    /** FSRS 记忆稳定性 Stability（单位：天，0.0 表示未初始化） */
    val stability: Double = 0.0,
    /** FSRS 记忆难度 Difficulty（范围 1.0 ~ 10.0，0.0 表示未初始化） */
    val difficulty: Double = 0.0,
) {
    /** 解析正文为段落（macOS 端以双换行分段） */
    val paragraphs: List<String> get() = details.split("\n\n").filter { it.isNotBlank() }

    companion object {
        fun create(
            category: String,
            headline: String,
            summary: String,
            details: String,
            links: List<ScienceLink> = emptyList(),
            source: CardSource,
            createdAt: Long = System.currentTimeMillis(),
        ): KnowledgeCard = KnowledgeCard(
            id = java.util.UUID.randomUUID().toString().uppercase(),
            category = category,
            headline = headline,
            summary = summary,
            details = details,
            links = links,
            source = source,
            createdAt = createdAt,
        )
    }
}

/** 学习意图偏好：收藏管理使用的三态 */
@Immutable
@Serializable
data class CategoryConfig(val name: String, val description: String)
