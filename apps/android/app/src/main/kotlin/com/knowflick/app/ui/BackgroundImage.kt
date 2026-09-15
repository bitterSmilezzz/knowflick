package com.knowflick.app.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** 降采样背景图并做 LRU 缓存；淘汰时由 GC 回收，避免回收仍被 UI 引用的 Bitmap。 */
object BackgroundImageCache {
    /**
     * 解码目标：最长边不降到此值以下。
     * 源图为 1000×1450，1080p 设备上卡片实际宽约 959px（1080 减两侧 22dp 内边距），
     * 此前阈值 450 会把图降到 500×725、再被放大 1.92 倍，顶卡明显发虚。
     */
    private const val TARGET_LONGEST_PX = 1450

    /**
     * 缓存上限。单张 1000×1450 的 RGB_565 约 2.9 MiB，
     * 12 MiB 只放得下 4 张，换几张就会重复解码；32 MiB 可容纳约 11 张。
     */
    private const val CACHE_BYTES = 32 * 1024 * 1024

    private val cache = object : LruCache<String, Bitmap>(CACHE_BYTES) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.allocationByteCount
    }

    /** 资源名：背景图统一为 WebP（同画质下体积约为 JPEG 的三分之一）。 */
    private fun assetPath(key: String): String = "bg/$key.webp"

    @Synchronized
    fun cached(key: String): ImageBitmap? = cache.get(key)?.asImageBitmap()

    @Synchronized
    fun image(context: Context, key: String): ImageBitmap? {
        cache.get(key)?.let { return it.asImageBitmap() }
        return runCatching {
            val path = assetPath(key)
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            context.assets.open(path).use { BitmapFactory.decodeStream(it, null, bounds) }
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
            // 只降到「仍能覆盖目标最长边」的最大等级；源图 1000×1450 时不降采样。
            var sample = 1
            val longest = maxOf(bounds.outWidth, bounds.outHeight)
            while (longest / (sample * 2) >= TARGET_LONGEST_PX) sample *= 2
            val options = BitmapFactory.Options().apply {
                inSampleSize = sample
                inPreferredConfig = Bitmap.Config.RGB_565
            }
            val bitmap = context.assets.open(path).use { BitmapFactory.decodeStream(it, null, options) }
                ?: return null
            // 注意：asImageBitmap 包装的是同一块底层 Bitmap，绝不可 recycle（UI 仍在引用）
            val image = bitmap.asImageBitmap()
            cache.put(key, bitmap)
            image
        }.getOrNull()
    }
}

/** IO 线程解码，分类切换时按图片 key 更新。 */
@Composable
fun rememberBackgroundImage(key: String): ImageBitmap? {
    val context = LocalContext.current.applicationContext
    // 卡片从堆底升为顶卡、或复制到飞出层时先复用内存图，避免异步任务启动前闪灰一帧。
    val image = remember(key, context) { mutableStateOf(BackgroundImageCache.cached(key)) }
    LaunchedEffect(key, context) {
        image.value = withContext(Dispatchers.IO) { BackgroundImageCache.image(context, key) }
    }
    return image.value
}

/**
 * 只把即将出现的底图解码进内存，不创建 Image 节点或上传纹理。
 * 卡片升层后 [rememberBackgroundImage] 会立即命中缓存，减少滑动过程中的解码等待。
 */
@Composable
fun PreloadBackgroundImage(key: String) {
    val context = LocalContext.current.applicationContext
    LaunchedEffect(key, context) {
        withContext(Dispatchers.IO) { BackgroundImageCache.image(context, key) }
    }
}
