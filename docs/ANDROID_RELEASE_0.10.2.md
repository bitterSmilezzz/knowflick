# KnowFlick Android v0.10.2

发布日期：2026-09-25。versionCode：22。最低 Android 8.0 / API 26。

## 本版变化

- AI 服务与云端语音凭据的保存、删除改为后台协程操作。仍使用同步 `commit()` 确认落盘结果，因此设置页继续显示成功或失败反馈；Keystore 加密和文件同步不再占用界面线程。
- 保存期间禁用两处保存按钮并显示进度，避免同一时刻并发写入 AI 与语音配置。

## 安装与升级

在本 Release 下载 `KnowFlick-0.10.2.apk`。使用既有发布证书签名，可覆盖安装并保留本地数据；更新前可在 App 导出备份。
附件 `KnowFlick-0.10.2.apk.sha256` 用于核对下载完整性。

## 验证与边界

- `tools/build_android.sh`：265 项 JVM 单测、Debug Lint、Release/R8、签名与 ZIP 对齐验证通过。
- 新增存储测试验证凭据保存与删除在配置的 IO dispatcher 执行，并检查写入、读取和删除结果。
- 凭据读取与 `EncryptedSharedPreferences` 初始化仍为同步操作；本版只将设置页的保存和删除路径移出界面线程。加密 API 迁移仍是单独技术债。
