package com.knowflick.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.ImageBitmap

/**
 * 底图解码的**跨端接缝**：分类底图（`shared/assets/bg/<key>.webp`，42 张）在 Android 走
 * assets + `BitmapFactory`，在桌面走 classpath 资源 + Skia。
 *
 * 为什么要有这个接缝：卡片视觉（刷卡页、详情页、海报）全部依赖它，而它是**平台读取资源**这一类
 * 边界——按第一原则，边界收进 expect/actual，界面代码只调这两个函数，
 * 各端不复制任何解码/缓存逻辑（Android 实现见 androidMain 的 `BackgroundImage.kt`）。
 *
 * 图片来源仍是仓库根的 `shared/assets`（单一事实来源）：Android 侧经 `assets.srcDirs` 直读，
 * 桌面侧经 `resources.srcDir` 打进 jar——两端都不留副本。
 */
@Composable
expect fun rememberBackgroundImage(key: String): ImageBitmap?

/** 预热：只把即将出现的底图解码进内存，不创建 Image 节点（滑动时命中缓存，减少解码等待） */
@Composable
expect fun PreloadBackgroundImage(key: String)
