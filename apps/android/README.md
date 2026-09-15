# KnowFlick Android

原生 Kotlin + Jetpack Compose 应用。当前版本 **0.8.5**（versionCode 13），最低 Android 8.0 / API 26，target/compile SDK 35。

已实现刷卡、详情、收藏与历史、学习统计、知识测验、AI 流式生成与服务商配置、卡片 JSON 导入，以及 JSON/Markdown/Anki 文本导出。语音支持系统 TTS、云端 OpenAI 兼容接口与本地回环网关。背景图使用 WebP，发布包内置 baseline profile。

## 构建与测试

需要 JDK 17、Android SDK Platform 35、Build Tools 35.0.0。将 SDK 路径写入本机 `android/local.properties`：

```properties
sdk.dir=/absolute/path/to/Android/sdk
```

在 `android` 目录运行：

```sh
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
# 先启动安卓模拟器或连接允许 USB 调试的测试手机
./gradlew :app:connectedDebugAndroidTest
```

设备测试安装的是 Debug 签名包，建议使用独立测试 AVD；已安装 Release 的设备无法直接覆盖安装 Debug。

若 macOS Homebrew JDK 未被系统发现：

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
```

### baseline profile

`:baselineprofile` 模块用真实设备采集冷启动与刷卡路径，规则提交在 `app/src/release/generated/baselineProfiles/`，构建 Release 时自动合并进 APK。仅在需要重新采集时运行（需要已连接设备，耗时约 3 分钟）：

```sh
./gradlew :app:generateReleaseBaselineProfile
```

界面或启动路径有较大改动后应重新采集一次，否则 profile 会逐渐偏离实际热点。

## 可安装发布 APK

Release 开启 R8 与资源压缩，使用独立发布证书。`signing.properties`、密钥文件和构建输出均不入 Git；没有配置签名时，直接调用 Gradle 只产生未签名 Release，交付脚本会提前报错。

本机发布密钥及配置备份位于 `~/.local/share/knowflick/signing/`，目录权限 700、文件权限 600。**后续 APK 更新必须继续使用这份密钥；请将该目录另行安全备份。** 本机 `android/signing.properties` 引用其中的密钥。

其他机器需要先安全取得同一份密钥，再建立以下配置（填入实际路径和密码）：

```properties
storeFile=/absolute/path/to/release.jks
storePassword=YOUR_STORE_PASSWORD
keyAlias=knowflick
keyPassword=YOUR_KEY_PASSWORD
```

仓库根目录执行：

```sh
./tools/build_android.sh --connected
# 不连接设备时仅运行 JVM 测试、Lint 与签名构建
./tools/build_android.sh
```

产物位于 `dist/android/`：APK、SHA-256 校验文件、R8 mapping。脚本会校验 APK 签名及 ZIP 对齐。mapping 用于还原压缩版崩溃堆栈，应随版本归档。发布准备参考 [Android 官方发布指南](https://developer.android.com/studio/publish/preparing) 和 [应用签名指南](https://developer.android.com/studio/publish/app-signing)。

把 APK 传到手机后打开安装，按系统提示允许该文件来源安装应用；也可执行：

```sh
adb install -r dist/android/KnowFlick-0.8.5.apk
```

如果手机已安装相同包名的 Debug 版，因签名不同无法覆盖。先从知识库导出需要保留的卡片，再由用户自行卸载旧版后安装；卸载会清除本地学习记录和配置。后续同签名 Release 可直接覆盖更新。

## 语音配置

语音与聊天模型分别配置。API 密钥通过 Android Keystore 支撑的加密偏好存储；Keystore 异常时当前实现会回退本地普通偏好存储。

- 云端使用 HTTPS `/v1/audio/speech`。
- 本地服务只放行 `http://127.0.0.1:<port>` 回环明文连接，不将模型文件打入 APK。
- USB/模拟器访问开发机器本地网关：`adb reverse tcp:8899 tcp:8899`，Base URL 填 `http://127.0.0.1:8899`。

本轮交付是可安装 APK，未上传应用商店。测试范围与实际结果见 `docs/ANDROID_RELEASE_0.8.5.md`（仓库根目录下）。
