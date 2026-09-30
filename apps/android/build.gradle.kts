// 顶层构建配置：插件版本集中管理（不在此应用）
plugins {
    // AGP 8.9.2（2026-09-30 工具链升级）：compileSdk 36 的最低要求是 AGP 8.9.1+；
    // 这一步同时解开了 activity-compose 1.13 与 lifecycle 2.10 的锁——
    // 两者此前被旧 lint 的 Kotlin 分析 API 不兼容与 AAR 元数据卡在 8.7.3（见 app 依赖注释）。
    id("com.android.application") version "8.9.2" apply false
    // Kotlin 2.0.21 有意不随本轮升级：AGP 8.9 对消费方 Kotlin 版本无要求，Compose 编译器
    // 插件与 serialization 均正常；Kotlin 升级的风险面（编译器行为变化、库元数据）值得单独
    // 一轮，不与工具链混在一起。
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.0.21" apply false
    // baseline profile 生成（供 :baselineprofile 模块使用）
    id("androidx.baselineprofile") version "1.4.1" apply false
}
