package com.knowflick.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toComposeImageBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 桌面（Windows / macOS / Linux）的底图解码：从 **classpath 资源**读 `bg/<key>.webp`，
 * 用 Skia 解码。资源由构建期把仓库根的 `shared/assets` 挂进 `resources.srcDir` 得到——
 * 与 Android 端 `assets.srcDirs` 是同一份来源、同一个 `bg/<key>.webp` 布局，两端都不留副本。
 *
 * 行为对齐 Android 实现：内存缓存（按 key）+ IO 线程解码 + 命中缓存即刻返回，
 * 只是这里没有 Android 的 `BitmapFactory` 降采样与像素格式选择（Skia 直接解全图；
 * 42 张底图解码后约几十 MB，桌面内存余量比手机宽裕，先按简单实现走，需要时再加尺寸约束）。
 */
object DesktopBackgroundImageCache {

    /** 进程级缓存；42 张底图全解也就几十 MB，先不做 LRU */
    private val cache = HashMap<String, ImageBitmap>()

    fun cached(key: String): ImageBitmap? = synchronized(cache) { cache[key] }

    fun image(key: String): ImageBitmap? {
        synchronized(cache) { cache[key] }?.let { return it }
        return runCatching {
            val bytes = DesktopBackgroundImageCache::class.java
                .getResourceAsStream("/bg/$key.webp")
                ?.use { it.readBytes() }
                ?: return null
            val image = org.jetbrains.skia.Image.makeFromEncoded(bytes).toComposeImageBitmap()
            synchronized(cache) { cache[key] = image }
            image
        }.getOrNull()
    }

    /** 测试与诊断用：当前缓存了多少张 */
    fun cacheSize(): Int = synchronized(cache) { cache.size }
}

@Composable
actual fun rememberBackgroundImage(key: String): ImageBitmap? {
    // 命中缓存则同步返回，避免异步任务启动前闪一帧空白（与 Android 实现同一考虑）
    val image = remember(key) { mutableStateOf(DesktopBackgroundImageCache.cached(key)) }
    LaunchedEffect(key) {
        image.value = withContext(Dispatchers.IO) { DesktopBackgroundImageCache.image(key) }
    }
    return image.value
}

@Composable
actual fun PreloadBackgroundImage(key: String) {
    LaunchedEffect(key) {
        withContext(Dispatchers.IO) { DesktopBackgroundImageCache.image(key) }
    }
}
