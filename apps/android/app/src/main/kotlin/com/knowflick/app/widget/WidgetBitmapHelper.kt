package com.knowflick.app.widget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import com.knowflick.app.ui.BackgroundImageCache

/**
 * 桌面微件位图辅助类：
 * 1. 复用 BackgroundImageCache 获取卡片专属摄影底图；
 * 2. 缩放至微件适中分辨率（360×240）避免 RemoteViews 事务溢出（1MB 限制）；
 * 3. 覆盖暗角与深色渐变蒙层，确保桌面白字可读性与高级感；
 * 4. 异常时优雅返回 null，微件自适应纯色毛玻璃底板。
 */
object WidgetBitmapHelper {

    fun loadWidgetBackground(
        context: Context,
        themeKey: String,
        targetWidth: Int = 360,
        targetHeight: Int = 240,
    ): Bitmap? {
        return runCatching {
            val source = BackgroundImageCache.rawBitmap(context, themeKey) ?: return null
            val composite = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(composite)

            val scaled = Bitmap.createScaledBitmap(source, targetWidth, targetHeight, true)
            canvas.drawBitmap(scaled, 0f, 0f, null)
            if (scaled != source) {
                scaled.recycle()
            }

            val paint = Paint()
            val gradient = LinearGradient(
                0f, 0f, 0f, targetHeight.toFloat(),
                intArrayOf(
                    Color.argb(130, 16, 15, 20),
                    Color.argb(190, 16, 15, 20),
                    Color.argb(245, 12, 11, 15),
                ),
                floatArrayOf(0f, 0.45f, 1f),
                Shader.TileMode.CLAMP
            )
            paint.shader = gradient
            canvas.drawRect(0f, 0f, targetWidth.toFloat(), targetHeight.toFloat(), paint)

            composite
        }.getOrNull()
    }
}
