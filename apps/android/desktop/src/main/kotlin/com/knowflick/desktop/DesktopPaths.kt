package com.knowflick.desktop

import java.io.File

/**
 * 桌面侧唯一与平台相关的一点：**数据目录放哪**。
 *
 * 落盘逻辑本身在 `:shared-data`（与 Android 端同一份代码）；这里只按各系统的惯例给出目录，
 * 然后交给 `CardStorage`。这就是「一套开发，多处发布」里的平台边界——刻意只有这几行，
 * 不要再往下复制任何存储实现。
 */
object DesktopPaths {

    /** 卡库目录（`<数据根>/store`），与 Android 端 `filesDir/store` 同名同结构。 */
    fun storeDir(): File = File(dataRoot(), "store").apply { mkdirs() }

    private fun dataRoot(): File {
        val home = File(System.getProperty("user.home"))
        val os = System.getProperty("os.name").orEmpty().lowercase()
        return when {
            os.contains("mac") -> File(home, "Library/Application Support/KnowFlick")
            os.contains("win") -> {
                val appData = System.getenv("APPDATA")
                File(appData ?: File(home, "AppData/Roaming").path, "KnowFlick")
            }
            else -> {
                val xdg = System.getenv("XDG_DATA_HOME")
                File(xdg ?: File(home, ".local/share").path, "KnowFlick")
            }
        }
    }
}
