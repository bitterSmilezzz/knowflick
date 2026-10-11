@file:OptIn(org.jetbrains.compose.ExperimentalComposeLibrary::class)

// :shared-ui —— 跨端共享界面层（Compose Multiplatform）。
//
// 定位：**win / mac / linux 三端 + Android 四端共用同一份界面代码**。这是「一次开发多端同步」
// 的前端半边（后端半边是 :domain）。
//
// 与 :domain 同样的迁移策略：**包名保持 `com.knowflick.app.*` 不变**，所以把文件从 app 模块
// 搬进来时，调用方的 import 一行都不用改——这是 12k 行 UI 能分批迁移的前提。
//
// 边界（哪些能进来）：只用 Compose Multiplatform 的公共 API（androidx.compose.* 里
// CMP 有对应实现的部分）。Android 专有调用（LocalContext / Toast / Intent / Bitmap /
// assets 读取 / Glance 微件）不能进 commonMain——要么抽象成 expect/actual，
// 要么留在 :app。逐文件判定见 docs/windows-route/CMP-FEASIBILITY.md §3。
plugins {
    id("org.jetbrains.kotlin.multiplatform")
    id("com.android.library")
    id("org.jetbrains.compose")
    id("org.jetbrains.kotlin.plugin.compose")
}

kotlin {
    androidTarget {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }
    jvm {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }

    sourceSets {
        val commonMain by getting {
            dependencies {
                // 共享界面直接消费领域类型（KnowledgeCard 等），所以是 api 而不是 implementation
                api(project(":domain"))
                implementation(compose.runtime)
                implementation(compose.foundation)
                implementation(compose.material3)
                implementation(compose.ui)
            }
        }
        val commonTest by getting {
            dependencies {
                implementation(kotlin("test"))
            }
        }
        val jvmTest by getting {
            dependencies {
                implementation(kotlin("test"))
                // 桌面侧的离屏渲染验证（无头，不弹窗）
                implementation(compose.desktop.currentOs)
                implementation(compose.uiTest)
            }
        }
    }
}

android {
    namespace = "com.knowflick.sharedui"
    compileSdk = 36
    defaultConfig {
        minSdk = 26
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

tasks.withType<Test>().configureEach {
    // 与 :desktop 一致：渲染测试走离屏路径，CI 的 Linux runner 没有 X11。
    systemProperty("java.awt.headless", "true")
}
