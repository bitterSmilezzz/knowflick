package com.knowflick.app.data

import android.content.Context
import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.CardTextUtils
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.domain.ScienceLink
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray

/**
 * 应用级状态容器：卡库存储 + 种子合并 + 卡堆状态机。
 * 无视图依赖，可在 JVM 测试中注入临时目录与种子直接驱动。
 */
class AppModel(
    internal val storage: CardStorage,
    seedCards: List<KnowledgeCard>,
) {
    val store = com.knowflick.app.domain.CardStore(
        seedCards = seedCards,
        // 排布防重（minDistance）与渲染必须解析同一 key：显式接线，避免两套 key 空间再次漂移
        keyFor = com.knowflick.app.domain.CardThemeResolver::forCard,
    )

    /** 启动：加载卡库 → 空库播种 → 增量合并新种子（口径与 macOS bootstrap 一致） */
    fun bootstrap() {
        val loaded = storage.loadCards()
        if (loaded.isEmpty()) {
            store.replaceAll(store.seedCards)
            storage.saveCards(store.cards)
        } else {
            store.replaceAll(loaded)
            val existing = store.cards.map { CardTextUtils.normalizeHeadline(it.headline) }.toSet()
            val fresh = store.seedCards.filter { CardTextUtils.normalizeHeadline(it.headline) !in existing }
            if (fresh.isNotEmpty()) {
                store.addCards(fresh, insertAtTop = false)
                storage.saveCards(store.cards)
            }
        }
    }

    fun persistNow() {
        storage.saveCards(store.cards)
    }
}

/** 种子库加载：从 assets 读取 seed_cards.json（结构与 macOS 端 SeedCard 解码一致） */
class SeedLoader(private val context: Context) {

    fun load(): List<KnowledgeCard> {
        val raw = runCatching { context.assets.open("seed_cards.json").bufferedReader().readText() }
            .getOrNull() ?: return emptyList()
        val array = runCatching { Json.parseToJsonElement(raw).jsonArray }.getOrNull() ?: return emptyList()
        val now = System.currentTimeMillis()
        return array.mapNotNull { element ->
            runCatching {
                val obj = element as JsonObject
                KnowledgeCard.create(
                    category = obj.str("category"),
                    headline = obj.str("headline"),
                    summary = obj.str("summary"),
                    details = obj.str("details"),
                    links = (obj["links"] as? JsonArray)?.map { link ->
                        val linkObj = link as JsonObject
                        ScienceLink(title = linkObj.str("title"), url = linkObj.str("url"))
                    } ?: emptyList(),
                    source = CardSource.SEED,
                    createdAt = now,
                )
            }.getOrNull()
        }
    }

    private fun JsonObject.str(key: String): String =
        (this[key] as? JsonElement)?.let { it as? kotlinx.serialization.json.JsonPrimitive }?.content ?: ""
}
