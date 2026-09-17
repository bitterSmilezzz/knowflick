package com.knowflick.app.widget

import android.content.Context
import android.content.Intent
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalSize
import androidx.glance.action.ActionParameters
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.knowflick.app.MainActivity
import com.knowflick.app.R
import com.knowflick.app.domain.CardThemeResolver
import com.knowflick.app.domain.KnowledgeCard

/**
 * KnowFlick 桌面每日知识卡片微件 (Jetpack Glance)：
 * 支持 Responsive 响应式多尺寸网格自适应（2×2 / 4×2 / 4×3+）；
 * 支持在桌面快速换卡、切换收藏状态、点击直达 App 卡片详情。
 */
class DailyCardGlanceWidget : GlanceAppWidget() {

    companion object {
        val SMALL_SQUARE = DpSize(140.dp, 120.dp) // 2x2
        val MEDIUM_WIDE = DpSize(240.dp, 130.dp)  // 4x2
        val LARGE_FULL = DpSize(260.dp, 210.dp)   // 4x3+
    }

    override val sizeMode = SizeMode.Responsive(
        setOf(SMALL_SQUARE, MEDIUM_WIDE, LARGE_FULL)
    )

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val currentCard = WidgetCardRepository.getCurrentCard(context)
        val themeKey = currentCard?.let { CardThemeResolver.forCard(it) } ?: "tech"
        val bgBitmap = WidgetBitmapHelper.loadWidgetBackground(context, themeKey)

        provideContent {
            GlanceTheme {
                val size = LocalSize.current
                if (currentCard != null) {
                    CardContent(context, currentCard, bgBitmap, size)
                } else {
                    EmptyContent(context)
                }
            }
        }
    }

    @androidx.compose.runtime.Composable
    private fun CardContent(
        context: Context,
        card: KnowledgeCard,
        bgBitmap: android.graphics.Bitmap?,
        size: DpSize,
    ) {
        val openAppIntent = Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            putExtra("EXTRA_CARD_ID", card.id)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val openAppAction = actionStartActivity(openAppIntent)

        Box(
            modifier = GlanceModifier
                .fillMaxSize()
                .cornerRadius(18.dp)
                .background(Color(0xFF141318))
                .clickable(openAppAction),
        ) {
            // 背景底图渲染（带渐变遮罩）
            if (bgBitmap != null) {
                Image(
                    provider = ImageProvider(bgBitmap),
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = GlanceModifier.fillMaxSize().cornerRadius(18.dp),
                )
            }

            // 内容分层
            val isSmall = size.width < 220.dp
            val isLarge = size.height >= 180.dp

            Column(
                modifier = GlanceModifier
                    .fillMaxSize()
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.Top,
            ) {
                // 顶栏：分类徽标 + 品牌名
                Row(
                    modifier = GlanceModifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier = GlanceModifier
                            .cornerRadius(6.dp)
                            .background(Color(0x38C79A4B))
                            .padding(horizontal = 7.dp, vertical = 2.dp),
                    ) {
                        Text(
                            text = card.category.ifBlank { "每日精选" },
                            style = TextStyle(
                                color = ColorProvider(Color(0xFFF1C77A)),
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                            ),
                        )
                    }

                    Spacer(modifier = GlanceModifier.defaultWeight())

                    if (!isSmall) {
                        Text(
                            text = "KnowFlick",
                            style = TextStyle(
                                color = ColorProvider(Color(0x80EDE8DF)),
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Medium,
                            ),
                        )
                    }
                }

                Spacer(modifier = GlanceModifier.height(6.dp))

                // 卡片标题
                Text(
                    text = card.headline,
                    maxLines = if (isSmall) 3 else if (isLarge) 3 else 2,
                    style = TextStyle(
                        color = ColorProvider(Color(0xFFF5F0E8)),
                        fontSize = if (isSmall) 13.sp else if (isLarge) 16.sp else 14.sp,
                        fontWeight = FontWeight.Bold,
                    ),
                    modifier = GlanceModifier.fillMaxWidth(),
                )

                // 摘要正文（在标准和沉浸大图尺寸中展示）
                if (!isSmall && card.summary.isNotBlank()) {
                    Spacer(modifier = GlanceModifier.height(4.dp))
                    Text(
                        text = card.summary,
                        maxLines = if (isLarge) 4 else 2,
                        style = TextStyle(
                            color = ColorProvider(Color(0xFFC8C2B8)),
                            fontSize = if (isLarge) 12.sp else 11.sp,
                        ),
                        modifier = GlanceModifier.fillMaxWidth(),
                    )
                }

                Spacer(modifier = GlanceModifier.defaultWeight())

                // 底栏操作区
                Row(
                    modifier = GlanceModifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (isLarge) {
                        Text(
                            text = "点击卡片阅读完整解析 →",
                            style = TextStyle(
                                color = ColorProvider(Color(0x99C79A4B)),
                                fontSize = 11.sp,
                            ),
                        )
                    } else if (!isSmall) {
                        Image(
                            provider = ImageProvider(R.drawable.ic_widget_open),
                            contentDescription = "打开详情",
                            modifier = GlanceModifier
                                .size(26.dp)
                                .cornerRadius(13.dp)
                                .background(Color(0x33FFFFFF))
                                .padding(5.dp)
                                .clickable(openAppAction),
                        )
                    }

                    Spacer(modifier = GlanceModifier.defaultWeight())

                    // 收藏按键
                    Image(
                        provider = ImageProvider(
                            if (card.isFavorite) R.drawable.ic_widget_favorite else R.drawable.ic_widget_favorite_border
                        ),
                        contentDescription = if (card.isFavorite) "已收藏" else "收藏",
                        modifier = GlanceModifier
                            .size(32.dp)
                            .cornerRadius(16.dp)
                            .background(if (card.isFavorite) Color(0x33E55353) else Color(0x2BFFFFFF))
                            .padding(6.dp)
                            .clickable(actionRunCallback<ToggleFavoriteActionCallback>()),
                    )

                    Spacer(modifier = GlanceModifier.width(8.dp))

                    // 换一张按键
                    Image(
                        provider = ImageProvider(R.drawable.ic_widget_next),
                        contentDescription = "下一张",
                        modifier = GlanceModifier
                            .size(32.dp)
                            .cornerRadius(16.dp)
                            .background(Color(0x33C79A4B))
                            .padding(6.dp)
                            .clickable(actionRunCallback<NextCardActionCallback>()),
                    )
                }
            }
        }
    }

    @androidx.compose.runtime.Composable
    private fun EmptyContent(context: Context) {
        val openAppIntent = Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        Box(
            modifier = GlanceModifier
                .fillMaxSize()
                .cornerRadius(18.dp)
                .background(Color(0xFF141318))
                .clickable(actionStartActivity(openAppIntent))
                .padding(16.dp),
            contentAlignment = Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = "KnowFlick 每日卡片",
                    style = TextStyle(
                        color = ColorProvider(Color(0xFFF1C77A)),
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                    ),
                )
                Spacer(modifier = GlanceModifier.height(6.dp))
                Text(
                    text = "点击打开应用浏览知识卡片",
                    style = TextStyle(
                        color = ColorProvider(Color(0xFFB0AAA0)),
                        fontSize = 12.sp,
                    ),
                )
            }
        }
    }
}

/** 换一张卡片 Action 回调 */
class NextCardActionCallback : ActionCallback {
    override suspend fun onAction(
        context: Context,
        glanceId: GlanceId,
        parameters: ActionParameters
    ) {
        WidgetCardRepository.nextCard(context)
        DailyCardGlanceWidget().update(context, glanceId)
    }
}

/** 切换当前卡片收藏状态 Action 回调 */
class ToggleFavoriteActionCallback : ActionCallback {
    override suspend fun onAction(
        context: Context,
        glanceId: GlanceId,
        parameters: ActionParameters
    ) {
        WidgetCardRepository.toggleFavorite(context)
        DailyCardGlanceWidget().update(context, glanceId)
    }
}
