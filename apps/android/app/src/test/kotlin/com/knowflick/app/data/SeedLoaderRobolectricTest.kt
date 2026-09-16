package com.knowflick.app.data

import androidx.test.core.app.ApplicationProvider
import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.CardThemeResolver
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import android.app.Application

/**
 * Robolectric 层：JVM 上模拟 Android 运行时，覆盖需要真实 Context/assets 的路径。
 * 运行：./gradlew :app:testDebugUnitTest（与普通单元测试同任务，无需模拟器）
 */
@org.robolectric.annotation.Config(sdk = [35])
@org.junit.runner.RunWith(org.robolectric.RobolectricTestRunner::class)
class SeedLoaderRobolectricTest {

    private fun loader() = SeedLoader(ApplicationProvider.getApplicationContext())

    @Test
    fun loadsAll214SeedCardsFromAssets() {
        val cards = loader().load()
        assertEquals(214, cards.size, "种子库 214 张随包 assets 加载")
        assertTrue(cards.all { it.source == CardSource.SEED })
        // 标题唯一（种子库口径）
        assertEquals(cards.map { it.headline }.toSet().size, cards.size)
        assertEquals(cards.size, cards.map { it.id }.toSet().size)
    }

    @Test
    fun themeKeyCoversEverySeedCardWithALegalPoolKey() {
        val cards = loader().load()
        // 每张种子卡都能解析出合法底图 key（领域池 / 关键词 / 哈希兜底）
        cards.forEach { card ->
            val key = CardThemeResolver.forCard(card)
            assertTrue(key in CardThemeResolver.allKeys, "key $key 须为 42 图池成员")
        }
    }

    /**
     * 底图资产护栏：`shared/assets/bg/` 的实际文件集合必须与 [CardThemeResolver.allKeys] 完全相同。
     * 这是「消除 `%42` 魔数」的落实点——池长度不再写死字面量，任何一侧增删底图都会让本测试失败，
     * 而不是在运行时静默改变映射（少一张）或越界崩溃（多一张）。
     */
    @Test
    fun bgAssetsMatchAllKeysExactly() {
        val assets = ApplicationProvider.getApplicationContext<Application>().assets
        val files = assets.list("bg")?.toList().orEmpty()
        assertTrue(files.isNotEmpty(), "assets/bg 目录不应为空")
        val keys = files.filter { it.endsWith(".webp") }.map { it.removeSuffix(".webp") }.toSet()
        assertEquals(0, files.size - files.count { it.endsWith(".webp") }, "bg/ 下只应有 .webp：${files - files.filter { it.endsWith(".webp") }}")
        assertEquals(
            CardThemeResolver.allKeys.toSet(),
            keys,
            "assets/bg/*.webp 与 CardThemeResolver.allKeys 必须严格一一对应（缺失：${CardThemeResolver.allKeys.toSet() - keys}；多余：${keys - CardThemeResolver.allKeys.toSet()}）",
        )
    }
}
