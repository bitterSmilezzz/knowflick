package com.knowflick.app.data

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import com.knowflick.app.domain.CardThemeResolver
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Robolectric 层：底图资产护栏。
 *
 * `shared/assets/bg/` 的实际文件集合必须与 [CardThemeResolver.allKeys] 完全相同——
 * 这是「消除 `%42` 魔数」的落实点：池长度不再写死字面量，任何一侧增删底图都会让本测试失败，
 * 而不是在运行时静默改变映射（少一张）或越界崩溃（多一张）。
 *
 * 预置库退役（2026-10）后本类不再加载种子卡，只保留这条与内容无关的资产断言。
 * 运行：./gradlew :app:testDebugUnitTest
 */
@org.robolectric.annotation.Config(sdk = [35])
@org.junit.runner.RunWith(org.robolectric.RobolectricTestRunner::class)
class BgAssetGuardTest {

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
