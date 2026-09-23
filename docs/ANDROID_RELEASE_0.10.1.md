# KnowFlick Android v0.10.1

发布日期：2026-09-24。versionCode：21。最低 Android 8.0 / API 26。

## 本版变化

- Android pull request 与 main CI 新增 Gradle Managed Device 仪器测试，运行已有 Compose 界面、导航、凭据持久化、听书播控与发布就绪回归用例。
- CI 使用 Pixel 2 / API 30 / AOSP ATD。标准 `ubuntu-latest` 需先应用官方 KVM udev 规则；本轮探针已确认该 runner 设置可用。
- 应用功能、卡片数据格式与用户数据迁移均未变化。

## 安装与升级

在本 Release 下载 `KnowFlick-0.10.1.apk`。本版不改变数据格式，可覆盖安装并保留本地数据；更新前可在 App 导出备份。
附件 `KnowFlick-0.10.1.apk.sha256` 用于核对下载完整性。

## 验证与边界

发布执行 `tools/build_android.sh`（JVM 单测、Lint、Release/R8、签名和 ZIP 对齐校验），并由 Android workflow 执行 JVM 单测、Lint、Debug/Release APK 构建及 Gradle Managed Device 仪器测试。测试设备为 API 30 AOSP ATD；不据此声称已验证真实设备、Google Play 服务或 API 31 以上系统。详细结果以本次发布 PR 与 workflow 记录为准。
