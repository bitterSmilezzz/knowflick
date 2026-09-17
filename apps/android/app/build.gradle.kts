import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    // 应用 baseline profile：把 :baselineprofile 采集到的规则合并进发布包
    id("androidx.baselineprofile")
}

val releaseSigning = Properties().apply {
    val config = rootProject.file("signing.properties")
    if (config.isFile) config.inputStream().use { load(it) }
}

android {
    namespace = "com.knowflick.app"
    compileSdk = 35

    // 种子卡与分类背景图由仓库根 shared/assets 提供，与 macOS 端共用同一份内容，
    // 避免各端各自维护一份副本而逐渐漂移（迁移前两端 42 张底图与种子卡逐字节一致）。
    sourceSets["main"].assets.srcDirs("../../../shared/assets")

    defaultConfig {
        applicationId = "com.knowflick.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 15
        versionName = "0.8.7"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        if (releaseSigning.isNotEmpty()) {
            create("release") {
                storeFile = rootProject.file(releaseSigning.getProperty("storeFile"))
                storePassword = releaseSigning.getProperty("storePassword")
                keyAlias = releaseSigning.getProperty("keyAlias")
                keyPassword = releaseSigning.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (releaseSigning.isNotEmpty()) signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
    testOptions {
        unitTests {
            isIncludeAndroidResources = true
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    // 只用 material-icons-core：扩展包含 2277 个图标，会让每个 debug 构建多出约 3.8 MB dex。
    // 本项目额外需要的 4 个图标见 ui/AppIcons.kt。
    implementation("androidx.compose.material:material-icons-core")
    // activity-compose 停在 1.9.3：1.13.0 的 AAR 元数据要求 minCompileSdk=36 + AGP≥8.9.1，
    // 升级会连锁到「装 SDK 36 → compileSdk 36 → 升 AGP → 大概率升 Kotlin → 重采 baseline profile」，
    // 属于独立的工具链升级版本，0.8.6 不背这个包。
    implementation("androidx.activity:activity-compose:1.9.3")
    // lifecycle 留在 2.8.7（0.8.6 未能升级，实测记录如下）：
    //  - 2.11.0：androidx.lifecycle 组内版本对齐会把 lifecycle-runtime-compose 一起升到 2.11.0，
    //    而 lifecycle-runtime-compose-android:2.11.0 的 AAR 元数据是 minCompileSdk=37 +
    //    minAndroidGradlePluginVersion=9.1.0 → `checkDebugAarMetadata` 直接失败。
    //  - 2.10.0（元数据 minCompileSdk=35 / AGP 8.6.0，本可通过元数据校验）与 2.9.4：
    //    其 lint 检测器（NonNullableMutableLiveDataDetector / RememberInCompositionDetector）
    //    用新版 Kotlin 分析 API 编译，在 AGP 8.7.3 自带 lint 下抛
    //    java.lang.IncompatibleClassChangeError，导致 `lintDebug` 任务崩溃。
    //    不为此 disable 掉 "NullSafeMutableLiveData" 等正确性检查——那是拿检查换依赖版本。
    // 结论：lifecycle 升级必须与 AGP 工具链升级（≥8.9，可能连带 compileSdk 36/37 与 Kotlin 版本）
    // 作为一个整体版本推进，届时需重跑全量 JVM + 仪器测试并重采 baseline profile。
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // 凭据持久化：EncryptedSharedPreferences（Android Keystore 支撑）。
    // 1.1.0 起 EncryptedSharedPreferences / MasterKey 已被 androidx 标记弃用
    //（改用 AndroidKeyStore + KeyGenerator），代码侧以 @Suppress("DEPRECATION") + TODO 承接；
    // TODO(技术债)：凭据存储迁移到 DataStore + Tink 或原生 AndroidKeyStore（见 SystemCredentialStore.kt）。
    implementation("androidx.security:security-crypto:1.1.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation(kotlin("test"))
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    // Robolectric：JVM 上模拟 Android 运行时（assets/Context 可测）
    testImplementation("org.robolectric:robolectric:4.14.1")
    // androidx.test 三件套不升：robolectric 4.14.1 的 POM 声明依赖 androidx.test:monitor:1.7.2
    //（即 1.6.x 线），而 core 1.7.0 对应 monitor 1.8.0 线，混装会让单元测试类路径出现
    // 1.6/1.7 并存并可能触发 IncompatibleClassChangeError，直接威胁现有 Robolectric 测试。
    // 升级须与 Robolectric 同步进行并重跑全量 JVM + 仪器测试，留待独立版本。
    testImplementation("androidx.test:core:1.6.1")

    // Instrumented 测试（模拟器/真机）
    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    debugImplementation("androidx.compose.ui:ui-test-manifest")

    // baseline profile 采集器（:baselineprofile 模块）
    baselineProfile(project(":baselineprofile"))
}
