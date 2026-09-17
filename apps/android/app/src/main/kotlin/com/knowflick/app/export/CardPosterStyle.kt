package com.knowflick.app.export

/**
 * 卡片分享海报排版风格（与 macOS 规范像素级对齐）。
 */
enum class CardPosterStyle(
    val title: String,
    val description: String,
    val width: Int,
    val height: Int,
) {
    /** 典雅杂志长图：暗黑摄影封面、衬线大标题、金句引言、精粹解读与期刊印章 */
    EDITORIAL(
        title = "画报风",
        description = "典雅杂志长图 · 深度知识排版",
        width = 1080,
        height = 1520,
    ),

    /** 文艺拍立得相纸：象牙复古底色、方幅内凹照片、手写留白排版与极简印戳 */
    POLAROID(
        title = "拍立得",
        description = "文艺胶片相纸 · 极简生活留白",
        width = 1040,
        height = 1360,
    );

    /** 宽高比（宽 / 高） */
    val aspectRatio: Float
        get() = width.toFloat() / height.toFloat()
}
