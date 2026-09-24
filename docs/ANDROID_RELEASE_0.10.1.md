# KnowFlick Android v0.10.1

发布日期：2026-09-25。versionCode：21。最低 Android 8.0 / API 26。

## 本版变化

- 网页剪藏提炼出的卡片会将规范网页地址保留在来源列表首位，并移除 AI 同时返回的原始提交地址或规范地址重复项。
- 其他 AI 生成的参考链接及其顺序保持不变。

## 安装与升级

在本 Release 下载 `KnowFlick-0.10.1.apk`。使用既有发布证书签名，可覆盖安装并保留本地数据；更新前可在 App 导出备份。
附件 `KnowFlick-0.10.1.apk.sha256` 用于核对下载完整性。

## 验证与边界

- `tools/build_android.sh` 通过：264 项 JVM 单测、Debug Lint、Release/R8、签名校验及 ZIP 对齐检查。
- APK 校验和文件匹配，且 APK ZIP 完整性检查通过。
- 去重按完整 URL 字符串匹配本次提交地址与抽取出的规范地址。仅有大小写、尾斜杠或查询参数差异的其他地址可能仍会同时显示。
