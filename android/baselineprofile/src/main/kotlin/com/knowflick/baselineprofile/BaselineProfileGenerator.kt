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
                val card = device.findObject(By.res(packageName, "deck_top_card"))
                if (card != null) {
                    val cx = card.visibleCenter.x
                    val cy = card.visibleCenter.y
                    device.swipe(cx, cy, cx + 320, cy, 12)
                    device.waitForIdle()
                }
            }

            // 收藏阁（列表组合与时间格式化）
            device.findObject(By.text("收藏阁"))?.click()
            device.waitForIdle()
            device.pressBack()
            device.waitForIdle()
        }
    }
}
