package com.knowflick.desktop

import com.knowflick.app.domain.CardJson
import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.CardStore
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.SubjectRegistry
import kotlinx.serialization.json.Json

/**
 * 桌面宿主与共享领域层之间的接缝：全部调用都落在 `:domain`（Kotlin Multiplatform）上，
 * 没有任何 Android 运行时参与。
 *
 * 骨架阶段刻意只用到「读」路径（卡库状态机 + JSON 线格式 + 学科表）；写路径与持久化要等
 * 桌面侧的 data 层落地，届时这里换成真实卡库而不是示例卡。
 */
object DomainBridge {

    /** 桌面侧暂时没有持久化层，用两张某字段齐全的示例卡验证链路。 */
    fun sampleCards(): List<KnowledgeCard> = listOf(
        KnowledgeCard(
            id = "DESKTOP-1",
            category = "计算机与 AI",
            headline = "桌面宿主已接上共享领域层",
            summary = "同一份 :domain 代码在 Android 与桌面 JVM 上各跑一遍",
            details = "骨架阶段的占位内容，等桌面 data 层落地后换成真实卡库。",
            links = emptyList(),
            source = CardSource.AI,
            createdAt = 1_700_000_000_000L,
        ),
        KnowledgeCard(
            id = "DESKTOP-2",
            category = "自然宇宙科学",
            headline = "卡库状态机与学科表可用",
            summary = "排布、统计与学科聚合都来自共享模块",
            details = "骨架阶段的占位内容。",
            links = emptyList(),
            source = CardSource.IMPORTED,
            createdAt = 1_700_000_100_000L,
        ),
    )

    /** 一行可断言的证据：卡库状态机 + JSON 往返 + 学科聚合三件事都跑通了。 */
    fun smokeLine(): String {
        val cards = sampleCards()
        val store = CardStore()
        store.replaceAll(cards)

        val encoded = Json.encodeToString(KnowledgeCard.serializer(), cards.first())
        val decoded = Json.decodeFromString(KnowledgeCard.serializer(), encoded)

        return "卡库 ${store.cards.size} 张 · 学科 ${SubjectRegistry.subjectSummaries(store.cards).size} 组" +
            " · JSON 往返 ${if (decoded.headline == cards.first().headline) "OK" else "FAILED"}" +
            " · 编译时间 ${CardJson.encodeDate(1_700_000_000_000L)}"
    }
}
