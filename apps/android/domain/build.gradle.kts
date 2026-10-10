// :domain —— androidx-free 领域层，Kotlin Multiplatform（androidTarget + jvm）。
//
// 目的（docs/windows-route/DECISION_MEMO.md）：验证「Android 与桌面（Windows 走 jvm target）
// 共享一份领域逻辑」这条工具链路线。本模块是探针切片：先迁入依赖闭包最小的文件，
// 用实际构建回答两个开放问题——
//   1. 双 JVM target（android + jvm）下，含 `java.time` / `java.util` 的文件能否放进
//      共享源集（jvmAndAndroidMain），还是必须拆 platform-specific actual；
//   2. Kotlin 2.0.21 时代的 KMP 与 AGP 8.9.2 / Compose BOM 的兼容面。
// 路线与工作量见 docs/windows-route/CMP-FEASIBILITY.md；全量迁移是后续波次，不是本模块现状。
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
                // @Serializable（Tombstone）与 JSON 编解码的公共 API 面
                implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
            }
        }

        val jvmAndAndroidMain by getting {
            dependencies {
                // Card.kt 的 @Immutable：Compose Multiplatform runtime 在 android target 上
                // 解析为 androidx.compose.runtime，在 jvm（桌面）上是 Skiko 版——同一份 import。
                implementation("org.jetbrains.compose.runtime:runtime:1.7.3")
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
