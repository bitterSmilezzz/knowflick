package com.knowflick.baselineprofile

import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * 生成冷启动与首屏刷卡路径的 baseline profile。
 *
 * 应用冷启动要做的事正好是 profile 最受益的一类：解析 cards.json、全量重排卡堆、
 * 首次组合三张卡。没有 profile 时这些路径全部走解释执行。
 *
 * 运行：`./gradlew :app:generateReleaseBaselineProfile`（需要已连接的设备或模拟器）。
 */
@RunWith(AndroidJUnit4::class)
class BaselineProfileGenerator {

    @get:Rule
    val rule = BaselineProfileRule()

    @Test
    fun coldStartupAndDeckSwipe() {
        val packageName = "com.knowflick.app"
        rule.collect(packageName = packageName, includeInStartupProfile = true) {
            // 冷启动到卡堆首屏
            pressHome()
            startActivityAndWait()
            device.wait(Until.hasObject(By.text("KnowFlick")), 10_000)

            // 顶栏图标与卡片首帧
            device.wait(Until.hasObject(By.text("不喜欢")), 10_000)

            // 划走几张，覆盖手势、飞出动画与落盘路径
            repeat(3) {
                // Compose 会把 testTag 原样导出为 resource-id，不会补 Android 包名前缀。
                // 图片异步载入会重建语义节点，因此只校验节点存在，再用屏幕坐标执行手势；
                // 持有 UiObject2 后读取 visibleCenter 会偶发 StaleObjectException。
                check(device.wait(Until.hasObject(By.res("deck_top_card")), 5_000)) {
                    "找不到 deck_top_card，baseline profile 未覆盖刷卡路径"
                }
                val cy = device.displayHeight / 2
                device.swipe(device.displayWidth / 2, cy, device.displayWidth * 4 / 5, cy, 12)
                device.waitForIdle()
            }

            // 收藏阁（列表组合与时间格式化）
            val libraryButton = device.wait(
                Until.findObject(By.desc("收藏阁")),
                5_000,
            ) ?: error("找不到收藏阁按钮，baseline profile 未覆盖知识库路径")
            libraryButton.click()
            check(device.wait(Until.hasObject(By.text("知识库")), 5_000)) {
                "收藏阁点击后没有进入知识库"
            }
            device.waitForIdle()
            device.pressBack()
            device.waitForIdle()
        }
    }
}
