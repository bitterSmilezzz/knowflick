package com.knowflick.app.data

import androidx.test.core.app.ApplicationProvider
import com.knowflick.app.domain.CardSource
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

    @Test
    fun loadsAll214SeedCardsFromAssets() {
        val loader = SeedLoader(ApplicationProvider.getApplicationContext())
        val cards = loader.load()
        assertEquals(214, cards.size, "种子库 214 张随包 assets 加载")
        assertTrue(cards.all { it.source == CardSource.SEED })
        // 标题唯一（种子库口径）
        assertEquals(cards.map { it.headline }.toSet().size, cards.size)
        assertEquals(cards.size, cards.map { it.id }.toSet().size)
    }

    @Test
    fun themeKeyCoversKnownCategoriesWithAliasMap() {
        val loader = SeedLoader(ApplicationProvider.getApplicationContext())
        val cards = loader.load()
        // 每张种子卡都能解析出合法底图 key（别名表或哈希兜底）
        cards.forEach { card ->
            val key = ThemeKey.forCard(card)
            assertTrue(key in ThemeKey.poolKeys, "key $key 须为 42 图池成员")
        }
    }
}
