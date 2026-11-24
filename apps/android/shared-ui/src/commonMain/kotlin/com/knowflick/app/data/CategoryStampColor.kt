package com.knowflick.app.data

import androidx.compose.ui.graphics.Color

/** 分类印章主色：与 macOS 端 CategoryTheme 的领域色温对齐（四领域） */
object CategoryStampColor {
    private val cache = HashMap<String, Color>()

    fun forCategory(category: String): Color {
        cache[category]?.let { return it }
        val color = when {
            category.contains("会计") || category.contains("财务") || category.contains("理财") ||
                category.contains("投资") || category.contains("经济") -> Color(0xFFC79A4B)   // 商业财会金融：琥珀
            category.contains("AI") || category.contains("Agent") || category.contains("编程") ||
                category.contains("算法") || category.contains("Rust") || category.contains("Python") ||
                category.contains("科技") || category.contains("数据") || category.contains("网络") ||
                category.contains("安全") || category.contains("架构") -> Color(0xFF4A9ED9)   // 计算机与 AI
            category.contains("物理") || category.contains("生物") || category.contains("天文") ||
                category.contains("数学") || category.contains("化学") || category.contains("地理") ||
                category.contains("基因") || category.contains("生态") || category.contains("海洋") ||
                category.contains("天文") || category.contains("地质") || category.contains("气象") -> Color(0xFF5B8BC4)   // 自然宇宙科学
            else -> Color(0xFFB07E9C)   // 人文心智与未知
        }
        synchronized(cache) { cache[category] = color }
        return color
    }
}
