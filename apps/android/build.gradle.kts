// 顶层构建配置：插件版本集中管理（不在此应用）
plugins {
    // AGP 8.9.2（2026-09-30 工具链升级）：compileSdk 36 的最低要求是 AGP 8.9.1+；
    // 这一步同时解开了 activity-compose 1.13 与 lifecycle 2.10 的锁——
    // 两者此前被旧 lint 的 Kotlin 分析 API 不兼容与 AAR 元数据卡在 8.7.3（见 app 依赖注释）。
    id("com.android.application") version "8.9.2" apply false
    // Kotlin 2.0.21 → 2.1.21（2026-10-11 跨平台工具链实验）：不为追新，而是为了让桌面端能用
    // Compose Multiplatform。CMP ≥ 1.8.0 的最低要求就是 Kotlin ≥ 2.1.0，而 2.1.x 恰好落在
    // 「2.0.21 能读的元数据上限」内（实测编译器的上限是 2.1.0），所以任何为兼容保留的旧模块
    // 都不会被元数据卡住。AGP 8.9.2 与 Compose BOM 2025.06.00 均不动——BOM 锁的
    // androidx.compose.* 正是 1.8.2，与 CMP 1.8.2 对应的 Jetpack Compose 版本逐号相同。
    // 依据与实测矩阵见 docs/windows-route/CMP_TOOLCHAIN_ALIGNMENT.md。
    id("org.jetbrains.kotlin.android") version "2.1.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.1.21" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.1.21" apply false
    // baseline profile 生成（供 :baselineprofile 模块使用）
    id("androidx.baselineprofile") version "1.4.1" apply false
}
