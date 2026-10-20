@file:OptIn(org.jetbrains.compose.ExperimentalComposeLibrary::class)

// :desktop —— 桌面宿主骨架（Kotlin JVM + Compose Multiplatform 1.8.2）。
//
// 定位：**骨架，不是产品界面**。它存在的意义是三件事，都已在本模块的测试里固定下来：
//   1. 在真实构建里证明「同一份 :domain 逻辑可以被非 Android 宿主复用」（不是引 jar，
//      是 project(":domain") 项目依赖）；
//   2. 把桌面 UI 工具链钉在一条已验证的版本线上（Kotlin 2.1.21 + CMP 1.8.2；
//      与 compose-bom:2025.06.00 的 androidx.compose.* = 1.8.2 逐号对齐）；
//   3. 给 Windows 端留一个可运行的起点（`./gradlew :desktop:run`）。
//
// 尚未实现：卡库持久化（桌面侧没有 data 层）、任何真实界面、打包分发。
// 拓扑取舍（为何暂驻 apps/android 构建内）见同目录 README.md。
plugins {
    kotlin("jvm")
    id("org.jetbrains.compose")
    id("org.jetbrains.kotlin.plugin.compose")
}

kotlin { jvmToolchain(17) }

dependencies {
    implementation(project(":domain"))
    implementation(compose.desktop.currentOs)
    implementation(compose.material3)

    testImplementation(kotlin("test"))
    testImplementation(compose.desktop.currentOs)
    // compose.uiTest 仍是实验 API，故文件头有 @file:OptIn
    testImplementation(compose.uiTest)
}

tasks.test {
    // 离屏渲染：CI 的 Linux runner 没有 X11，本地 macOS/Windows 也不该弹窗。
    // 组合与断言都跑在无头路径上——这正是 `composableRendersHeadless` 用例的意义。
    systemProperty("java.awt.headless", "true")
}

compose.desktop {
    application {
        mainClass = "com.knowflick.desktop.MainKt"
    }
}
