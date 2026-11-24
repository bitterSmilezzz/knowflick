// :domain —— androidx-free 领域层，Kotlin Multiplatform（androidTarget + jvm）。
//
// 定位：这是**产品模块**，不是探针——Android 装配层与（将来的）桌面端共用同一份领域逻辑。
// 模块由 2026-10 的跨平台探针建立，探针回答的两个开放问题：
//   1. 双 JVM target（android + jvm）下，含 `java.time` / `java.util` 的文件能否放进
//      共享源集（jvmAndAndroidMain），还是必须拆 platform-specific actual；
//   2. KMP 与 AGP 8.9.2 / Compose BOM 2025.06.00 的兼容面。
// 两条实测答案与后续波次见 docs/windows-route/KMP_PROBE_RESULT.md；
// 桌面 UI 选型见 docs/windows-route/CMP_TOOLCHAIN_ALIGNMENT.md。
// Kotlin 版本跟随根 build.gradle.kts（2026-10-11 起为 2.1.21——CMP ≥1.8 的最低要求）。
plugins {
    id("org.jetbrains.kotlin.multiplatform")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("com.android.library")
}

kotlin {
    // 自定义层级模板：推导出 Android 与 JVM 共享的 jvmAndAndroid 中间源集。
    //
    // 为什么手建：Kotlin 默认层级模板不给「JVM + Android」组合自动共享源集
    // （官方文档列为不支持组合），但 group 声明是 KGP 支持的扩展点，
    // androidx 自己在用同样的共享中间源集（datastore-core 的 jvmAndAndroidMain）。
    // 本模块用它承载含 `java.*` 的文件；若将来要出 iOS/Web 目标，
    // 这些文件需先替换为 kotlinx-datetime 等公共库（评估见 CMP-FEASIBILITY.md §2.2）。
    applyDefaultHierarchyTemplate {
        common {
            group("jvmAndAndroid") {
                withAndroidTarget()
                withJvm()
            }
        }
    }

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
                // @Serializable（Tombstone / KnowledgeCard）与 JSON 编解码属于**公开 API**：
                // 消费者要调用 KnowledgeCard.serializer() 或 Json.encodeToString，就必须在
                // 自己的编译类路径上看到 kotlinx-serialization。用 api 而非 implementation，
                // 免得每个消费方各写一遍同一行依赖（:desktop 骨架就撞过这个坑）。
                api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
            }
        }

        val jvmAndAndroidMain by getting {
            dependencies {
                // Card.kt 的 @Immutable：Compose Multiplatform runtime 在 android target 上
                // 解析为 androidx.compose.runtime，在 jvm（桌面）上是 Skiko 版——同一份 import。
                implementation("org.jetbrains.compose.runtime:runtime:1.7.3")
                // AI 服务层（:domain 的 ai/ 与 net/）：两个 target 都是 JVM，OkHttp 通吃；
                // 版本与 :app 一致（4.12.0），避免同一份代码在不同类路径上跑不同版本。
                implementation("com.squareup.okhttp3:okhttp:4.12.0")
                // AI 服务是 suspend 的，且 net/OkHttpAwait 用 suspendCancellableCoroutine——
                // 显式声明，不靠 compose runtime 的传递依赖（传递依赖一旦变化就会编译不过）
                implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
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
                implementation("com.squareup.okhttp3:mockwebserver:4.12.0")
                // AI 服务测试用 runTest（与 :app 同版本）
                implementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
                // 领域层测试套件（15 文件 2850 行）2026-10-10 从 app 模块整体迁入本模块：
                // 迁入前写在 org.junit 的 JUnit4 API 上，此处与 app 的 testImplementation 同版本。
                // 落在 jvmTest 而非 commonTest 的原因：断言 API 是 org.junit（commonTest 只能写
                // kotlin.test），转换是纯机械改动，留作后续波次；当前 jvm 目标已覆盖桌面与 Android
                // 两个宿主的 JVM 语义，探针问题不受影响。
                implementation("junit:junit:4.13.2")
            }
        }
    }
}

android {
    namespace = "com.knowflick.app.domain"
    compileSdk = 36
    defaultConfig {
        minSdk = 26
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
