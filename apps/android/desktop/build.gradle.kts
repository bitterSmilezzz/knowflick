@file:OptIn(org.jetbrains.compose.ExperimentalComposeLibrary::class)

import org.jetbrains.compose.desktop.application.dsl.TargetFormat

// :desktop —— 桌面宿主（Kotlin JVM + Compose Multiplatform 1.8.2）。
//
// 定位（ADR-0001 时代的活计划）：同一份代码在 Windows / macOS / Linux 三处发布，与 Android 端共用
// :domain（逻辑）与 :shared-ui（界面），自己只负责「在桌面把共享界面跑起来 + 打成安装包」。
// **ADR-0002 之后本模块已冻住**：桌面第一套改走 `apps/workbench`（Web + Tauri），这里不再加功能，
// 等第一套闭环跑通前也不删。
//
// 三端安装包同一份配置声明（jpackage 不支持交叉编译，所以要**在各自系统上各构建一次**，
// 这正是 .github/workflows/desktop.yml 的 matrix 在做的事——不是三份配置，是三台机器跑同一份配置）。
//
// 拓扑取舍（为何暂驻 apps/android 构建内）见同目录 README.md。
plugins {
    kotlin("jvm")
    id("org.jetbrains.compose")
    id("org.jetbrains.kotlin.plugin.compose")
}

kotlin { jvmToolchain(17) }

// 底图等共享资源：把仓库根的 shared/assets 挂进本模块资源（与 Android 端
// `assets.srcDirs("../../../shared/assets")` **同一份来源、同一个 bg/<key>.webp 布局**）。
// 于是桌面端不必留副本，`:shared-ui` 的 jvm 侧 actual 直接 classpath 读 /bg/<key>.webp。
sourceSets["main"].resources.srcDir(file("../../../shared/assets"))

dependencies {
    implementation(project(":domain"))
    // 共享界面层：桌面端用的主题与组件与 Android 端是同一份（:shared-ui）
    implementation(project(":shared-ui"))
    // 共享持久化层：卡库落盘逻辑与 Android 端是同一份（:shared-data），
    // 桌面端只负责告诉它「数据目录在哪」——这就是平台边界。
    implementation(project(":shared-data"))
    implementation(compose.desktop.currentOs)
    implementation(compose.material3)

    testImplementation(kotlin("test"))
    // 桌面端也要能验证 AI 全链路（与 :domain 的 AI 测试同一套假服务器手法）
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation(compose.desktop.currentOs)
    // compose.uiTest 仍是实验 API，故文件头有 @file:OptIn
    testImplementation(compose.uiTest)
}

tasks.test {
    // 离屏渲染：CI 的 Linux runner 没有 X11，本地 macOS/Windows 也不该弹窗。
    // 组合与断言都跑在无头路径上——这正是 `rendersSharedLibraryScreenHeadless` 用例的意义。
    systemProperty("java.awt.headless", "true")
}

compose.desktop {
    application {
        mainClass = "com.knowflick.desktop.MainKt"

        // 图标产物不在时**在打包这一步就失败**，而不是静默套上 jpackage 的默认图标
        //（后者在安装包里不容易被发现）。必须是**独立任务 + dependsOn**：
        // 图标是打包任务的输入，输入校验先于任何 doFirst 执行，所以 doFirst 里守不住。
        val verifyAppIcons by tasks.registering {
            val icons = listOf("AppIcon.icns", "AppIcon.ico", "AppIcon.png")
            doLast {
                val missing = icons.filterNot { file("../../../shared/icons/$it").exists() }
                require(missing.isEmpty()) {
                    "缺少图标产物 shared/icons/${missing.joinToString()} —— 跑 python3 tools/generate_app_icons.py 生成"
                }
            }
        }
        tasks.matching {
            it.name.startsWith("package") || it.name.startsWith("createDistributable")
        }.configureEach { dependsOn(verifyAppIcons) }

        nativeDistributions {
            // 桌面端自己的版本序列（与 mac 的 v*、android 的 android-v* 并列，不互相借用）
            packageVersion = "0.1.0"
            packageName = "KnowFlick"
            // 安装器元数据**必须纯 ASCII**：jpackage 用平台默认字符集读它自己的 @argfile，
            // 在 Windows runner（cp1252）上遇到中文会直接抛 `Input length = 1`
            //（MalformedInputException），MSI 构建失败——实测踩过，日志见 CI 的 packageMsi。
            // 想要中文安装器文案，得等 jpackage/CMP 支持按端覆盖 description，或自己后处理 WiX。
            description = "KnowFlick knowledge workspace (desktop)"
            vendor = "KnowFlick"

            // 三个系统各出原生安装包；在哪个系统构建哪个格式，见 desktop.yml 的 matrix。
            targetFormats(TargetFormat.Dmg, TargetFormat.Msi, TargetFormat.Deb)

            // 应用图标：**美术只有一份**（apps/mac/Resources/AppIcon.iconset），
            // 三端格式由 tools/generate_app_icons.py 派生到 shared/icons 并随仓库分发。
            // jpackage 不交叉编译、也不认「一种格式走三端」，所以这里按端各指一份产物。
            val sharedIcons = file("../../../shared/icons")

            macOS {
                // jpackage 的 macOS bundle 版本要求 MAJOR > 0（0.1.0 会被直接拒绝），
                // 所以 bundle 内嵌版本用 1.0.0，**产品版本仍以 packageVersion = 0.1.0 为准**
                //（tag、Release 说明、其余两端安装包都用 0.1.0）。这是打包器限制，不是版本口径分裂。
                packageVersion = "1.0.0"
                dmgPackageVersion = "1.0.0"
                iconFile.set(sharedIcons.resolve("AppIcon.icns"))
            }

            windows {
                iconFile.set(sharedIcons.resolve("AppIcon.ico"))
            }

            linux {
                iconFile.set(sharedIcons.resolve("AppIcon.png"))
            }
            // 仓库已有 apps/mac/Resources/AppIcon.iconset/ 与 Android 侧图标，接入时同样要避免三份手工维护。
        }
    }
}
