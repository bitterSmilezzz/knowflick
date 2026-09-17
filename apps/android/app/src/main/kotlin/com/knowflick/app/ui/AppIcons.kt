package com.knowflick.app.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * 应用自带的四个图标。
 *
 * 这里手写而不依赖 `material-icons-extended`：那是个含 2277 个图标的全量包，
 * 会让每个 debug 构建多出约 3.8 MB dex 与数十 MB 的依赖解析时间，而本项目只用其中 4 个。
 * 其余图标继续用 `material-icons-core`。
 *
 * 路径取自 Google Material Design Icons（Apache-2.0）官方 24px SVG。
 */
object AppIcons {

    /** 收藏阁入口 */
    val Bookmarks: ImageVector by lazy {
        materialIcon("AppIcons.Bookmarks") {
            moveTo(19f, 18f)
            lineTo(21f, 19f)
            verticalLineTo(3f)
            curveTo(21f, 1.9f, 20.1f, 1f, 19f, 1f)
            horizontalLineTo(8.99f)
            curveTo(7.89f, 1f, 7f, 1.9f, 7f, 3f)
            horizontalLineTo(17f)
            curveTo(18.1f, 3f, 19f, 3.9f, 19f, 5f)
            verticalLineTo(18f)
            close()
            moveTo(15f, 5f)
            horizontalLineTo(5f)
            curveTo(3.9f, 5f, 3f, 5.9f, 3f, 7f)
            verticalLineTo(23f)
            lineTo(10f, 20f)
            lineTo(17f, 23f)
            verticalLineTo(7f)
            curveTo(17f, 5.9f, 16.1f, 5f, 15f, 5f)
            close()
        }
    }

    /** 磨耳朵连续朗读开关 */
    val Headphones: ImageVector by lazy {
        materialIcon("AppIcons.Headphones") {
            moveTo(12f, 3f)
            curveTo(7.03f, 3f, 3f, 7.03f, 3f, 12f)
            verticalLineTo(19f)
            curveTo(3f, 20.1f, 3.9f, 21f, 5f, 21f)
            horizontalLineTo(9f)
            verticalLineTo(13f)
            horizontalLineTo(5f)
            verticalLineTo(12f)
            curveTo(5f, 8.13f, 8.13f, 5f, 12f, 5f)
            reflectiveCurveTo(19f, 8.13f, 19f, 12f)
            verticalLineTo(13f)
            horizontalLineTo(15f)
            verticalLineTo(21f)
            horizontalLineTo(19f)
            curveTo(20.1f, 21f, 21f, 20.1f, 21f, 19f)
            verticalLineTo(12f)
            curveTo(21f, 7.03f, 16.97f, 3f, 12f, 3f)
            close()
        }
    }

    /** 换一批 */
    val Sync: ImageVector by lazy {
        materialIcon("AppIcons.Sync") {
            moveTo(12f, 4f)
            verticalLineTo(1f)
            lineTo(8f, 5f)
            lineTo(12f, 9f)
            verticalLineTo(6f)
            curveTo(15.31f, 6f, 18f, 8.69f, 18f, 12f)
            curveTo(18f, 13.01f, 17.75f, 13.97f, 17.3f, 14.8f)
            lineTo(18.76f, 16.26f)
            curveTo(19.54f, 15.03f, 20f, 13.57f, 20f, 12f)
            curveTo(20f, 7.58f, 16.42f, 4f, 12f, 4f)
            close()
            moveTo(12f, 18f)
            curveTo(8.69f, 18f, 6f, 15.31f, 6f, 12f)
            curveTo(6f, 10.99f, 6.25f, 10.03f, 6.7f, 9.2f)
            lineTo(5.24f, 7.74f)
            curveTo(4.46f, 8.97f, 4f, 10.43f, 4f, 12f)
            curveTo(4f, 16.42f, 7.58f, 20f, 12f, 20f)
            verticalLineTo(23f)
            lineTo(16f, 19f)
            lineTo(12f, 15f)
            verticalLineTo(18f)
            close()
        }
    }

    /** 朗读全文 */
    val VolumeUp: ImageVector by lazy {
        materialIcon("AppIcons.VolumeUp") {
            moveTo(3f, 9f)
            verticalLineTo(15f)
            horizontalLineTo(7f)
            lineTo(12f, 20f)
            verticalLineTo(4f)
            lineTo(7f, 9f)
            horizontalLineTo(3f)
            close()
            moveTo(16.5f, 12f)
            curveTo(16.5f, 10.23f, 15.48f, 8.71f, 14f, 7.97f)
            verticalLineTo(16.02f)
            curveTo(15.48f, 15.29f, 16.5f, 13.77f, 16.5f, 12f)
            close()
            moveTo(14f, 3.23f)
            verticalLineTo(5.29f)
            curveTo(16.89f, 6.15f, 19f, 8.83f, 19f, 12f)
            reflectiveCurveTo(16.89f, 17.85f, 14f, 18.71f)
            verticalLineTo(20.77f)
            curveTo(18.01f, 19.86f, 21f, 16.28f, 21f, 12f)
            reflectiveCurveTo(18.01f, 4.14f, 14f, 3.23f)
            close()
        }
    }

    /** AI 追问星光 */
    val Sparkles: ImageVector by lazy {
        materialIcon("AppIcons.Sparkles") {
            moveTo(19f, 9f)
            lineTo(20.25f, 6.25f)
            lineTo(23f, 5f)
            lineTo(20.25f, 3.75f)
            lineTo(19f, 1f)
            lineTo(17.75f, 3.75f)
            lineTo(15f, 5f)
            lineTo(17.75f, 6.25f)
            close()
            moveTo(19f, 15f)
            lineTo(17.75f, 17.75f)
            lineTo(15f, 19f)
            lineTo(17.75f, 20.25f)
            lineTo(19f, 23f)
            lineTo(20.25f, 20.25f)
            lineTo(23f, 19f)
            lineTo(20.25f, 17.75f)
            close()
            moveTo(11.5f, 9.5f)
            lineTo(9f, 4f)
            lineTo(6.5f, 9.5f)
            lineTo(1f, 12f)
            lineTo(6.5f, 14.5f)
            lineTo(9f, 20f)
            lineTo(11.5f, 14.5f)
            lineTo(17f, 12f)
            close()
        }
    }

    /** 清空历史删除垃圾桶 */
    val Delete: ImageVector by lazy {
        materialIcon("AppIcons.Delete") {
            moveTo(6f, 19f)
            curveTo(6f, 20.1f, 6.9f, 21f, 8f, 21f)
            horizontalLineTo(16f)
            curveTo(17.1f, 21f, 18f, 20.1f, 18f, 19f)
            verticalLineTo(7f)
            horizontalLineTo(6f)
            verticalLineTo(19f)
            close()
            moveTo(19f, 4f)
            horizontalLineTo(15.5f)
            lineTo(14.5f, 3f)
            horizontalLineTo(9.5f)
            lineTo(8.5f, 4f)
            horizontalLineTo(5f)
            verticalLineTo(6f)
            horizontalLineTo(19f)
            verticalLineTo(4f)
            close()
        }
    }

    /** 追问发送按钮 */
    val ArrowUp: ImageVector by lazy {
        materialIcon("AppIcons.ArrowUp") {
            moveTo(4f, 12f)
            lineTo(5.41f, 13.41f)
            lineTo(11f, 7.83f)
            verticalLineTo(20f)
            horizontalLineTo(13f)
            verticalLineTo(7.83f)
            lineTo(18.59f, 13.41f)
            lineTo(20f, 12f)
            lineTo(12f, 4f)
            lineTo(4f, 12f)
            close()
        }
    }

    /** 停止流式生成 */
    val Stop: ImageVector by lazy {
        materialIcon("AppIcons.Stop") {
            moveTo(6f, 6f)
            horizontalLineTo(18f)
            verticalLineTo(18f)
            horizontalLineTo(6f)
            close()
        }
    }

    /** 复制内容 */
    val ContentCopy: ImageVector by lazy {
        materialIcon("AppIcons.ContentCopy") {
            moveTo(16f, 1f)
            horizontalLineTo(4f)
            curveTo(2.9f, 1f, 2f, 1.9f, 2f, 3f)
            verticalLineTo(17f)
            horizontalLineTo(4f)
            verticalLineTo(3f)
            horizontalLineTo(16f)
            verticalLineTo(1f)
            close()
            moveTo(19f, 5f)
            horizontalLineTo(8f)
            curveTo(6.9f, 5f, 6f, 5.9f, 6f, 7f)
            verticalLineTo(21f)
            curveTo(6f, 22.1f, 6.9f, 23f, 8f, 23f)
            horizontalLineTo(19f)
            curveTo(20.1f, 23f, 21f, 22.1f, 21f, 21f)
            verticalLineTo(7f)
            curveTo(21f, 5.9f, 20.1f, 5f, 19f, 5f)
            close()
            moveTo(19f, 21f)
            horizontalLineTo(8f)
            verticalLineTo(7f)
            horizontalLineTo(19f)
            verticalLineTo(21f)
            close()
        }
    }

    /** 画报风海报图标 */
    val Newspaper: ImageVector by lazy {
        materialIcon("AppIcons.Newspaper") {
            moveTo(20f, 4f)
            horizontalLineTo(4f)
            curveTo(2.9f, 4f, 2f, 4.9f, 2f, 6f)
            verticalLineTo(18f)
            curveTo(2f, 19.1f, 2.9f, 20f, 4f, 20f)
            horizontalLineTo(20f)
            curveTo(21.1f, 20f, 22f, 19.1f, 22f, 18f)
            verticalLineTo(6f)
            curveTo(22f, 4.9f, 21.1f, 4f, 20f, 4f)
            close()
            moveTo(5f, 8f)
            horizontalLineTo(11f)
            verticalLineTo(13f)
            horizontalLineTo(5f)
            close()
            moveTo(19f, 16f)
            horizontalLineTo(5f)
            verticalLineTo(14.5f)
            horizontalLineTo(19f)
            close()
            moveTo(19f, 13f)
            horizontalLineTo(12.5f)
            verticalLineTo(11.5f)
            horizontalLineTo(19f)
            close()
            moveTo(19f, 10f)
            horizontalLineTo(12.5f)
            verticalLineTo(8.5f)
            horizontalLineTo(19f)
            close()
        }
    }

    /** 拍立得相机图标 */
    val Camera: ImageVector by lazy {
        materialIcon("AppIcons.Camera") {
            moveTo(9f, 2f)
            lineTo(7.17f, 4f)
            horizontalLineTo(4f)
            curveTo(2.9f, 4f, 2f, 4.9f, 2f, 6f)
            verticalLineTo(18f)
            curveTo(2f, 19.1f, 2.9f, 20f, 4f, 20f)
            horizontalLineTo(20f)
            curveTo(21.1f, 20f, 22f, 19.1f, 22f, 18f)
            verticalLineTo(6f)
            curveTo(22f, 4.9f, 21.1f, 4f, 20f, 4f)
            horizontalLineTo(16.83f)
            lineTo(15f, 2f)
            horizontalLineTo(9f)
            close()
            moveTo(12f, 17f)
            curveTo(9.79f, 17f, 8f, 15.21f, 8f, 13f)
            curveTo(8f, 10.79f, 9.79f, 9f, 12f, 9f)
            curveTo(14.21f, 9f, 16f, 10.79f, 16f, 13f)
            curveTo(16f, 15.21f, 14.21f, 17f, 12f, 17f)
            close()
        }
    }

    /** 保存图片下载图标 */
    val Download: ImageVector by lazy {
        materialIcon("AppIcons.Download") {
            moveTo(19f, 9f)
            horizontalLineTo(15f)
            verticalLineTo(3f)
            horizontalLineTo(9f)
            verticalLineTo(9f)
            horizontalLineTo(5f)
            lineTo(12f, 16f)
            lineTo(19f, 9f)
            close()
            moveTo(5f, 18f)
            verticalLineTo(20f)
            horizontalLineTo(19f)
            verticalLineTo(18f)
            horizontalLineTo(5f)
            close()
        }
    }

    /** 播放 */
    val PlayArrow: ImageVector by lazy {
        materialIcon("AppIcons.PlayArrow") {
            moveTo(8f, 5f)
            verticalLineTo(19f)
            lineTo(19f, 12f)
            close()
        }
    }

    /** 暂停 */
    val Pause: ImageVector by lazy {
        materialIcon("AppIcons.Pause") {
            moveTo(6f, 19f)
            horizontalLineTo(10f)
            verticalLineTo(5f)
            horizontalLineTo(6f)
            verticalLineTo(19f)
            close()
            moveTo(14f, 5f)
            verticalLineTo(19f)
            horizontalLineTo(18f)
            verticalLineTo(5f)
            horizontalLineTo(14f)
            close()
        }
    }

    /** 上一张 / 上一首 */
    val SkipPrevious: ImageVector by lazy {
        materialIcon("AppIcons.SkipPrevious") {
            moveTo(6f, 6f)
            horizontalLineTo(8f)
            verticalLineTo(18f)
            horizontalLineTo(6f)
            close()
            moveTo(9.5f, 12f)
            lineTo(18f, 18f)
            verticalLineTo(6f)
            close()
        }
    }

    /** 下一张 / 下一首 */
    val SkipNext: ImageVector by lazy {
        materialIcon("AppIcons.SkipNext") {
            moveTo(6f, 18f)
            lineTo(14.5f, 12f)
            lineTo(6f, 6f)
            verticalLineTo(18f)
            close()
            moveTo(16f, 6f)
            verticalLineTo(18f)
            horizontalLineTo(18f)
            verticalLineTo(6f)
            horizontalLineTo(16f)
            close()
        }
    }

    /** 快退 5 秒 */
    val FastRewind: ImageVector by lazy {
        materialIcon("AppIcons.FastRewind") {
            moveTo(11f, 18f)
            verticalLineTo(6f)
            lineTo(1.5f, 12f)
            lineTo(11f, 18f)
            close()
            moveTo(11.5f, 12f)
            lineTo(21f, 18f)
            verticalLineTo(6f)
            lineTo(11.5f, 12f)
            close()
        }
    }

    /** 快进 5 秒 */
    val FastForward: ImageVector by lazy {
        materialIcon("AppIcons.FastForward") {
            moveTo(4f, 18f)
            lineTo(13.5f, 12f)
            lineTo(4f, 6f)
            verticalLineTo(18f)
            close()
            moveTo(13f, 6f)
            verticalLineTo(18f)
            lineTo(22.5f, 12f)
            lineTo(13f, 6f)
            close()
        }
    }

    /** 调音台 / 控制台 */
    val Tune: ImageVector by lazy {
        materialIcon("AppIcons.Tune") {
            moveTo(3f, 17f)
            verticalLineTo(19f)
            horizontalLineTo(9f)
            verticalLineTo(17f)
            horizontalLineTo(3f)
            close()
            moveTo(3f, 5f)
            verticalLineTo(7f)
            horizontalLineTo(13f)
            verticalLineTo(5f)
            horizontalLineTo(3f)
            close()
            moveTo(13f, 21f)
            verticalLineTo(19f)
            horizontalLineTo(21f)
            verticalLineTo(17f)
            horizontalLineTo(13f)
            verticalLineTo(15f)
            horizontalLineTo(11f)
            verticalLineTo(21f)
            horizontalLineTo(13f)
            close()
            moveTo(7f, 9f)
            verticalLineTo(11f)
            horizontalLineTo(3f)
            verticalLineTo(13f)
            horizontalLineTo(7f)
            verticalLineTo(15f)
            horizontalLineTo(9f)
            verticalLineTo(9f)
            horizontalLineTo(7f)
            close()
            moveTo(21f, 13f)
            verticalLineTo(11f)
            horizontalLineTo(11f)
            verticalLineTo(13f)
            horizontalLineTo(21f)
            close()
            moveTo(17f, 9f)
            horizontalLineTo(19f)
            verticalLineTo(7f)
            horizontalLineTo(21f)
            verticalLineTo(5f)
            horizontalLineTo(19f)
            verticalLineTo(3f)
            horizontalLineTo(17f)
            verticalLineTo(9f)
            close()
        }
    }

    private fun materialIcon(
        name: String,
        pathBuilder: androidx.compose.ui.graphics.vector.PathBuilder.() -> Unit,
    ): ImageVector = ImageVector.Builder(
        name = name,
        defaultWidth = 24.dp,
        defaultHeight = 24.dp,
        viewportWidth = 24f,
        viewportHeight = 24f,
    ).apply {
        path(
            fill = SolidColor(Color.Black),
            pathBuilder = pathBuilder,
        )
    }.build()
}
