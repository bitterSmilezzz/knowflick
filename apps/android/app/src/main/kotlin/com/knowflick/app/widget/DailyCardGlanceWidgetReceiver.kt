package com.knowflick.app.widget

import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver

/**
 * 桌面微件接收器：负责向系统 AppWidget 框架注册并绑定 DailyCardGlanceWidget
 */
class DailyCardGlanceWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = DailyCardGlanceWidget()
}
