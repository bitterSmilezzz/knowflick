// 仓库镜像策略（2026-10-10 双机协作）：国内镜像只对本地开发开放。
//
// 为什么：macOS/Windows 两台开发机同在中国大陆网络环境，直连 google() /
// gradlePluginPortal() 经常超时（wrapper 下载更甚，见 gradle-wrapper.properties），
// 本地开发默认启用阿里云镜像。但镜像对海外 GitHub runner 是绕路——每个构件都要先撞
// 一次镜像再回退官方源，会平白拖慢 CI，所以检测到 CI 环境变量时只用官方源。
// 本地想模拟 CI 网络：`CI=1 ./gradlew …`。
//
// 注意：`pluginManagement {}` 是隔离的脚本块，外部变量进不去，判据必须写在块内。
pluginManagement {
    val useChinaMirrors = System.getenv("CI") == null
    repositories {
        if (useChinaMirrors) {
            maven("https://maven.aliyun.com/repository/gradle-plugin")
            maven("https://maven.aliyun.com/repository/google")
            maven("https://maven.aliyun.com/repository/public")
        }
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    val useChinaMirrors = System.getenv("CI") == null
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        if (useChinaMirrors) {
            maven("https://maven.aliyun.com/repository/google")
            maven("https://maven.aliyun.com/repository/public")
        }
        google()
        mavenCentral()
    }
}

rootProject.name = "KnowFlick"
include(":app")
include(":baselineprofile")
