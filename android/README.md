> 📌 状态（android-v0.1.0 / M1）：可编译的 Kotlin + Compose 工程已落地——领域核心（卡片模型/JSON 线格式对齐/分类注册表/统计/学习计划/卡堆防重排布/状态机/文件存储）+ 38 项 JVM 测试全绿，Debug APK 可装配。构建：`cd android && ./gradlew :app:assembleDebug`（需 JDK 17 与 Android SDK 35）。M2 已接入 Compose 刷卡主界面（卡堆拖拽/详情/统计）；android-v0.2.1 补齐四层测试（`./gradlew :app:connectedDebugAndroidTest` 需先启动 `knowflick-test` AVD）；android-v0.4.0 接入 AI 生成 + 设置页 + 16 服务商预设（OkHttp SSE 流式 + MockWebServer 测试）；android-v0.5.0 落地知识库（收藏阁 + 历史足迹）、JSON/Markdown/Anki 导入导出（与 macOS 同格式）；android-v0.6.0 完成语音三通道（系统 TTS / 云端 /audio/speech / 本地回环网关）与磨耳朵连续播报——第一阶段边界全部交付。本地网关联调：`adb reverse tcp:8899 tcp:8899` 后把语音 Base URL 指向 `http://127.0.0.1:8899`（回环地址已放行明文，其余强制 HTTPS）。

# KnowFlick Android

Android 端将复用 macOS 的卡片领域模型和服务协议，采用 Kotlin + Jetpack Compose 实现。

## 第一阶段边界

- 卡堆、左右滑动、详情、历史、收藏和学习统计
- 多套 AI 配置与来源过滤
- 语音引擎选择：Android 系统 TTS、云端 `/audio/speech`、本地 OpenAI 兼容 TTS 服务
- 与 macOS 相同的卡片 JSON 导入导出格式

## 语音配置约定

语音配置与聊天模型分开。一个配置包含 `baseURL`、`model`、`voice` 和 Keychain/Android Keystore 中的密钥；一次启用一个配置，失败时回退系统 TTS。

- 云端：HTTPS `/v1/audio/speech`，例如 CosyVoice / MOSS-TTSD。
- 本地：用户自行运行 Kokoro-FastAPI、CosyVoice 网关或其他兼容服务，应用只连接 `http://127.0.0.1:<port>/v1/audio/speech`。
- 模型文件不打进 APK。这样可以避免 APK 体积、设备内存和模型许可证限制，也让桌面端与 Android 端共用配置结构。

当前机器没有 Android SDK、Gradle 或 Android Studio，因此这里只建立 Android 端契约和实施边界；安装 Android 工具链后再生成可编译的 Compose 工程。
