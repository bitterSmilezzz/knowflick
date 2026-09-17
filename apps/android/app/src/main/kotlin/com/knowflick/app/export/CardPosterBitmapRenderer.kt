package com.knowflick.app.export

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.os.Build
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import com.knowflick.app.domain.CardSource
import com.knowflick.app.domain.CardThemeResolver
import com.knowflick.app.domain.KnowledgeCard
import com.knowflick.app.ui.BackgroundImageCache
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs

/**
 * 知识卡片海报离线高清光栅化渲染器。
 * 纯 Canvas + TextPaint + StaticLayout 绘制，支持在任意后台协程并发光栅化。
 */
object CardPosterBitmapRenderer {

    private val dateFormat = SimpleDateFormat("yyyy.MM.dd", Locale.getDefault())

    /**
     * 渲染卡片为指定风格的海报位图。
     */
    fun render(
        context: Context,
        card: KnowledgeCard,
        posterStyle: CardPosterStyle,
    ): Bitmap {
        val bitmap = Bitmap.createBitmap(posterStyle.width, posterStyle.height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)

        val themeKey = CardThemeResolver.forCard(card)
        val photoBitmap = BackgroundImageCache.rawBitmap(context, themeKey)

        when (posterStyle) {
            CardPosterStyle.EDITORIAL -> renderEditorial(canvas, card, photoBitmap, posterStyle)
            CardPosterStyle.POLAROID -> renderPolaroid(canvas, card, photoBitmap, posterStyle)
        }

        return bitmap
    }

    // ==========================================
    // 1. 典雅画报风 (Editorial Magazine Poster)
    // ==========================================

    private fun renderEditorial(
        canvas: Canvas,
        card: KnowledgeCard,
        photo: Bitmap?,
        posterStyle: CardPosterStyle,
    ) {
        val w = posterStyle.width.toFloat()
        val h = posterStyle.height.toFloat()

        // (1) 背景深墨质感渐变 (#14171C -> #0D0D12 -> #08080A)
        val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(
                0f, 0f, 0f, h,
                intArrayOf(
                    android.graphics.Color.rgb(20, 23, 28),
                    android.graphics.Color.rgb(13, 13, 18),
                    android.graphics.Color.rgb(8, 8, 10),
                ),
                floatArrayOf(0f, 0.5f, 1f),
                Shader.TileMode.CLAMP,
            )
        }
        canvas.drawRect(0f, 0f, w, h, bgPaint)

        // (2) 顶部摄影画卷 (比例约 42%, 640px)
        val photoHeight = 640f
        if (photo != null) {
            val photoSrc = Rect(0, 0, photo.width, photo.height)
            // 保持宽高比居中裁切填满
            val scale = maxOf(w / photo.width, photoHeight / photo.height)
            val scaledW = photo.width * scale
            val scaledH = photo.height * scale
            val left = (w - scaledW) / 2f
            val top = 0f
            val photoDst = RectF(left, top, left + scaledW, top + scaledH)

            // 先裁剪出顶部区域
            canvas.save()
            canvas.clipRect(0f, 0f, w, photoHeight)
            canvas.drawBitmap(photo, photoSrc, photoDst, Paint(Paint.FILTER_BITMAP_FLAG))
            canvas.restore()
        }

        // (3) 摄影图向底色的自然羽化过渡渐变
        val featherPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(
                0f, photoHeight - 280f, 0f, photoHeight,
                intArrayOf(
                    android.graphics.Color.TRANSPARENT,
                    android.graphics.Color.argb(160, 20, 23, 28),
                    android.graphics.Color.rgb(20, 23, 28),
                ),
                floatArrayOf(0f, 0.6f, 1f),
                Shader.TileMode.CLAMP,
            )
        }
        canvas.drawRect(0f, photoHeight - 280f, w, photoHeight, featherPaint)

        val marginX = 72f
        val contentW = (w - marginX * 2).toInt()

        // (4) 顶栏印章徽标 + 来源标签 + 期号
        val topY = 68f
        val accentGold = android.graphics.Color.rgb(228, 180, 92)

        // 分类印章胶囊
        val categoryText = card.category.ifBlank { "知识" }
        val domain = resolveDomainCode(card.category)
        val badgeText = "$categoryText · $domain"
        val badgePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.rgb(16, 16, 18)
            textSize = 24f
            typeface = Typeface.create(Typeface.SERIF, Typeface.BOLD)
        }
        val badgeTextWidth = badgePaint.measureText(badgeText)
        val badgePadH = 26f
        val badgeH = 50f
        val badgeW = badgeTextWidth + badgePadH * 2
        val badgeRect = RectF(marginX, topY, marginX + badgeW, topY + badgeH)

        val badgeBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = accentGold
        }
        canvas.drawRoundRect(badgeRect, badgeH / 2f, badgeH / 2f, badgeBgPaint)
        canvas.drawText(badgeText, marginX + badgePadH, topY + 34f, badgePaint)

        // 来源标签胶囊
        val sourceText = when (card.source) {
            CardSource.AI -> "AI 精研"
            CardSource.IMPORTED -> "导入笔记"
            CardSource.SEED -> "预置典藏"
        }
        val srcPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.argb(220, 255, 255, 255)
            textSize = 22f
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
        }
        val srcW = srcPaint.measureText(sourceText) + 36f
        val srcLeft = marginX + badgeW + 20f
        val srcRect = RectF(srcLeft, topY, srcLeft + srcW, topY + badgeH)
        val srcBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.argb(100, 0, 0, 0)
        }
        canvas.drawRoundRect(srcRect, badgeH / 2f, badgeH / 2f, srcBgPaint)
        val srcStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.argb(60, 255, 255, 255)
            style = Paint.Style.STROKE
            strokeWidth = 2f
        }
        canvas.drawRoundRect(srcRect, badgeH / 2f, badgeH / 2f, srcStrokePaint)
        canvas.drawText(sourceText, srcLeft + 18f, topY + 33f, srcPaint)

        // 期号 № 0428
        val issueNum = String.format(Locale.US, "%04d", abs(card.headline.hashCode() % 10000))
        val issueText = "№ $issueNum"
        val issuePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.argb(140, 255, 255, 255)
            textSize = 24f
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
        }
        val issueW = issuePaint.measureText(issueText)
        canvas.drawText(issueText, w - marginX - issueW, topY + 34f, issuePaint)

        // (5) 核心大标题 (Serif 52px, 粗体白色)
        val titleY = 660f
        val titlePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.WHITE
            textSize = 48f
            typeface = Typeface.create(Typeface.SERIF, Typeface.BOLD)
            setShadowLayer(8f, 0f, 4f, android.graphics.Color.argb(180, 0, 0, 0))
        }
        val titleLayout = createStaticLayout(card.headline, titlePaint, contentW, 4)
        canvas.save()
        canvas.translate(marginX, titleY)
        titleLayout.draw(canvas)
        canvas.restore()

        val afterTitleY = titleY + titleLayout.height + 28f

        // (6) 主题色装饰条 (细条 88px + 圆点)
        val decoPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = accentGold
        }
        canvas.drawRoundRect(RectF(marginX, afterTitleY, marginX + 88f, afterTitleY + 6f), 3f, 3f, decoPaint)
        canvas.drawCircle(marginX + 104f, afterTitleY + 3f, 3.5f, decoPaint)

        val afterDecoY = afterTitleY + 32f

        // (7) 金句引用框 (Summary)
        val quotePadH = 32f
        val quotePadV = 28f
        val quotePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.argb(235, 255, 255, 255)
            textSize = 30f
            typeface = Typeface.create(Typeface.SERIF, Typeface.NORMAL)
        }
        val quoteMarkPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = accentGold
            textSize = 64f
            typeface = Typeface.create(Typeface.SERIF, Typeface.BOLD)
        }
        val quoteInnerW = contentW - quotePadH.toInt() * 2 - 40
        val quoteLayout = createStaticLayout(card.summary, quotePaint, quoteInnerW, 4)
        val quoteCardH = quoteLayout.height + quotePadV * 2 + 10f

        val quoteRect = RectF(marginX, afterDecoY, marginX + contentW, afterDecoY + quoteCardH)
        val quoteBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.argb(18, 255, 255, 255)
        }
        canvas.drawRoundRect(quoteRect, 20f, 20f, quoteBgPaint)
        val quoteBorderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.argb(32, 255, 255, 255)
            style = Paint.Style.STROKE
            strokeWidth = 2f
        }
        canvas.drawRoundRect(quoteRect, 20f, 20f, quoteBorderPaint)

        // 绘制大引号与文字
        canvas.drawText("“", marginX + 24f, afterDecoY + 54f, quoteMarkPaint)
        canvas.save()
        canvas.translate(marginX + 60f, afterDecoY + quotePadV)
        quoteLayout.draw(canvas)
        canvas.restore()

        // (8) 选段精粹解读 (Details 首段)
        val detailY = afterDecoY + quoteCardH + 28f
        val firstDetail = card.details.lines().firstOrNull { it.isNotBlank() } ?: ""
        if (firstDetail.isNotBlank()) {
            val detailPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
                color = android.graphics.Color.argb(175, 255, 255, 255)
                textSize = 25f
                typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
            }
            val detailLayout = createStaticLayout(firstDetail, detailPaint, contentW, 3)
            canvas.save()
            canvas.translate(marginX, detailY)
            detailLayout.draw(canvas)
            canvas.restore()
        }

        // (9) 底部细线条分割线
        val dividerY = h - 170f
        val dividerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.argb(35, 255, 255, 255)
            strokeWidth = 2f
        }
        canvas.drawLine(marginX, dividerY, w - marginX, dividerY, dividerPaint)

        // (10) 底部品牌印章 + 日期 + 专属二维码
        val footerY = dividerY + 28f

        // 品牌字样
        val brandPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.WHITE
            textSize = 28f
            typeface = Typeface.create(Typeface.SERIF, Typeface.BOLD)
        }
        canvas.drawText("KnowFlick", marginX, footerY + 32f, brandPaint)
        val subBrandPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.argb(130, 255, 255, 255)
            textSize = 19f
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
        }
        canvas.drawText("每天学点新东西 · Daily Knowledge", marginX, footerY + 68f, subBrandPaint)

        // 二维码绘制 (84x84 px)
        val qrSize = 84
        val qrLeft = w - marginX - qrSize
        val qrTop = footerY
        val qrUrl = "https://knowflick.app/c/${card.id.take(8)}"
        drawQrCode(canvas, qrUrl, qrLeft, qrTop, qrSize.toFloat(), accentGold, android.graphics.Color.WHITE)

        // 日期与分类出处标识
        val dateText = dateFormat.format(Date())
        val datePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.argb(180, 255, 255, 255)
            textSize = 22f
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.NORMAL)
        }
        val dateW = datePaint.measureText(dateText)
        canvas.drawText(dateText, qrLeft - dateW - 24f, footerY + 32f, datePaint)

        val editionPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.argb(90, 255, 255, 255)
            textSize = 17f
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
        }
        val editionText = "EDITORIAL COLLECTION"
        val editionW = editionPaint.measureText(editionText)
        canvas.drawText(editionText, qrLeft - editionW - 24f, footerY + 64f, editionPaint)
    }

    // ==========================================
    // 2. 文艺拍立得风 (Polaroid Snapshot)
    // ==========================================

    private fun renderPolaroid(
        canvas: Canvas,
        card: KnowledgeCard,
        photo: Bitmap?,
        posterStyle: CardPosterStyle,
    ) {
        val w = posterStyle.width.toFloat()
        val h = posterStyle.height.toFloat()

        // (1) 复古象牙米白相纸底色 (#FAF9F7)
        val paperPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.rgb(250, 249, 247)
        }
        canvas.drawRect(0f, 0f, w, h, paperPaint)

        // 相纸边框
        val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.argb(25, 0, 0, 0)
            style = Paint.Style.STROKE
            strokeWidth = 3f
        }
        canvas.drawRoundRect(RectF(12f, 12f, w - 12f, h - 12f), 24f, 24f, borderPaint)

        // (2) 方幅照片区 (边距 64px, 宽 912px, 高 760px)
        val photoMargin = 64f
        val photoW = w - photoMargin * 2
        val photoH = 760f
        val photoRect = RectF(photoMargin, photoMargin, photoMargin + photoW, photoMargin + photoH)

        if (photo != null) {
            val scale = maxOf(photoW / photo.width, photoH / photo.height)
            val scaledW = photo.width * scale
            val scaledH = photo.height * scale
            val left = photoMargin + (photoW - scaledW) / 2f
            val top = photoMargin + (photoH - scaledH) / 2f
            val photoDst = RectF(left, top, left + scaledW, top + scaledH)

            canvas.save()
            val clipPath = Path().apply {
                addRoundRect(photoRect, 14f, 14f, Path.Direction.CW)
            }
            canvas.clipPath(clipPath)
            canvas.drawBitmap(photo, Rect(0, 0, photo.width, photo.height), photoDst, Paint(Paint.FILTER_BITMAP_FLAG))
            canvas.restore()
        } else {
            val defaultPhotoPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = android.graphics.Color.rgb(220, 215, 205)
            }
            canvas.drawRoundRect(photoRect, 14f, 14f, defaultPhotoPaint)
        }

        // 照片暗角微细内边框
        val innerBorderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.argb(45, 0, 0, 0)
            style = Paint.Style.STROKE
            strokeWidth = 2f
        }
        canvas.drawRoundRect(photoRect, 14f, 14f, innerBorderPaint)

        // 照片左下角分类微标
        val badgeText = card.category.ifBlank { "知识" }
        val badgePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.WHITE
            textSize = 22f
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
        }
        val badgeW = badgePaint.measureText(badgeText) + 36f
        val badgeH = 46f
        val badgeL = photoMargin + 24f
        val badgeT = photoMargin + photoH - badgeH - 24f
        val badgeBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.argb(170, 0, 0, 0)
        }
        canvas.drawRoundRect(RectF(badgeL, badgeT, badgeL + badgeW, badgeT + badgeH), badgeH / 2f, badgeH / 2f, badgeBgPaint)
        canvas.drawText(badgeText, badgeL + 18f, badgeT + 31f, badgePaint)

        // (3) 手写感留白排版：主标题
        val textL = photoMargin + 12f
        val textW = (photoW - 24f).toInt()
        val titleY = photoMargin + photoH + 54f
        val titlePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.rgb(38, 41, 46)
            textSize = 42f
            typeface = Typeface.create(Typeface.SERIF, Typeface.BOLD)
        }
        val titleLayout = createStaticLayout(card.headline, titlePaint, textW, 3)
        canvas.save()
        canvas.translate(textL, titleY)
        titleLayout.draw(canvas)
        canvas.restore()

        // 摘要
        val summaryY = titleY + titleLayout.height + 24f
        val summaryPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.rgb(97, 102, 112)
            textSize = 27f
            typeface = Typeface.create(Typeface.SERIF, Typeface.NORMAL)
        }
        val summaryLayout = createStaticLayout(card.summary, summaryPaint, textW, 4)
        canvas.save()
        canvas.translate(textL, summaryY)
        summaryLayout.draw(canvas)
        canvas.restore()

        // (4) 拍立得底部极简签名与微缩二维码
        val footerY = h - 140f
        val brandPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.rgb(51, 53, 61)
            textSize = 30f
            typeface = Typeface.create(Typeface.SERIF, Typeface.BOLD)
        }
        canvas.drawText("KnowFlick.", textL, footerY + 34f, brandPaint)
        val snapPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.rgb(150, 155, 165)
            textSize = 19f
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.NORMAL)
        }
        canvas.drawText("daily snapshot", textL, footerY + 68f, snapPaint)

        // 二维码 (76x76 px)
        val qrSize = 76
        val qrLeft = w - photoMargin - qrSize
        val qrTop = footerY + 4f
        val qrUrl = "https://knowflick.app/c/${card.id.take(8)}"
        drawQrCode(canvas, qrUrl, qrLeft, qrTop, qrSize.toFloat(), android.graphics.Color.rgb(38, 41, 46), android.graphics.Color.WHITE)

        val dateText = dateFormat.format(Date())
        val datePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.rgb(130, 135, 145)
            textSize = 24f
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.NORMAL)
        }
        val dateW = datePaint.measureText(dateText)
        canvas.drawText(dateText, qrLeft - dateW - 20f, footerY + 46f, datePaint)
    }

    // ==========================================
    // 辅助工具方法
    // ==========================================

    private fun createStaticLayout(
        text: CharSequence,
        paint: TextPaint,
        width: Int,
        maxLines: Int,
    ): StaticLayout {
        return StaticLayout.Builder.obtain(text, 0, text.length, paint, width.coerceAtLeast(10))
            .setAlignment(Layout.Alignment.ALIGN_NORMAL)
            .setLineSpacing(10f, 1.25f)
            .setMaxLines(maxLines)
            .setEllipsize(android.text.TextUtils.TruncateAt.END)
            .build()
    }

    private fun drawQrCode(
        canvas: Canvas,
        content: String,
        left: Float,
        top: Float,
        size: Float,
        darkColor: Int,
        lightColor: Int,
    ) {
        val matrix = QrCodeEncoder.encode(content, quietZone = 1)
        val matSize = matrix.size
        val moduleSize = size / matSize.toFloat()

        // 绘制白色底板
        val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = lightColor }
        canvas.drawRoundRect(RectF(left - 4f, top - 4f, left + size + 4f, top + size + 4f), 6f, 6f, bgPaint)

        // 绘制二维码黑白模组
        val darkPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = darkColor }
        for (r in 0 until matSize) {
            for (c in 0 until matSize) {
                if (matrix[r][c]) {
                    val ml = left + c * moduleSize
                    val mt = top + r * moduleSize
                    canvas.drawRect(ml, mt, ml + moduleSize, mt + moduleSize, darkPaint)
                }
            }
        }
    }

    private fun resolveDomainCode(category: String): String {
        return when {
            category.contains("AI", ignoreCase = true) || category.contains("智能") -> "TECH.AI"
            category.contains("开发") || category.contains("代码") || category.contains("架构") -> "TECH.DEV"
            category.contains("会计") || category.contains("财务") || category.contains("金融") -> "FIN.ACC"
            category.contains("物理") || category.contains("量子") -> "SCI.PHYS"
            category.contains("宇宙") || category.contains("天文") -> "SCI.ASTRO"
            category.contains("生物") || category.contains("基因") -> "SCI.BIO"
            category.contains("哲学") || category.contains("思辨") -> "HUMAN.PHIL"
            category.contains("历史") -> "HUMAN.HIST"
            category.contains("脑") || category.contains("认知") || category.contains("心理") -> "HUMAN.COG"
            category.contains("冷知识") || category.contains("趣味") -> "FUN.TRIVIA"
            else -> "KNOWFLICK"
        }
    }
}
