// :shared-data —— 跨端共享持久化层（KMP，androidTarget + jvm）。
//
// 定位：**一份落盘逻辑供 Android 与桌面三端共用**——卡库 JSON 的原子写、备份轮转、
// 损坏回退、持久化队列，都是「与平台无关的纯 JVM 文件 IO」。
//
// 唯一的平台边界是「目录从哪来」：各宿主注入自己的数据目录（Android `filesDir/store`、
// 桌面 `~/Library/Application Support/…` 等）。目录以下一律共享——这是「一套开发，多处发布」
// 在存储层的落地；**不要**为第二个宿主复制一份落盘实现。
//
// 与 :domain 同约定：包名保持 `com.knowflick.app.data` 不变，调用方 import 零改动。
plugins {
    id("org.jetbrains.kotlin.multiplatform")
    id("com.android.library")
}

kotlin {
    // java.io / java.nio 的文件 IO 放共享中间源集（与 :domain 同一套策略）
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
                // 存储写的是领域模型，消费方（宿主）也要看见那些类型
                api(project(":domain"))
            }
        }
        // ChatStateHolder 用 Compose 的可观察状态承载会话（与 :domain 的 @Immutable 同一份 runtime）
        val jvmAndAndroidMain by getting {
            dependencies {
                implementation("org.jetbrains.compose.runtime:runtime:1.7.3")
                implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
                // WebClipFetcher 与 :domain 的 AiService 用同一份 OkHttp
                implementation("com.squareup.okhttp3:okhttp:4.12.0")
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
                // 与 :domain 同款：这批测试写的是 org.junit API
                implementation("junit:junit:4.13.2")
            }
        }
    }
}

android {
    namespace = "com.knowflick.shareddata"
    compileSdk = 36
    defaultConfig {
        minSdk = 26
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
