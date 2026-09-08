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
