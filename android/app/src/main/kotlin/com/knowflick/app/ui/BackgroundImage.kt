package com.knowflick.app.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.Drawable
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.ImageBitmap
import java.util.concurrent.ConcurrentHashMap

/** 背景图缓存：assets 降采样解码（最长边 900px），NSCache 语义的简易替代 */
object BackgroundImageCache {
    private val cache = HashMap<String, ImageBitmap>()

    fun image(context: Context, key: String): ImageBitmap? {
        cache[key]?.let { return it }
        return runCatching {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            context.assets.open("bg/$key.jpg").use { BitmapFactory.decodeStream(it, null, bounds) }
            var sample = 1
            var longest = maxOf(bounds.outWidth, bounds.outHeight)
            while (longest / (sample * 2) >= 450) sample *= 2
            val options = BitmapFactory.Options().apply {
                inSampleSize = sample
                inPreferredConfig = Bitmap.Config.RGB_565
            }
            val bitmap = context.assets.open("bg/$key.jpg").use { BitmapFactory.decodeStream(it, null, options) }
                ?: return null
            // 注意：asImageBitmap 包装的是同一块底层 Bitmap，绝不可 recycle（UI 仍在引用）
            val image = bitmap.asImageBitmap()
            synchronized(cache) { cache[key] = image }
            image
        }.getOrNull()
    }
}
