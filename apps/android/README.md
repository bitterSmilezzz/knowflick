# KnowFlick Android

原生 Kotlin + Jetpack Compose 应用。当前版本 **0.8.8**（versionCode 16），最低 Android 8.0 / API 26，target/compile SDK 35。

已实现刷卡、详情、收藏与历史、学习统计、知识测验、撤销上一张、AI 流式生成与服务商配置、卡片 JSON 导入，以及 JSON/Markdown/Anki 文本导出。语音支持系统 TTS、云端 OpenAI 兼容接口与本地回环网关。背景图使用 WebP 与领域多图池（42 张，计算机与 AI / 自然宇宙科学 / 人文心智 / 商业财会金融四池），发布包内置 baseline profile。

## 构建与测试

需要 JDK 17、Android SDK Platform 35、Build Tools 35.0.0。将 SDK 路径写入本机 `apps/android/local.properties`：

```properties
sdk.dir=/absolute/path/to/Android/sdk
```

在 `apps/android` 目录运行：

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

界面或启动路径有较大改动后应重新采集一次，否则 profile 会逐渐偏离实际热点。0.8.6 改动了卡堆排布与渲染路径（底图 key 空间对齐），已重新采集：17530 → 17802 条规则（新增 495 / 删除 222 / 未变 17308，约 96% 未变）。

## 备份策略（0.8.6 起明确化）

`android:allowBackup="true"` 保留（卡片库 `files/store/cards.json` 含收藏、历史、复习进度，换机不该丢），但凭据被排除在云备份与换机直传之外：

- `res/xml/data_extraction_rules.xml`（API 31+，`android:dataExtractionRules`）
- `res/xml/backup_rules.xml`（API ≤30，`android:fullBackupContent`）

两个文件都只 `<exclude domain="sharedpref" path="knowflick_credentials.xml" />` 与 `knowflick_credentials_plain.xml`，不写 `<include>`（未列出的内容默认仍会备份）。

**取舍理由**：凭据存在 `EncryptedSharedPreferences` 里，解密依赖随设备存活的 Android Keystore 主密钥。备份/换机恢复后密文文件还在、主密钥却不存在，`EncryptedSharedPreferences.create()` 抛异常并被 `SystemCredentialStore` 的 catch 吞掉，回退到**另一个文件名**的明文库 —— 用户只会看到「API Key 莫名其妙没了」。既然密文文件跨设备无法解密，把它备份过去有害无益，直接排除。代价：换机后 API Key 与语音密钥需重新输入一次（卡片与学习进度不受影响）。

实测（Android 15 模拟器，AOSP local transport + `bmgr`）：

| 步骤 | 结果 |
| --- | --- |
| 有排除规则：备份 → 卸载（模拟换机）→ 重装 → 恢复 | `files/store/cards.json` md5 与备份前完全一致；`shared_prefs/` 恢复后为空（凭据未进入备份集） |
| 对照组（临时移除两个规则属性后重建）：同一流程 | `shared_prefs/knowflick_credentials.xml` 被完整恢复（md5 与备份前一致，mtime 为恢复时间戳） |

恢复到「主密钥确实丢失」的设备这一步未能在模拟器上复现：本机模拟器的 Keystore 由单个 `persistent.sqlite` 承载，`adb uninstall` 后主密钥仍可用，恢复出的密文依旧能解密，因此没有观察到降级到明文库的现象。真实换机时主密钥必然不存在，该结论仍属推断。

## 凭据存储降级提示

Keystore 不可用时 `SystemCredentialStore` 会回退到普通 `SharedPreferences`（文件名 `knowflick_credentials_plain`），密钥以明文落盘。设置页读取 `SystemCredentialStore.isEncrypted`，降级时在顶部显示橙色提示条告知用户。

## 依赖升级的已知阻断（0.8.6 记录，供下一个工具链版本处理）

- `androidx.activity:activity-compose` 停在 1.9.3：1.13.0 要求 `minCompileSdk=36` + AGP ≥ 8.9.1。
- `androidx.lifecycle:lifecycle-runtime-ktx` 停在 2.8.7：升 2.11.0 会因组内版本对齐把 `lifecycle-runtime-compose` 一起升级，其 AAR 元数据要求 `minCompileSdk=37` + AGP 9.1.0，`checkDebugAarMetadata` 直接失败；升 2.10.0 / 2.9.4 的 AAR 元数据虽可通过，但它们的 lint 检测器在 AGP 8.7.3 自带 lint 下抛 `IncompatibleClassChangeError`，会让 `lintDebug` 崩溃。不为此 disable 正确性检查。
- `androidx.test` 三件套不升：`robolectric:4.14.1` 依赖 `androidx.test:monitor:1.7.2`（1.6.x 线），把 `core` 单独升到 1.7.0（monitor 1.8.0 线）会让单元测试类路径混装。
- `androidx.security:security-crypto` 已升 1.1.0（摆脱 alpha）；其 `EncryptedSharedPreferences` / `MasterKey` 自 1.1.0 起被 androidx 弃用，代码以文件级 `@Suppress("DEPRECATION")` + TODO 承接，迁移到 DataStore + Tink 或原生 AndroidKeyStore 登记为独立技术债。

以上四项对应 Lint 中剩余 5 条 `GradleDependency` 警告（另含 activity-compose），均为有意保留。

## 可安装发布 APK

Release 开启 R8 与资源压缩，使用独立发布证书。`signing.properties`、密钥文件和构建输出均不入 Git；没有配置签名时，直接调用 Gradle 只产生未签名 Release，交付脚本会提前报错。

本机发布密钥及配置备份位于 `~/.local/share/knowflick/signing/`，目录权限 700、文件权限 600。**后续 APK 更新必须继续使用这份密钥；请将该目录另行安全备份。** 本机 `apps/android/signing.properties` 引用其中的密钥。

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
adb install -r dist/android/KnowFlick-0.8.6.apk
```

如果手机已安装相同包名的 Debug 版，因签名不同无法覆盖。先从知识库导出需要保留的卡片，再由用户自行卸载旧版后安装；卸载会清除本地学习记录和配置。后续同签名 Release 可直接覆盖更新。

## 语音配置

语音与聊天模型分别配置。API 密钥通过 Android Keystore 支撑的加密偏好存储；Keystore 异常时当前实现会回退本地普通偏好存储，并在设置页显示降级提示条（见上文「凭据存储降级提示」）。

- 云端使用 HTTPS `/v1/audio/speech`。
- 本地服务只放行 `http://127.0.0.1:<port>` 回环明文连接，不将模型文件打入 APK。
- USB/模拟器访问开发机器本地网关：`adb reverse tcp:8899 tcp:8899`，Base URL 填 `http://127.0.0.1:8899`。

本轮交付是可安装 APK，未上传应用商店。测试范围与实际结果见 `docs/ANDROID_RELEASE_0.8.6.md`（仓库根目录下）。
