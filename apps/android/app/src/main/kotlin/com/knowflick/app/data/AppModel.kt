package com.knowflick.app.data

import android.content.Context
import com.knowflick.app.domain.CardArrange
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
    val store = com.knowflick.app.domain.CardStore(seedCards = seedCards)

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

/** 背景图选择器：分类别名映射与 macOS CategoryTheme 对齐；未知名确定性哈希兜底 */
object ThemeKey {
    private val categoryAliases: Map<String, String> = mapOf(
        "物理" to "physics", "生物" to "biology", "天文" to "astronomy", "数学" to "math",
        "化学" to "chemistry", "历史" to "history", "心理" to "psychology", "脑科学" to "neuroscience",
        "语言" to "language", "科技" to "tech", "生活" to "life", "地理" to "geography",
        "AI" to "ai", "AI Agent" to "agent", "算法" to "algorithm", "数据结构" to "datastructure", "架构" to "architecture",
        "Rust" to "rust", "Python" to "python", "编程" to "coding", "AI 开发" to "coding", "会计" to "accounting",
        "中级会计" to "accounting", "投资理财" to "economy", "学习方法" to "study", "冷知识" to "study",
        "量子" to "quantum", "相对论" to "relativity", "光学" to "optics", "海洋" to "ocean",
        "气象" to "meteorology", "地质" to "geology", "航天" to "spacecraft", "基因" to "genetics",
        "生态" to "ecology", "机器人" to "robotics", "网络" to "network", "数据库" to "database",
        "安全" to "security", "经济" to "economy", "哲学" to "philosophy", "社会学" to "sociology", "音乐" to "music",
    )

    val poolKeys: List<String> = listOf(
        "physics", "biology", "astronomy", "math", "chemistry", "history", "psychology",
        "neuroscience", "language", "tech", "life", "geography", "ai", "algorithm",
        "datastructure", "architecture", "rust", "python", "coding", "accounting", "study",
        "quantum", "relativity", "optics", "ocean", "meteorology", "geology", "spacecraft",
        "genetics", "ecology", "robotics", "security", "crypto", "database", "network",
        "compiler", "economy", "philosophy", "sociology", "music", "cognitive", "agent",
    )

    /** 分类 → 底图 key；未知分类以确定性哈希兜底（保持防重排布有效） */
    fun forCard(card: KnowledgeCard): String {
        categoryAliases[card.category]?.let { return it }
        val index = ((CardArrange.deterministicHash(card.headline) % 42) + 42) % 42
        return poolKeys[index.toInt()]
    }
}
