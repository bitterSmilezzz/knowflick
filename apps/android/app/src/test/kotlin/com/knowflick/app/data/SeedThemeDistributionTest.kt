package com.knowflick.app.data

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import com.knowflick.app.domain.CardArrange
import com.knowflick.app.domain.CardThemeResolver
import com.knowflick.app.domain.KnowledgeCard
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 种子库底图分布验收（P0-1 的量化证据 + 长期护栏）。
 *
 * 0.8.5 及以前：`ThemeKey.categoryAliases` 把已知分类整体折到**单张**底图上
 *（冷知识→study、AI→ai、AI 开发→coding、AI Agent→agent、中级会计→accounting、
 * 投资理财→economy），214 张种子卡全局只有 6 种 key。CONTEXT.md 承诺的
 * 「即使在单分类内刷卡也张张不同」在 Android 端完全没有落地。
 *
 * 本测试同时输出修复前（[legacyKeyFor]，0.8.5 映射的冻结副本）与修复后的分布，
 * 并断言修复后严格更分散 —— 断言不是「等于某个魔数」，任何一次分布退化都会失败。
 *
 * 运行：./gradlew :app:testDebugUnitTest --tests '*SeedThemeDistributionTest*'
 */
@org.robolectric.annotation.Config(sdk = [35])
@org.junit.runner.RunWith(org.robolectric.RobolectricTestRunner::class)
class SeedThemeDistributionTest {

    @Test
    fun seedLibrarySpreadsAcrossTheWholeImagePool() {
        val cards = SeedLoader(ApplicationProvider.getApplicationContext<Application>()).load()
        assertEquals(214, cards.size, "分布基线绑定在 214 张种子库上")

        val legacy = cards.map { legacyKeyFor(it) }
        val current = cards.map { CardThemeResolver.forCard(it) }
        assertTrue(current.all { it in CardThemeResolver.allKeys }, "所有 key 必须属于 42 图池")

        val legacyDistinct = legacy.toSet().size
        val currentDistinct = current.toSet().size

        val table = buildString {
            appendLine("=== 种子库底图分布（214 张） ===")
            appendLine("修复前（0.8.5 分类别名 + bgN 哈希）：全局 $legacyDistinct 种 key")
            appendLine("修复后（领域多图池 + 关键词 + 哈希兜底）：全局 $currentDistinct 种 key")
            appendLine()
            appendLine("分类            卡数  修复前key数  修复后key数  修复后用到的图")
            val categories = cards.groupBy { it.category }.entries.sortedByDescending { it.value.size }
            for ((category, group) in categories) {
                val legacyKeys = group.map { legacyKeyFor(it) }.toSet()
                val currentKeys = group.map { CardThemeResolver.forCard(it) }.toSet()
                appendLine(
                    "%-14s %4d %10d %11d  %s".format(
                        category, group.size, legacyKeys.size, currentKeys.size,
                        currentKeys.sorted().joinToString(","),
                    ),
                )
            }
            appendLine()
            val histogram = current.groupingBy { it }.eachCount().entries.sortedByDescending { it.value }
            appendLine("修复后 key 直方图（key=张数）：" + histogram.joinToString(" ") { "${it.key}=${it.value}" })
        }
        println(table)

        // 1) 全局分散度：修复前 6 种 → 修复后必须显著增多
        assertTrue(currentDistinct > legacyDistinct, "修复后必须比修复前更分散")
        assertTrue(currentDistinct >= 30, "214 张种子卡应覆盖 42 池的绝大多数，实际 $currentDistinct 种")

        // 2) 单分类内张张不同（核心承诺）：每个分类都不得坍缩到单张图
        for ((category, group) in cards.groupBy { it.category }) {
            if (group.size < 2) continue
            val distinct = group.map { CardThemeResolver.forCard(it) }.toSet().size
            assertTrue(
                distinct >= 2,
                "分类「$category」${group.size} 张卡只映射到 $distinct 种底图（单分类内必须张张不同）",
            )
        }

        // 3) 已知分类的具体门槛（留出余量，不退化为「少数几张图轮转」）
        val 冷知识 = cards.filter { it.category == "冷知识" }
        assertTrue(
            冷知识.map { CardThemeResolver.forCard(it) }.toSet().size >= 20,
            "冷知识 ${冷知识.size} 张卡应散布到 ≥20 种底图",
        )
        for (category in listOf("AI", "AI 开发", "AI Agent", "中级会计", "投资理财")) {
            val group = cards.filter { it.category == category }
            assertTrue(group.isNotEmpty(), "种子库应含分类 $category")
            val distinct = group.map { CardThemeResolver.forCard(it) }.toSet().size
            assertTrue(distinct >= 3, "分类「$category」${group.size} 张卡的底图种类应 ≥3，实际 $distinct")
        }

        // 4) 单张图不得被过量复用（修复前 study 一张图承载 160 张）
        val worst = current.groupingBy { it }.eachCount().maxByOrNull { it.value }!!
        assertTrue(
            worst.value <= cards.size / 6,
            "单张底图最多承载 ${cards.size / 6} 张卡，实际 ${worst.key}=${worst.value} 张",
        )
    }

    /**
     * 0.8.5 映射的**冻结副本**，仅用于在测试里量化「修复前」的分布。
     * 生产代码中已删除（`data.ThemeKey`），保留此处是为了让分布对比可复现。
     *
     * 注：原实现对未知分类返回的是另一套 `bgN` key（排布侧空间），这里为便于展示改用
     * 42 池的同索引 key。种子库 214 张全部属于已知分类（冷知识 + 5 个自定义分类），
     * 因此该分支在本测试中不会触发，对比结论不受影响。
     */
    private fun legacyKeyFor(card: KnowledgeCard): String {
        val aliases = mapOf(
            "物理" to "physics", "生物" to "biology", "天文" to "astronomy", "数学" to "math",
            "化学" to "chemistry", "历史" to "history", "心理" to "psychology", "脑科学" to "neuroscience",
            "语言" to "language", "科技" to "tech", "生活" to "life", "地理" to "geography",
            "AI" to "ai", "AI Agent" to "agent", "算法" to "algorithm", "数据结构" to "datastructure",
            "架构" to "architecture", "Rust" to "rust", "Python" to "python", "编程" to "coding",
            "AI 开发" to "coding", "会计" to "accounting", "中级会计" to "accounting",
            "投资理财" to "economy", "学习方法" to "study", "冷知识" to "study",
            "量子" to "quantum", "相对论" to "relativity", "光学" to "optics", "海洋" to "ocean",
            "气象" to "meteorology", "地质" to "geology", "航天" to "spacecraft", "基因" to "genetics",
            "生态" to "ecology", "机器人" to "robotics", "网络" to "network", "数据库" to "database",
            "安全" to "security", "经济" to "economy", "哲学" to "philosophy", "社会学" to "sociology",
            "音乐" to "music",
        )
        aliases[card.category]?.let { return it }
        // 与原实现一致的无符号取模（Java 等价物见 CardThemeResolver.hashIndex）
        val index = java.lang.Long.remainderUnsigned(CardArrange.deterministicHash(card.headline), 42L).toInt()
        return CardThemeResolver.allKeys[index]
    }
}
